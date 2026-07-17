const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate } = require("../auth");

// ── Storage for shared files ────────────────────────────────────────────────
// NOT served statically (unlike task attachments) — every download goes
// through the authenticated /:id/download route below, since these files
// are private between exactly two people, not general-purpose attachments.
const uploadsDir = path.join(__dirname, "../../data/shared-files");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_SIZE = 200 * 1024 * 1024; // 200MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: MAX_SIZE } });

function fileTypeLabel(ext) {
  const map = {
    ".jpg": "Image", ".jpeg": "Image", ".png": "Image", ".gif": "Image", ".webp": "Image",
    ".pdf": "PDF", ".doc": "Word", ".docx": "Word", ".ppt": "PowerPoint", ".pptx": "PowerPoint",
    ".xls": "Excel", ".xlsx": "Excel", ".zip": "Archive", ".rar": "Archive", ".7z": "Archive",
    ".txt": "Text", ".csv": "CSV", ".mp4": "Video", ".mov": "Video", ".mp3": "Audio", ".wav": "Audio",
  };
  const key = (ext || "").toLowerCase();
  return map[key] || (key ? key.replace(".", "").toUpperCase() : "File");
}

module.exports = function fileSharingRoutes(db) {
  const router = express.Router();

  function canAccess(row, user) {
    return row.sender_id === user.id || row.recipient_id === user.id;
  }

  const getFilesQuery = `
    SELECT sf.id, sf.sender_id, sf.recipient_id, sf.file_name, sf.file_size, sf.file_type,
           sf.message, sf.downloaded_at, sf.created_at, sf.expires_at,
           COALESCE(su.name, sf.sender_name, 'Deleted User') AS sender_name,
           COALESCE(ru.name, sf.recipient_name, 'Deleted User') AS recipient_name
    FROM shared_files sf
    LEFT JOIN users su ON sf.sender_id = su.id
    LEFT JOIN users ru ON sf.recipient_id = ru.id
  `;

  // GET /api/file-sharing — everything I've sent or received. Never
  // includes anyone else's files, even for admins — this is private
  // person-to-person data, not an IT-admin-managed resource.
  router.get("/", authenticate, async (req, res) => {
    try {
      const rows = await db.all(
        `${getFilesQuery} WHERE sf.sender_id = ? OR sf.recipient_id = ? ORDER BY sf.created_at DESC`,
        [req.user.id, req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // POST /api/file-sharing — share a file with another user (up to 200MB)
  router.post("/", authenticate, (req, res) => {
    upload.single("file")(req, res, async (uploadErr) => {
      if (uploadErr) {
        const msg = uploadErr.code === "LIMIT_FILE_SIZE"
          ? "That file is too large — the limit is 200MB."
          : uploadErr.message || "Upload failed.";
        return res.status(400).json({ error: msg });
      }
      try {
        if (!req.file) return res.status(400).json({ error: "Please choose a file to share." });

        const { recipient_id, message } = req.body;
        if (!recipient_id) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Please choose who to share this with." });
        }

        const recipient = await db.get("SELECT id, name FROM users WHERE id = ?", [recipient_id]);
        if (!recipient) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Selected recipient not found." });
        }
        if (recipient.id === req.user.id) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "You can't share a file with yourself." });
        }

        const ext = path.extname(req.file.originalname);
        const result = await db.run(`
          INSERT INTO shared_files (sender_id, sender_name, recipient_id, recipient_name, file_name, file_path, file_size, file_type, message, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+3 days'))
        `, [
          req.user.id, req.user.name,
          recipient.id, recipient.name,
          req.file.originalname, req.file.filename, req.file.size, fileTypeLabel(ext),
          message ? message.trim() : "",
        ]);

        const created = await db.get(`${getFilesQuery} WHERE sf.id = ?`, [result.lastInsertRowid]);
        res.status(201).json(created);
      } catch (err) {
        console.error(err);
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // GET /api/file-sharing/:id/download — only the sender or recipient can
  // fetch the actual bytes. Marks downloaded_at the first time the
  // recipient downloads it (informational — doesn't delete automatically;
  // the recipient still has to delete it themselves, or it expires in 3 days).
  router.get("/:id/download", authenticate, async (req, res) => {
    try {
      const row = await db.get("SELECT * FROM shared_files WHERE id = ?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "This file isn't available anymore — it may have been deleted or expired." });
      if (!canAccess(row, req.user)) return res.status(403).json({ error: "Access denied." });

      const fullPath = path.join(uploadsDir, row.file_path);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "This file no longer exists on the server." });

      if (row.recipient_id === req.user.id && !row.downloaded_at) {
        await db.run("UPDATE shared_files SET downloaded_at = datetime('now') WHERE id = ?", [req.params.id]);
      }
      res.download(fullPath, row.file_name);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // DELETE /api/file-sharing/:id — either party can delete (the recipient
  // deleting after download is the whole point — frees server storage).
  router.delete("/:id", authenticate, async (req, res) => {
    try {
      const row = await db.get("SELECT * FROM shared_files WHERE id = ?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "File not found." });
      if (!canAccess(row, req.user)) return res.status(403).json({ error: "Access denied." });

      fs.unlink(path.join(uploadsDir, row.file_path), () => {});
      await db.run("DELETE FROM shared_files WHERE id = ?", [req.params.id]);
      res.json({ message: "File deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};

// Background sweep: anything past its 3-day expiry gets removed even if
// nobody ever downloaded or deleted it, so shared files can't quietly pile
// up on the server. Runs once at startup, then hourly.
module.exports.startCleanupJob = function startCleanupJob(db) {
  async function sweep() {
    try {
      const expired = await db.all("SELECT * FROM shared_files WHERE expires_at <= datetime('now')");
      for (const row of expired) {
        fs.unlink(path.join(uploadsDir, row.file_path), () => {});
        await db.run("DELETE FROM shared_files WHERE id = ?", [row.id]);
      }
      if (expired.length) console.log(`File Sharing cleanup: removed ${expired.length} expired file(s).`);
    } catch (err) {
      console.error("File Sharing cleanup error:", err);
    }
  }
  sweep();
  setInterval(sweep, 60 * 60 * 1000); // hourly
};
