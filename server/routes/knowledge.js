const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate, adminOnly } = require("../auth");
const { moduleAccess } = require("../permissions");

// ── Multer config for knowledge reference documents ──────────────────────────
const docsDir = path.join(__dirname, "../../data/knowledge-docs");
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, docsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"];

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max — covers typical PDFs/PPTs
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error("Only PDF, Word, PowerPoint, and Excel files are allowed."));
    }
    cb(null, true);
  },
});

function fileTypeLabel(ext) {
  const map = {
    ".pdf": "PDF", ".doc": "Word", ".docx": "Word",
    ".ppt": "PowerPoint", ".pptx": "PowerPoint",
    ".xls": "Excel", ".xlsx": "Excel",
  };
  return map[ext] || ext.replace(".", "").toUpperCase();
}

module.exports = function knowledgeRoutes(db) {
  const router = express.Router();
  const canKnowledge = moduleAccess(db, "knowledge");

  // GET /api/knowledge — list all documents (any user granted the Knowledge
  // References module; admins always have it)
  router.get("/", authenticate, canKnowledge, async (req, res) => {
    try {
      const docs = await db.all(`
        SELECT k.*, COALESCE(u.name, k.uploaded_by_name, 'Unknown') AS uploaded_by_name
        FROM knowledge_docs k
        LEFT JOIN users u ON k.uploaded_by = u.id
        ORDER BY k.created_at DESC
      `);
      res.json(docs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // POST /api/knowledge — upload a new document (admin only)
  router.post("/", authenticate, adminOnly, (req, res) => {
    upload.single("file")(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res.status(400).json({ error: uploadErr.message || "File upload failed." });
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

        const ext = path.extname(req.file.originalname).toLowerCase();
        const result = await db.run(`
          INSERT INTO knowledge_docs (title, description, file_path, file_name, file_type, file_size, uploaded_by, uploaded_by_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          title.trim(),
          (description || "").trim(),
          `/knowledge-files/${req.file.filename}`,
          req.file.originalname,
          fileTypeLabel(ext),
          req.file.size,
          req.user.id,
          req.user.name,
        ]);

        const doc = await db.get("SELECT * FROM knowledge_docs WHERE id = ?", [result.lastInsertRowid]);
        res.status(201).json(doc);
      } catch (err) {
        console.error(err);
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // DELETE /api/knowledge/:id — admin only
  router.delete("/:id", authenticate, adminOnly, async (req, res) => {
    try {
      const doc = await db.get("SELECT * FROM knowledge_docs WHERE id = ?", [req.params.id]);
      if (!doc) return res.status(404).json({ error: "Document not found." });

      const filename = path.basename(doc.file_path);
      const fullPath = path.join(docsDir, filename);
      fs.unlink(fullPath, () => {}); // best-effort; ignore if already missing

      await db.run("DELETE FROM knowledge_docs WHERE id = ?", [req.params.id]);
      res.json({ message: "Document deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
