const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate, adminOnly } = require("../auth");
const sse     = require("../sse");

// ── Multer config for complaint screenshot attachments ──────────────────────
const uploadsDir = path.join(__dirname, "../../data/uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const ALLOWED_TYPES = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // 5MB per file, max 5 files
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
      return cb(new Error("Only image files (jpg, png, gif, webp) are allowed."));
    }
    cb(null, true);
  },
});

async function generateTicketNo(db) {
  // Use IST (Asia/Kolkata) consistently, since created_at is stored in UTC —
  // this avoids an off-by-one day/month near midnight IST.
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day   = String(istNow.getDate()).padStart(2, "0");
  const month = String(istNow.getMonth() + 1).padStart(2, "0");
  const year  = istNow.getFullYear();

  // Count how many complaints already exist in this calendar month (IST),
  // so the sequence number resets to 01 at the start of each new month —
  // not each new day. created_at is UTC, so convert before comparing dates.
  const row = await db.get(`
    SELECT COUNT(*) as n FROM complaints
    WHERE strftime('%Y-%m', datetime(created_at, '+5 hours', '+30 minutes')) = ?
  `, [`${year}-${month}`]);

  const nextSeq = row.n + 1;
  // If somehow more than 99 complaints occur in a single month, fall back to
  // a wider sequence so numbers never collide (e.g. 100 instead of 00).
  const seqPart = nextSeq > 99 ? String(nextSeq) : String(nextSeq).padStart(2, "0");

  return `${seqPart}${day}${month}`;
}

module.exports = function complaintRoutes(db) {
  const router = express.Router();

  // LEFT JOIN so complaints from deleted users still show up (using the
  // permanent raised_by_name/raised_by_dept snapshot as a fallback via COALESCE).
  const getComplaintQuery = `
    SELECT
      c.*,
      COALESCE(u.name, c.raised_by_name, 'Deleted User') AS user_name,
      COALESCE(u.department, c.raised_by_dept, '')        AS user_dept,
      u.email       AS user_email,
      a.name        AS closed_by_name
    FROM complaints c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN users a ON c.closed_by = a.id
  `;

  // GET /api/complaints
  router.get("/", authenticate, async (req, res) => {
    try {
      const { category, status, search } = req.query;
      let query = getComplaintQuery;
      const params = [];
      const conditions = [];

      if (req.user.role !== "admin") {
        conditions.push("c.user_id = ?");
        params.push(req.user.id);
      }
      if (category && category !== "All") {
        conditions.push("c.category = ?");
        params.push(category);
      }
      if (status && status !== "All") {
        conditions.push("c.status = ?");
        params.push(status);
      }
      if (search) {
        conditions.push("(c.title LIKE ? OR c.ticket_no LIKE ? OR COALESCE(u.name, c.raised_by_name) LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY c.id DESC";

      const complaints = await db.all(query, params);
      res.json(complaints);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/complaints/stats
  router.get("/stats", authenticate, async (req, res) => {
    try {
      const uid = req.user.role === "admin" ? null : req.user.id;
      const where = uid ? "WHERE c.user_id = ?" : "";
      const params = uid ? [uid] : [];

      const total  = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where}`, params)).n;
      const open   = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where} ${uid ? "AND" : "WHERE"} c.status = 'Open'`, params)).n;
      const inprog = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where} ${uid ? "AND" : "WHERE"} c.status = 'In Progress'`, params)).n;
      const closed = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where} ${uid ? "AND" : "WHERE"} c.status = 'Closed'`, params)).n;

      const byCat = await db.all(`
        SELECT category,
          COUNT(*) as total,
          SUM(CASE WHEN status != 'Closed' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'Closed'  THEN 1 ELSE 0 END) as closed_count
        FROM complaints c ${where}
        GROUP BY category
      `, params);

      res.json({ total, open, inprog, closed, byCat });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/complaints/:id
  router.get("/:id", authenticate, async (req, res) => {
    try {
      const c = await db.get(getComplaintQuery + " WHERE c.id = ?", [req.params.id]);
      if (!c) return res.status(404).json({ error: "Complaint not found." });
      if (req.user.role !== "admin" && c.user_id !== req.user.id)
        return res.status(403).json({ error: "Access denied." });
      res.json(c);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Text formatting helpers (server-side safety net, matching frontend) ────
  function capitalizeWords(str) {
    return str.replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }
  function capitalizeFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  function capitalizeSentences(str) {
    if (!str) return str;
    return str.replace(/(^\s*\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
  }

  // POST /api/complaints
  // Uses multer to accept multipart/form-data so up to 5 optional screenshots
  // can be attached alongside the regular text fields.
  router.post("/", authenticate, (req, res) => {
    upload.array("attachments", 5)(req, res, async (uploadErr) => {
      if (uploadErr) {
        const msg = uploadErr.code === "LIMIT_FILE_COUNT"
          ? "You can attach up to 5 images per complaint."
          : uploadErr.code === "LIMIT_FILE_SIZE"
          ? "Each image must be smaller than 5MB."
          : uploadErr.message || "File upload failed.";
        return res.status(400).json({ error: msg });
      }

      try {
        const { category, title, description, complainant_name } = req.body;
        if (!category || !title || !complainant_name) {
          // Clean up any already-saved files if validation fails afterward
          if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
          return res.status(400).json({ error: "Complainant name, category, and title are required." });
        }

        const validCats = ["Hardware", "Software", "INAMS"];
        if (!validCats.includes(category)) {
          if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
          return res.status(400).json({ error: "Invalid category." });
        }

        const formattedComplainantName = capitalizeWords(complainant_name.trim());
        const formattedDescription = description ? capitalizeSentences(description.trim()) : "";
        // Stored as a JSON array string, e.g. ["/uploads/a.jpg","/uploads/b.png"].
        // Older complaints created before multi-image support will instead
        // have a single bare path string in this column — the frontend
        // (getAttachmentPaths helper) handles both formats transparently.
        const attachmentPaths = (req.files || []).map(f => `/uploads/${f.filename}`);
        const attachmentPath = attachmentPaths.length ? JSON.stringify(attachmentPaths) : "";

        // Snapshot the raiser's current name/department permanently onto the complaint,
        // so this info survives even if their user account is later deleted.
        // Retry a couple of times in the rare case two complaints are submitted
        // at almost the same instant and would otherwise generate the same
        // ticket number (ticket_no has a UNIQUE constraint).
        let result;
        let ticket_no;
        for (let attempt = 0; attempt < 3; attempt++) {
          ticket_no = await generateTicketNo(db);
          try {
            result = await db.run(`
              INSERT INTO complaints (ticket_no, user_id, raised_by_name, raised_by_dept, complainant_name, category, title, description, priority, attachment_path, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Medium', ?, datetime('now'))
            `, [ticket_no, req.user.id, req.user.name, req.user.department, formattedComplainantName, category, title.trim(), formattedDescription, attachmentPath]);
            break;
          } catch (insertErr) {
            const isDup = /UNIQUE constraint failed/i.test(insertErr.message || "");
            if (isDup && attempt < 2) continue;
            throw insertErr;
          }
        }

        await db.run(`
          INSERT INTO activity_log (complaint_id, user_id, actor_name, action, detail)
          VALUES (?, ?, ?, 'Created', ?)
        `, [result.lastInsertRowid, req.user.id, req.user.name, `Complaint raised: ${title.trim()}`]);

        const complaint = await db.get(getComplaintQuery + " WHERE c.id = ?", [result.lastInsertRowid]);

        // Notify any connected admin browser tabs immediately so they can
        // show a native push notification, without needing to poll/refresh.
        sse.broadcast("new-complaint", {
          id: complaint.id,
          ticket_no: complaint.ticket_no,
          title: complaint.title,
          category: complaint.category,
          complainant_name: complaint.complainant_name,
          raised_by_dept: complaint.raised_by_dept,
        });

        res.status(201).json(complaint);
      } catch (err) {
        console.error(err);
        if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // PATCH /api/complaints/:id/status
  router.patch("/:id/status", authenticate, adminOnly, async (req, res) => {
    try {
      const { status, comment, priority } = req.body;
      if (!["Open", "In Progress"].includes(status))
        return res.status(400).json({ error: "Status must be Open or In Progress." });

      if (status === "In Progress" && (!comment || !comment.trim()))
        return res.status(400).json({ error: "A comment is required when moving to In Progress." });

      const validPris = ["Low", "Medium", "High", "Critical"];
      if (priority && !validPris.includes(priority))
        return res.status(400).json({ error: "Invalid priority." });

      const c = await db.get("SELECT * FROM complaints WHERE id = ?", [req.params.id]);
      if (!c) return res.status(404).json({ error: "Complaint not found." });
      if (c.status === "Closed") return res.status(400).json({ error: "Cannot change status of a closed complaint." });

      if (priority) {
        await db.run("UPDATE complaints SET status = ?, priority = ?, updated_at = datetime('now') WHERE id = ?", [status, priority, req.params.id]);
      } else {
        await db.run("UPDATE complaints SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, req.params.id]);
      }

      const detailParts = [`Status changed to: ${status}`];
      if (priority) detailParts.push(`Priority set to: ${priority}`);
      if (comment && comment.trim()) detailParts.push(`Comment: ${comment.trim()}`);

      await db.run(`
        INSERT INTO activity_log (complaint_id, user_id, actor_name, action, detail)
        VALUES (?, ?, ?, 'Status Updated', ?)
      `, [req.params.id, req.user.id, req.user.name, detailParts.join(" — ")]);

      const updated = await db.get(getComplaintQuery + " WHERE c.id = ?", [req.params.id]);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // PATCH /api/complaints/:id/close
  router.patch("/:id/close", authenticate, adminOnly, async (req, res) => {
    try {
      const { remarks } = req.body;
      if (!remarks || !remarks.trim())
        return res.status(400).json({ error: "Remarks are required to close a complaint." });

      const c = await db.get("SELECT * FROM complaints WHERE id = ?", [req.params.id]);
      if (!c) return res.status(404).json({ error: "Complaint not found." });
      if (c.status === "Closed") return res.status(400).json({ error: "Complaint is already closed." });

      await db.run(`
        UPDATE complaints
        SET status = 'Closed', remarks = ?, closed_by = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [remarks.trim(), req.user.id, req.params.id]);

      await db.run(`
        INSERT INTO activity_log (complaint_id, user_id, actor_name, action, detail)
        VALUES (?, ?, ?, 'Closed', ?)
      `, [req.params.id, req.user.id, req.user.name, remarks.trim()]);

      const updated = await db.get(getComplaintQuery + " WHERE c.id = ?", [req.params.id]);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/complaints/:id/activity
  router.get("/:id/activity", authenticate, async (req, res) => {
    try {
      const c = await db.get("SELECT * FROM complaints WHERE id = ?", [req.params.id]);
      if (!c) return res.status(404).json({ error: "Complaint not found." });
      if (req.user.role !== "admin" && c.user_id !== req.user.id)
        return res.status(403).json({ error: "Access denied." });

      // COALESCE: prefer the live user's current name, fall back to the
      // permanent actor_name snapshot if that user has since been deleted.
      const logs = await db.all(`
        SELECT l.*, COALESCE(u.name, l.actor_name, 'Deleted User') as actor_name
        FROM activity_log l
        LEFT JOIN users u ON l.user_id = u.id
        WHERE l.complaint_id = ?
        ORDER BY l.created_at DESC
      `, [req.params.id]);

      res.json(logs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
