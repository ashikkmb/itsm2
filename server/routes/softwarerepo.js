const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate, adminOnly } = require("../auth");

// ── Storage ───────────────────────────────────────────────────────────────
// Deliberately NOT mounted under express.static anywhere (unlike Knowledge
// References' /knowledge-files) — this can hold license-bearing installers,
// so every download goes through an authenticated, admin-only route instead
// of a guessable public URL.
const repoDir = path.join(__dirname, "../../data/software-repo");
if (!fs.existsSync(repoDir)) fs.mkdirSync(repoDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, repoDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

// Any file type is allowed (installers, drivers, .exe/.msi/.zip/.iso/etc.) —
// no fileFilter. 10GB cap keeps a single bad upload from filling the disk.
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

function fileTypeLabel(ext) {
  const clean = ext.replace(".", "").toUpperCase();
  return clean || "FILE";
}

module.exports = function softwareRepoRoutes(db) {
  const router = express.Router();

  // GET /api/software-repo?search=... — title/description search, admin only
  router.get("/", authenticate, adminOnly, async (req, res) => {
    try {
      const { search } = req.query;
      let query = `
        SELECT s.*, COALESCE(u.name, s.uploaded_by_name, 'Unknown') AS uploaded_by_name
        FROM software_repo s
        LEFT JOIN users u ON s.uploaded_by = u.id
      `;
      const params = [];
      if (search && search.trim()) {
        query += " WHERE s.title LIKE ? OR s.description LIKE ?";
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }
      query += " ORDER BY s.created_at DESC";
      res.json(await db.all(query, params));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // POST /api/software-repo — upload (admin only, any file type)
  router.post("/", authenticate, adminOnly, (req, res) => {
    upload.single("file")(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res.status(400).json({ error: uploadErr.message || "Upload failed." });
      }
      try {
        const { title, description } = req.body;
        if (!title || !title.trim()) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Title is required." });
        }
        if (!req.file) {
          return res.status(400).json({ error: "A file is required." });
        }

        const ext = path.extname(req.file.originalname);
        const result = await db.run(`
          INSERT INTO software_repo (title, description, file_path, file_name, file_type, file_size, uploaded_by, uploaded_by_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          title.trim(),
          (description || "").trim(),
          req.file.filename,
          req.file.originalname,
          fileTypeLabel(ext),
          req.file.size,
          req.user.id,
          req.user.name,
        ]);

        const item = await db.get("SELECT * FROM software_repo WHERE id = ?", [result.lastInsertRowid]);
        res.status(201).json(item);
      } catch (err) {
        console.error(err);
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // GET /api/software-repo/:id/download — admin only, authenticated stream
  router.get("/:id/download", authenticate, adminOnly, async (req, res) => {
    try {
      const item = await db.get("SELECT * FROM software_repo WHERE id = ?", [req.params.id]);
      if (!item) return res.status(404).json({ error: "File not found." });

      const fullPath = path.join(repoDir, item.file_path);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "This file no longer exists on the server." });

      res.download(fullPath, item.file_name);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // DELETE /api/software-repo/:id — admin only
  router.delete("/:id", authenticate, adminOnly, async (req, res) => {
    try {
      const item = await db.get("SELECT * FROM software_repo WHERE id = ?", [req.params.id]);
      if (!item) return res.status(404).json({ error: "File not found." });

      fs.unlink(path.join(repoDir, item.file_path), () => {});
      await db.run("DELETE FROM software_repo WHERE id = ?", [req.params.id]);
      res.json({ message: "File deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
