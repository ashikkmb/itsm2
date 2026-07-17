const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate } = require("../auth");
const { moduleAccess } = require("../permissions");

// ── Multer config for lunch pass photos ──────────────────────────────────────
const photosDir = path.join(__dirname, "../../data/lunch-pass-photos");
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, photosDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const ALLOWED_TYPES = [".jpg", ".jpeg", ".png", ".webp"];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
      return cb(new Error("Only image files (jpg, png, webp) are allowed."));
    }
    cb(null, true);
  },
});

function addOneYear(dateStr) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1); // inclusive end date, e.g. 01 Jul 2026 -> 30 Jun 2027
  return d.toISOString().slice(0, 10);
}

module.exports = function lunchPassRoutes(db) {
  const router = express.Router();
  const canLunchpass = moduleAccess(db, "lunchpass");

  // Recompute Active -> Expired status for any pass whose valid_to has passed.
  // Runs at the start of every list request so the registry is always current
  // without needing a separate scheduled job.
  async function refreshExpiredStatuses() {
    const today = new Date().toISOString().slice(0, 10);
    await db.run(
      "UPDATE lunch_passes SET status = 'Expired' WHERE status = 'Active' AND valid_to < ?",
      [today]
    );
  }

  // GET /api/lunch-passes — list all passes, admin only
  router.get("/", authenticate, canLunchpass, async (req, res) => {
    try {
      await refreshExpiredStatuses();
      const { search, status, gate, expiringSoon } = req.query;

      let query = "SELECT * FROM lunch_passes";
      const conditions = [];
      const params = [];

      if (search) {
        conditions.push("(name LIKE ? OR id_no LIKE ? OR pass_no LIKE ? OR section LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (status && status !== "All") {
        conditions.push("status = ?");
        params.push(status);
      }
      if (gate && gate !== "All") {
        conditions.push("gate = ?");
        params.push(gate);
      }
      if (expiringSoon === "true") {
        const today = new Date().toISOString().slice(0, 10);
        const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        conditions.push("status = 'Active' AND valid_to BETWEEN ? AND ?");
        params.push(today, in30Days);
      }

      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY id DESC";

      const passes = await db.all(query, params);
      res.json(passes);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/lunch-passes/:id — single pass detail
  router.get("/:id", authenticate, canLunchpass, async (req, res) => {
    try {
      const pass = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
      if (!pass) return res.status(404).json({ error: "Pass not found." });
      res.json(pass);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // POST /api/lunch-passes — create a new pass, admin only
  router.post("/", authenticate, canLunchpass, (req, res) => {
    upload.single("photo")(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res.status(400).json({ error: uploadErr.message || "Photo upload failed." });
      }
      try {
        const { pass_no, name, id_no, designation, mobile, section, gate, valid_from, photo_position_x, photo_position_y } = req.body;

        const missing = [];
        if (!name || !name.trim()) missing.push("Name");
        if (!id_no || !id_no.trim()) missing.push("ID No");
        if (!designation || !designation.trim()) missing.push("Designation");
        if (!mobile || !mobile.trim()) missing.push("Mobile No");
        if (!section || !section.trim()) missing.push("Section");
        if (!req.file) missing.push("Photo");

        if (missing.length) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required.` });
        }
        if (!["West Gate", "East Gate"].includes(gate)) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Gate must be West Gate or East Gate." });
        }

        const validFrom = valid_from || new Date().toISOString().slice(0, 10);
        const validTo = addOneYear(validFrom);
        const photoPath = `/lunch-pass-photos/${req.file.filename}`;
        const posX = photo_position_x !== undefined && photo_position_x !== "" ? Number(photo_position_x) : 50;
        const posY = photo_position_y !== undefined && photo_position_y !== "" ? Number(photo_position_y) : 50;
        // Pass No. is written by hand on the card after printing, not entered
        // via the frontend. Store NULL when blank so multiple blank passes
        // don't collide on the UNIQUE constraint (SQLite allows many NULLs).
        const passNoValue = pass_no && pass_no.trim() ? pass_no.trim() : null;

        const result = await db.run(`
          INSERT INTO lunch_passes (pass_no, name, id_no, designation, mobile, section, gate, photo_path, photo_position_x, photo_position_y, valid_from, valid_to, created_by, created_by_name, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [passNoValue, name.trim(), id_no.trim(), designation.trim(), mobile.trim(), section.trim(), gate, photoPath, posX, posY, validFrom, validTo, req.user.id, req.user.name]);

        const pass = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [result.lastInsertRowid]);
        res.status(201).json(pass);
      } catch (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        if (err.message && err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "That Pass No. is already in use. Choose a different one." });
        }
        console.error(err);
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // PATCH /api/lunch-passes/:id — edit an existing pass (optionally replace photo)
  router.patch("/:id", authenticate, canLunchpass, (req, res) => {
    upload.single("photo")(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res.status(400).json({ error: uploadErr.message || "Photo upload failed." });
      }
      try {
        const existing = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
        if (!existing) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(404).json({ error: "Pass not found." });
        }

        const { pass_no, name, id_no, designation, mobile, section, gate, photo_position_x, photo_position_y } = req.body;

        // Pass No. is written by hand after printing and the frontend no longer
        // collects it, so it always arrives blank from the form. Only touch the
        // stored value if something non-blank was explicitly provided (e.g. a
        // future integration); otherwise leave whatever's already on file.
        const passNoProvided = pass_no !== undefined && pass_no.trim() !== "";
        if (passNoProvided && pass_no.trim() !== existing.pass_no) {
          const dupe = await db.get("SELECT id FROM lunch_passes WHERE pass_no = ? AND id != ?", [pass_no.trim(), req.params.id]);
          if (dupe) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: "That Pass No. is already in use. Choose a different one." });
          }
        }
        const newPassNo = passNoProvided ? pass_no.trim() : existing.pass_no;

        let photoPath = existing.photo_path;

        if (req.file) {
          // Replace old photo file if one existed
          if (existing.photo_path) {
            const oldFile = path.join(photosDir, path.basename(existing.photo_path));
            fs.unlink(oldFile, () => {});
          }
          photoPath = `/lunch-pass-photos/${req.file.filename}`;
        }

        const posX = photo_position_x !== undefined && photo_position_x !== "" ? Number(photo_position_x) : existing.photo_position_x;
        const posY = photo_position_y !== undefined && photo_position_y !== "" ? Number(photo_position_y) : existing.photo_position_y;

        await db.run(`
          UPDATE lunch_passes
          SET pass_no = ?, name = ?, id_no = ?, designation = ?, mobile = ?, section = ?, gate = ?, photo_path = ?, photo_position_x = ?, photo_position_y = ?, updated_at = datetime('now')
          WHERE id = ?
        `, [
          newPassNo,
          (name || existing.name).trim(),
          (id_no ?? existing.id_no).trim(),
          (designation ?? existing.designation).trim(),
          (mobile ?? existing.mobile).trim(),
          (section ?? existing.section).trim(),
          gate || existing.gate,
          photoPath,
          posX,
          posY,
          req.params.id,
        ]);

        const updated = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
        res.json(updated);
      } catch (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        if (err.message && err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "That Pass No. is already in use. Choose a different one." });
        }
        console.error(err);
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // PATCH /api/lunch-passes/:id/renew — clone validity dates forward by 1 year,
  // keeping the same pass record (and photo) but resetting the signature
  // table period. Re-uses the existing pass_no rather than issuing a new one.
  router.patch("/:id/renew", authenticate, canLunchpass, async (req, res) => {
    try {
      const existing = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Pass not found." });

      const newValidFrom = new Date().toISOString().slice(0, 10);
      const newValidTo = addOneYear(newValidFrom);

      await db.run(`
        UPDATE lunch_passes
        SET valid_from = ?, valid_to = ?, status = 'Active', updated_at = datetime('now')
        WHERE id = ?
      `, [newValidFrom, newValidTo, req.params.id]);

      const renewed = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
      res.json(renewed);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // PATCH /api/lunch-passes/:id/status — set Active/Deactivated manually
  // (e.g. staff left the organization, or pass was lost/replaced)
  router.patch("/:id/status", authenticate, canLunchpass, async (req, res) => {
    try {
      const { status } = req.body;
      if (!["Active", "Deactivated"].includes(status))
        return res.status(400).json({ error: "Status must be Active or Deactivated." });

      const existing = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Pass not found." });

      await db.run("UPDATE lunch_passes SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, req.params.id]);
      const updated = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // DELETE /api/lunch-passes/:id — permanent delete (rare; Deactivate is preferred)
  router.delete("/:id", authenticate, canLunchpass, async (req, res) => {
    try {
      const existing = await db.get("SELECT * FROM lunch_passes WHERE id = ?", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Pass not found." });

      if (existing.photo_path) {
        const photoFile = path.join(photosDir, path.basename(existing.photo_path));
        fs.unlink(photoFile, () => {});
      }

      await db.run("DELETE FROM lunch_passes WHERE id = ?", [req.params.id]);
      res.json({ message: "Pass deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
