const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate } = require("../auth");

// ── Attachment storage ──────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "../../data/file-tracking-attachments");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const ALLOWED_EXT = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".rar", ".7z", ".txt",
];
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 }, // 50MB/file, up to 10 files per action
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error(`"${file.originalname}" is not an allowed file type.`));
    cb(null, true);
  },
});

function fileTypeLabel(ext) {
  const map = {
    ".jpg": "Image", ".jpeg": "Image", ".png": "Image", ".gif": "Image", ".webp": "Image",
    ".pdf": "PDF", ".doc": "Word", ".docx": "Word", ".xls": "Excel", ".xlsx": "Excel",
    ".ppt": "PowerPoint", ".pptx": "PowerPoint", ".zip": "Archive", ".rar": "Archive", ".7z": "Archive",
    ".txt": "Text",
  };
  const key = (ext || "").toLowerCase();
  return map[key] || (key ? key.replace(".", "").toUpperCase() : "File");
}

function handleUpload(req, res, cb) {
  upload.array("attachments", 10)(req, res, (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === "LIMIT_FILE_SIZE" ? "Each attachment must be 50MB or smaller."
        : uploadErr.code === "LIMIT_FILE_COUNT" ? "You can attach up to 10 files at once."
        : uploadErr.message || "File upload failed.";
      return res.status(400).json({ error: msg });
    }
    cb();
  });
}

function cleanupUploaded(files) {
  (files || []).forEach(f => fs.unlink(f.path, () => {}));
}

// ── File age: "2 Days" / "15 Days" / "2 Months" / "1 Year 3 Months" ─────────
function fileAge(createdDateStr) {
  const created = new Date(createdDateStr.replace(" ", "T") + "Z");
  const now = new Date();
  let days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  if (days < 0) days = 0;

  const colorBucket = days <= 7 ? "green" : days <= 15 ? "yellow" : days <= 30 ? "orange" : "red";

  let label;
  if (days <= 30) {
    label = `${days} Day${days === 1 ? "" : "s"}`;
  } else {
    let y = now.getFullYear() - created.getFullYear();
    let m = now.getMonth() - created.getMonth();
    if (now.getDate() < created.getDate()) m--;
    if (m < 0) { y--; m += 12; }
    label = y > 0
      ? `${y} Year${y === 1 ? "" : "s"}` + (m > 0 ? ` ${m} Month${m === 1 ? "" : "s"}` : "")
      : `${m} Month${m === 1 ? "" : "s"}`;
  }
  return { days, label, colorBucket };
}

function istToday() {
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const CLOSED_STATUSES = ["Completed", "Closed", "Cancelled"];
const MAX_PINS = 3;

module.exports = function fileTrackingRoutes(db) {
  const router = express.Router();

  // ── Statuses (dropdown source) ────────────────────────────────────────────
  router.get("/statuses", authenticate, async (req, res) => {
    try {
      const rows = await db.all("SELECT * FROM file_tracking_statuses WHERE is_active = 1 ORDER BY sort_order ASC");
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Dashboard stats ────────────────────────────────────────────────────────
  // Every count here is scoped to the requesting user's OWN files — this
  // module is private per creator (including admins), not an office-wide view.
  router.get("/stats", authenticate, async (req, res) => {
    try {
      const today = istToday();
      const [pending, inProgress, completed, overdue, mine, pinned] = await Promise.all([
        db.get("SELECT COUNT(*) AS cnt FROM file_tracking_tasks WHERE status = 'Pending' AND created_by = ?", [req.user.id]),
        db.get("SELECT COUNT(*) AS cnt FROM file_tracking_tasks WHERE status = 'In Progress' AND created_by = ?", [req.user.id]),
        db.get("SELECT COUNT(*) AS cnt FROM file_tracking_tasks WHERE status = 'Completed' AND created_by = ?", [req.user.id]),
        db.get(`SELECT COUNT(*) AS cnt FROM file_tracking_tasks WHERE due_date IS NOT NULL AND due_date < ? AND status NOT IN ('Completed','Closed','Cancelled') AND created_by = ?`, [today, req.user.id]),
        db.get("SELECT COUNT(*) AS cnt FROM file_tracking_tasks WHERE created_by = ?", [req.user.id]),
        db.get("SELECT COUNT(*) AS cnt FROM file_tracking_pins WHERE user_id = ?", [req.user.id]),
      ]);
      res.json({
        pending: pending.cnt, inProgress: inProgress.cnt, completed: completed.cnt,
        overdue: overdue.cnt, myFiles: mine.cnt, pinnedFiles: pinned.cnt,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── List (grid) — paginated, sortable, filterable ─────────────────────────
  router.get("/tasks", authenticate, async (req, res) => {
    try {
      const {
        page = 1, page_size = 25, sort_by = "last_updated", sort_dir = "desc",
        search, priority, status, department, quick,
      } = req.query;

      const SORTABLE = ["file_no", "reference_no", "subject", "current_holder", "department", "status", "priority", "created_date", "due_date", "last_updated", "file_age"];
      const sortCol = SORTABLE.includes(sort_by) ? sort_by : "last_updated";
      const sortDir = sort_dir === "asc" ? "ASC" : "DESC";
      const today = istToday();

      const conditions = [];
      const params = [];

      // This module is private per creator — everyone, including admins,
      // only ever sees files they registered themselves. This is always
      // applied, not just for the "mine" quick filter.
      conditions.push("t.created_by = ?");
      params.push(req.user.id);

      if (search) {
        conditions.push("(t.file_no LIKE ? OR t.reference_no LIKE ? OR t.subject LIKE ? OR t.current_holder LIKE ? OR t.department LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (priority) { conditions.push("t.priority = ?"); params.push(priority); }
      if (status)   { conditions.push("t.status = ?"); params.push(status); }
      if (department) { conditions.push("t.department = ?"); params.push(department); }

      if (quick === "pending") conditions.push("t.status = 'Pending'");
      else if (quick === "in-progress") conditions.push("t.status = 'In Progress'");
      else if (quick === "completed") conditions.push("t.status = 'Completed'");
      else if (quick === "overdue") { conditions.push("t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('Completed','Closed','Cancelled')"); params.push(today); }
      else if (quick === "today") { conditions.push("date(t.last_updated) = ?"); params.push(today); }
      else if (quick === "pinned") { conditions.push("p.user_id IS NOT NULL"); }
      // "mine" is now redundant with the mandatory filter above, but still
      // accepted as a no-op for backward compatibility with the frontend.

      const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(page_size, 10) || 25));
      const offset = (pageNum - 1) * pageSize;

      // Pinned rows always float to the top regardless of the requested sort.
      // "file_age" isn't a real column — it's derived from created_date, and
      // age runs opposite to created_date (the oldest created_date = the
      // highest age), so both the column and the direction are flipped here.
      const orderExpr = sortCol === "priority"
        ? "CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END"
        : sortCol === "file_age"
        ? "t.created_date"
        : `t.${sortCol}`;
      const orderDir = sortCol === "file_age" ? (sortDir === "ASC" ? "DESC" : "ASC") : sortDir;

      const fromClause = `
        FROM file_tracking_tasks t
        LEFT JOIN file_tracking_pins p ON p.task_id = t.id AND p.user_id = ?
        ${whereClause}
      `;
      const joinParams = [req.user.id, ...params];

      const rows = await db.all(`
        SELECT t.*, CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pinned
        ${fromClause}
        ORDER BY is_pinned DESC, ${orderExpr} ${orderDir}
        LIMIT ? OFFSET ?
      `, [...joinParams, pageSize, offset]);

      const totalRow = await db.get(`SELECT COUNT(*) AS cnt ${fromClause}`, joinParams);

      const withAge = rows.map(r => ({ ...r, file_age: fileAge(r.created_date) }));
      res.json({ rows: withAge, total: totalRow.cnt, page: pageNum, page_size: pageSize });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Single task detail: task + full movement history + attachments ───────
  router.get("/tasks/:id", authenticate, async (req, res) => {
    try {
      const t = await db.get("SELECT * FROM file_tracking_tasks WHERE id = ?", [req.params.id]);
      if (!t) return res.status(404).json({ error: "File not found." });
      if (t.created_by !== req.user.id) return res.status(404).json({ error: "File not found." });

      const pin = await db.get("SELECT id FROM file_tracking_pins WHERE task_id = ? AND user_id = ?", [req.params.id, req.user.id]);

      const updates = await db.all(
        "SELECT * FROM file_tracking_updates WHERE task_id = ? ORDER BY updated_at DESC, id DESC",
        [req.params.id]
      );
      const attachments = await db.all(
        "SELECT * FROM file_tracking_attachments WHERE task_id = ? ORDER BY uploaded_at ASC",
        [req.params.id]
      );
      const attachmentsByUpdate = {};
      const taskLevelAttachments = [];
      for (const a of attachments) {
        if (a.update_id) {
          (attachmentsByUpdate[a.update_id] ||= []).push(a);
        } else {
          taskLevelAttachments.push(a);
        }
      }
      const updatesWithFiles = updates.map(u => ({ ...u, attachments: attachmentsByUpdate[u.id] || [] }));

      res.json({
        ...t,
        file_age: fileAge(t.created_date),
        is_pinned: !!pin,
        updates: updatesWithFiles,
        attachments: taskLevelAttachments,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Create a new file/task — auto-creates the first "created" history entry ──
  router.post("/tasks", authenticate, (req, res) => {
    handleUpload(req, res, async () => {
      try {
        const { file_no, reference_no, subject, description, department, priority, status, current_holder, due_date } = req.body;
        if (!file_no || !file_no.trim() || !subject || !subject.trim() || !current_holder || !current_holder.trim()) {
          cleanupUploaded(req.files);
          return res.status(400).json({ error: "File No, Subject, and Current Holder are required." });
        }
        if (priority && !["Low", "Medium", "High"].includes(priority)) {
          cleanupUploaded(req.files);
          return res.status(400).json({ error: "Invalid priority." });
        }

        const existing = await db.get("SELECT id FROM file_tracking_tasks WHERE file_no = ? AND created_by = ?", [file_no.trim(), req.user.id]);
        if (existing) {
          cleanupUploaded(req.files);
          return res.status(409).json({ error: `You already have a file registered with File No "${file_no.trim()}".` });
        }

        const finalStatus = status || "Pending";
        const result = await db.run(`
          INSERT INTO file_tracking_tasks (file_no, reference_no, subject, description, department, priority, status, current_holder, created_by, created_by_name, due_date, last_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
          file_no.trim(), reference_no ? reference_no.trim() : "", subject.trim(),
          description ? description.trim() : "", department ? department.trim() : "",
          priority || "Medium", finalStatus, current_holder.trim(),
          req.user.id, req.user.name, due_date || null,
        ]);
        const taskId = result.lastInsertRowid;

        const updateResult = await db.run(`
          INSERT INTO file_tracking_updates (task_id, entry_type, remarks, previous_holder, current_holder, previous_status, status, due_date, updated_by, updated_by_name)
          VALUES (?, 'created', ?, '', ?, '', ?, ?, ?, ?)
        `, [taskId, "File created.", current_holder.trim(), finalStatus, due_date || null, req.user.id, req.user.name]);

        for (const f of (req.files || [])) {
          const ext = path.extname(f.originalname);
          await db.run(`
            INSERT INTO file_tracking_attachments (task_id, update_id, original_name, stored_name, file_size, file_type, uploaded_by, uploaded_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [taskId, updateResult.lastInsertRowid, f.originalname, f.filename, f.size, fileTypeLabel(ext), req.user.id, req.user.name]);
        }

        const created = await db.get("SELECT * FROM file_tracking_tasks WHERE id = ?", [taskId]);
        res.status(201).json({ ...created, file_age: fileAge(created.created_date), is_pinned: false });
      } catch (err) {
        console.error(err);
        cleanupUploaded(req.files);
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // ── Add a movement/status update — the core "Save Update" action ─────────
  router.post("/tasks/:id/updates", authenticate, (req, res) => {
    handleUpload(req, res, async () => {
      try {
        const existing = await db.get("SELECT * FROM file_tracking_tasks WHERE id = ?", [req.params.id]);
        if (!existing) {
          cleanupUploaded(req.files);
          return res.status(404).json({ error: "File not found." });
        }
        if (existing.created_by !== req.user.id) {
          cleanupUploaded(req.files);
          return res.status(404).json({ error: "File not found." });
        }

        const { remarks, current_holder, status, due_date, priority } = req.body;
        if (!current_holder || !current_holder.trim() || !status || !status.trim()) {
          cleanupUploaded(req.files);
          return res.status(400).json({ error: "Current Holder and Status are required." });
        }
        if (priority && !["Low", "Medium", "High"].includes(priority)) {
          cleanupUploaded(req.files);
          return res.status(400).json({ error: "Invalid priority." });
        }

        const newDueDate = due_date !== undefined && due_date !== "" ? due_date : existing.due_date;

        const updateResult = await db.run(`
          INSERT INTO file_tracking_updates (task_id, entry_type, remarks, previous_holder, current_holder, previous_status, status, due_date, updated_by, updated_by_name)
          VALUES (?, 'update', ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          req.params.id, remarks ? remarks.trim() : "",
          existing.current_holder, current_holder.trim(),
          existing.status, status.trim(),
          newDueDate, req.user.id, req.user.name,
        ]);

        for (const f of (req.files || [])) {
          const ext = path.extname(f.originalname);
          await db.run(`
            INSERT INTO file_tracking_attachments (task_id, update_id, original_name, stored_name, file_size, file_type, uploaded_by, uploaded_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [req.params.id, updateResult.lastInsertRowid, f.originalname, f.filename, f.size, fileTypeLabel(ext), req.user.id, req.user.name]);
        }

        await db.run(`
          UPDATE file_tracking_tasks SET
            current_holder = ?, status = ?, due_date = ?, priority = ?, last_updated = datetime('now')
          WHERE id = ?
        `, [current_holder.trim(), status.trim(), newDueDate, priority || existing.priority, req.params.id]);

        const updated = await db.get("SELECT * FROM file_tracking_tasks WHERE id = ?", [req.params.id]);
        res.status(201).json({ ...updated, file_age: fileAge(updated.created_date) });
      } catch (err) {
        console.error(err);
        cleanupUploaded(req.files);
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // ── Pin / Unpin (max 3 per user) ───────────────────────────────────────────
  router.post("/tasks/:id/pin", authenticate, async (req, res) => {
    try {
      const t = await db.get("SELECT id, created_by FROM file_tracking_tasks WHERE id = ?", [req.params.id]);
      if (!t || t.created_by !== req.user.id) return res.status(404).json({ error: "File not found." });

      const count = await db.get("SELECT COUNT(*) AS cnt FROM file_tracking_pins WHERE user_id = ?", [req.user.id]);
      if (count.cnt >= MAX_PINS) {
        return res.status(400).json({ error: "Maximum three pinned tasks allowed." });
      }
      await db.run("INSERT OR IGNORE INTO file_tracking_pins (user_id, task_id) VALUES (?, ?)", [req.user.id, req.params.id]);
      res.json({ message: "Pinned." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  router.delete("/tasks/:id/pin", authenticate, async (req, res) => {
    try {
      await db.run("DELETE FROM file_tracking_pins WHERE user_id = ? AND task_id = ?", [req.user.id, req.params.id]);
      res.json({ message: "Unpinned." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Attachment download (authenticated) ────────────────────────────────────
  router.get("/attachments/:id/download", authenticate, async (req, res) => {
    try {
      const a = await db.get(`
        SELECT a.*, t.created_by AS task_created_by
        FROM file_tracking_attachments a
        JOIN file_tracking_tasks t ON t.id = a.task_id
        WHERE a.id = ?
      `, [req.params.id]);
      if (!a || a.task_created_by !== req.user.id) return res.status(404).json({ error: "Attachment not found." });
      const fullPath = path.join(uploadsDir, a.stored_name);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File no longer exists on the server." });
      res.download(fullPath, a.original_name);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Inline view (no forced download — for PDF/image preview) ──────────────
  router.get("/attachments/:id/view", authenticate, async (req, res) => {
    try {
      const a = await db.get(`
        SELECT a.*, t.created_by AS task_created_by
        FROM file_tracking_attachments a
        JOIN file_tracking_tasks t ON t.id = a.task_id
        WHERE a.id = ?
      `, [req.params.id]);
      if (!a || a.task_created_by !== req.user.id) return res.status(404).json({ error: "Attachment not found." });
      const fullPath = path.join(uploadsDir, a.stored_name);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File no longer exists on the server." });
      res.sendFile(fullPath);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Delete a file entirely (admin only) ────────────────────────────────────
  // Only the creator can delete their own file record — this module is
  // private, so there's no admin override here.
  router.delete("/tasks/:id", authenticate, async (req, res) => {
    try {
      const t = await db.get("SELECT id, created_by FROM file_tracking_tasks WHERE id = ?", [req.params.id]);
      if (!t || t.created_by !== req.user.id) return res.status(404).json({ error: "File not found." });

      const attachments = await db.all("SELECT stored_name FROM file_tracking_attachments WHERE task_id = ?", [req.params.id]);
      attachments.forEach(a => fs.unlink(path.join(uploadsDir, a.stored_name), () => {}));

      await db.run("DELETE FROM file_tracking_tasks WHERE id = ?", [req.params.id]);
      res.json({ message: "File deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
