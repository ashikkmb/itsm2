const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate, adminOnly } = require("../auth");
const sse = require("../sse");
const { canAccessTask, isPrivateTask, getTaskQuery, getCommentsQuery } = require("../taskAccess");

// ── Multer config for optional task/comment attachments ─────────────────────
const uploadsDir = path.join(__dirname, "../../data/task-files");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"];

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — covers typical office docs/PDFs/photos
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error("Only images, PDF, Word, Excel, and PowerPoint files are allowed."));
    }
    cb(null, true);
  },
});

function fileTypeLabel(ext) {
  const map = {
    ".jpg": "Image", ".jpeg": "Image", ".png": "Image", ".gif": "Image", ".webp": "Image",
    ".pdf": "PDF", ".doc": "Word", ".docx": "Word",
    ".ppt": "PowerPoint", ".pptx": "PowerPoint",
    ".xls": "Excel", ".xlsx": "Excel",
  };
  return map[ext] || ext.replace(".", "").toUpperCase();
}

function handleUpload(req, res, cb) {
  upload.single("attachment")(req, res, (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === "LIMIT_FILE_SIZE"
        ? "The attached file must be smaller than 15MB."
        : uploadErr.message || "File upload failed.";
      return res.status(400).json({ error: msg });
    }
    cb();
  });
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Today's date as YYYY-MM-DD in IST, so "due today" always matches the
// organization's local calendar day regardless of the server's own timezone.
function istToday() {
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = function taskRoutes(db) {
  const router = express.Router();

  // getTaskQuery, getCommentsQuery, canAccessTask, and isPrivateTask now
  // live in ../taskAccess so routes/wopi.js can enforce the identical
  // "who can see/act on this task" rule for Word-file editing — see that
  // file for the (unchanged) logic and comments.

  // ── List ─────────────────────────────────────────────────────────────────
  router.get("/", authenticate, async (req, res) => {
    try {
      const { status, assignee_type, assigned_to, search } = req.query;
      let query = getTaskQuery;
      const params = [];
      const conditions = [];

      if (req.user.role !== "admin") {
        conditions.push("t.assignee_type = 'user' AND t.assigned_to = ?");
        params.push(req.user.id);
      } else {
        // Admins see everything EXCEPT another user's private, self-created
        // personal task (assigned_to = assigned_by, and it's not the admin's
        // own account). A task the admin actually assigned to someone stays
        // visible as before, since assigned_by there is the admin, not the user.
        conditions.push("NOT (t.assignee_type = 'user' AND t.assigned_to = t.assigned_by AND t.assigned_to != ?)");
        params.push(req.user.id);
        if (assignee_type && assignee_type !== "All") {
          conditions.push("t.assignee_type = ?");
          params.push(assignee_type);
        }
        if (assigned_to && assigned_to !== "All") {
          conditions.push("t.assigned_to = ?");
          params.push(assigned_to);
        }
      }
      if (status && status !== "All") {
        conditions.push("t.status = ?");
        params.push(status);
      }
      if (search) {
        conditions.push("t.title LIKE ?");
        params.push(`%${search}%`);
      }

      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY (t.status = 'Completed'), t.due_date ASC, t.id DESC";

      res.json(await db.all(query, params));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/tasks/due — due today or overdue, not completed. Admins see
  // every task; everyone else sees only tasks assigned to their own account.
  router.get("/due", authenticate, async (req, res) => {
    try {
      const today = istToday();
      let query = `${getTaskQuery} WHERE t.status != 'Completed' AND t.due_date <= ?`;
      const params = [today];
      if (req.user.role !== "admin") {
        query += " AND t.assignee_type = 'user' AND t.assigned_to = ?";
        params.push(req.user.id);
      } else {
        query += " AND NOT (t.assignee_type = 'user' AND t.assigned_to = t.assigned_by AND t.assigned_to != ?)";
        params.push(req.user.id);
      }
      query += " ORDER BY t.due_date ASC";
      res.json(await db.all(query, params));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/tasks/:id
  router.get("/:id", authenticate, async (req, res) => {
    try {
      const t = await db.get(getTaskQuery + " WHERE t.id = ?", [req.params.id]);
      if (!t) return res.status(404).json({ error: "Task not found." });
      if (!canAccessTask(t, req.user))
        return res.status(403).json({ error: "Access denied." });
      res.json(t);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // POST /api/tasks — create/assign a task, with an optional file attachment
  // (image, PDF, or an MS Office document — jpg/png/gif/webp/pdf/doc(x)/ppt(x)/xls(x)).
  //
  // Admins may:
  //   assignee_type: 'user'  + assigned_to: <user id>   → assign to one account
  //   assignee_type: 'user'  + assigned_to: 'ALL'       → assign to every local & domain user
  //   assignee_type: 'staff' + assigned_to: <staff id>  → assign to a named IT staff member
  //
  // Non-admins always get a personal task: assignee_type is forced to
  // 'user' and assigned_to is forced to their own id, regardless of what's
  // in the request body (there's no "assign to" field in their UI at all).
  router.post("/", authenticate, (req, res) => {
    handleUpload(req, res, async () => {
      try {
        const { title, description, priority, due_date } = req.body;
        if (!title || !due_date) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Title and due date are required." });
        }

        const validPris = ["Low", "Medium", "High", "Critical"];
        if (priority && !validPris.includes(priority)) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Invalid priority." });
        }

        const isAdmin = req.user.role === "admin";
        const assigneeType = isAdmin && req.body.assignee_type === "staff" ? "staff" : "user";
        const cleanTitle = capitalizeFirst(title.trim());
        const cleanDesc = description ? capitalizeFirst(description.trim()) : "";

        // Attachment fields, shared across every row inserted for this
        // request (relevant for the "assign to all users" bulk case below —
        // one physical file, referenced by every created task).
        const att = req.file
          ? {
              path: `/task-files/${req.file.filename}`,
              name: req.file.originalname,
              size: req.file.size,
              type: fileTypeLabel(path.extname(req.file.originalname).toLowerCase()),
            }
          : null;

        // ── Self-assigned personal task (any non-admin, or an admin who just
        //    picked "myself") ────────────────────────────────────────────────
        if (!isAdmin || (assigneeType === "user" && Number(req.body.assigned_to) === req.user.id)) {
          const result = await db.run(`
            INSERT INTO tasks (title, description, assignee_type, assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, due_date, attachment_path, attachment_name, attachment_size, attachment_type, updated_at)
            VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `, [cleanTitle, cleanDesc, req.user.id, req.user.name, req.user.id, req.user.name, priority || "Medium", due_date, att?.path || null, att?.name || null, att?.size || null, att?.type || null]);
          return res.status(201).json(await db.get(getTaskQuery + " WHERE t.id = ?", [result.lastInsertRowid]));
        }

        if (!isAdmin) return res.status(403).json({ error: "Access denied." }); // safety net, shouldn't reach here

        // ── Admin: assign to an IT staff member by name ─────────────────────
        if (assigneeType === "staff") {
          const staff = await db.get("SELECT id, name FROM it_staff WHERE id = ? AND active = 1", [req.body.assigned_to]);
          if (!staff) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: "Selected IT staff member not found. Add them to the staff list first." });
          }

          const result = await db.run(`
            INSERT INTO tasks (title, description, assignee_type, assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, due_date, attachment_path, attachment_name, attachment_size, attachment_type, updated_at)
            VALUES (?, ?, 'staff', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `, [cleanTitle, cleanDesc, staff.id, staff.name, req.user.id, req.user.name, priority || "Medium", due_date, att?.path || null, att?.name || null, att?.size || null, att?.type || null]);

          const task = await db.get(getTaskQuery + " WHERE t.id = ?", [result.lastInsertRowid]);
          sse.broadcast("new-task", { id: task.id, title: task.title, due_date: task.due_date, priority: task.priority, assignee_type: "staff", assigned_to_name: task.assigned_to_name, assigned_by_name: task.assigned_by_name });
          return res.status(201).json(task);
        }

        // ── Admin: assign to every local & domain user account ──────────────
        if (req.body.assigned_to === "ALL") {
          const allUsers = await db.all("SELECT id, name FROM users");
          if (!allUsers.length) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: "No user accounts to assign to." });
          }

          const created = [];
          for (const u of allUsers) {
            const result = await db.run(`
              INSERT INTO tasks (title, description, assignee_type, assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, due_date, attachment_path, attachment_name, attachment_size, attachment_type, updated_at)
              VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `, [cleanTitle, cleanDesc, u.id, u.name, req.user.id, req.user.name, priority || "Medium", due_date, att?.path || null, att?.name || null, att?.size || null, att?.type || null]);
            const task = await db.get(getTaskQuery + " WHERE t.id = ?", [result.lastInsertRowid]);
            created.push(task);
            sse.broadcast("new-task", { id: task.id, title: task.title, due_date: task.due_date, priority: task.priority, assignee_type: "user", assigned_to: u.id, assigned_to_name: task.assigned_to_name, assigned_by_name: task.assigned_by_name });
          }
          return res.status(201).json({ message: `Task assigned to all ${created.length} user accounts.`, tasks: created });
        }

        // ── Admin: assign to a single user account ───────────────────────────
        const user = await db.get("SELECT id, name FROM users WHERE id = ?", [req.body.assigned_to]);
        if (!user) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: "Selected user account not found." });
        }

        const result = await db.run(`
          INSERT INTO tasks (title, description, assignee_type, assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, due_date, attachment_path, attachment_name, attachment_size, attachment_type, updated_at)
          VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [cleanTitle, cleanDesc, user.id, user.name, req.user.id, req.user.name, priority || "Medium", due_date, att?.path || null, att?.name || null, att?.size || null, att?.type || null]);

        const task = await db.get(getTaskQuery + " WHERE t.id = ?", [result.lastInsertRowid]);
        sse.broadcast("new-task", { id: task.id, title: task.title, due_date: task.due_date, priority: task.priority, assignee_type: "user", assigned_to: user.id, assigned_to_name: task.assigned_to_name, assigned_by_name: task.assigned_by_name });
        res.status(201).json(task);
      } catch (err) {
        console.error(err);
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  // PATCH /api/tasks/:id — edit details / reassign. Admins can edit any
  // task including reassignment; a non-admin can only edit a task they
  // both created and are assigned to (their own personal task — a task an
  // admin assigned to them can only have its status changed, not its
  // details, by that non-admin). Attachments aren't editable here — add a
  // comment with a new file instead.
  router.patch("/:id", authenticate, async (req, res) => {
    try {
      const existing = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Task not found." });

      const isAdmin = req.user.role === "admin";
      const isOwnPersonalTask = existing.assignee_type === "user" && existing.assigned_to === req.user.id && existing.assigned_by === req.user.id;
      const blockedFromAdmin = isAdmin && isPrivateTask(existing) && existing.assigned_to !== req.user.id;
      if (!isOwnPersonalTask && (!isAdmin || blockedFromAdmin)) return res.status(403).json({ error: "Access denied." });

      const { title, description, priority, due_date } = req.body;
      const validPris = ["Low", "Medium", "High", "Critical"];
      if (priority && !validPris.includes(priority))
        return res.status(400).json({ error: "Invalid priority." });

      let assigneeType = existing.assignee_type;
      let assignedTo = existing.assigned_to;
      let assignedToName = existing.assigned_to_name;

      // Only an admin may reassign a task to someone/something else.
      if (isAdmin && req.body.assignee_type && req.body.assigned_to) {
        if (req.body.assignee_type === "staff") {
          const staff = await db.get("SELECT id, name FROM it_staff WHERE id = ?", [req.body.assigned_to]);
          if (!staff) return res.status(400).json({ error: "Selected IT staff member not found." });
          assigneeType = "staff"; assignedTo = staff.id; assignedToName = staff.name;
        } else {
          const user = await db.get("SELECT id, name FROM users WHERE id = ?", [req.body.assigned_to]);
          if (!user) return res.status(400).json({ error: "Selected user account not found." });
          assigneeType = "user"; assignedTo = user.id; assignedToName = user.name;
        }
      }

      await db.run(`
        UPDATE tasks SET
          title = ?, description = ?, assignee_type = ?, assigned_to = ?, assigned_to_name = ?,
          priority = ?, due_date = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [
        title ? capitalizeFirst(title.trim()) : existing.title,
        description !== undefined ? capitalizeFirst(description.trim()) : existing.description,
        assigneeType, assignedTo, assignedToName,
        priority || existing.priority,
        due_date || existing.due_date,
        req.params.id,
      ]);

      res.json(await db.get(getTaskQuery + " WHERE t.id = ?", [req.params.id]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // PATCH /api/tasks/:id/status — the assigned user, or admin, can update status
  router.patch("/:id/status", authenticate, async (req, res) => {
    try {
      const { status } = req.body;
      if (!["Pending", "In Progress", "Completed"].includes(status))
        return res.status(400).json({ error: "Invalid status." });

      const t = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
      if (!t) return res.status(404).json({ error: "Task not found." });
      if (!canAccessTask(t, req.user))
        return res.status(403).json({ error: "Access denied." });

      const completedAt = status === "Completed" ? "datetime('now')" : "NULL";
      await db.run(`
        UPDATE tasks SET status = ?, completed_at = ${completedAt}, updated_at = datetime('now') WHERE id = ?
      `, [status, req.params.id]);

      res.json(await db.get(getTaskQuery + " WHERE t.id = ?", [req.params.id]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // DELETE /api/tasks/:id — admin can delete any task; a non-admin can only
  // delete their own self-created personal task. Also removes the task's
  // own attachment and every comment attachment's physical file.
  router.delete("/:id", authenticate, async (req, res) => {
    try {
      const t = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
      if (!t) return res.status(404).json({ error: "Task not found." });

      const isAdmin = req.user.role === "admin";
      const isOwnPersonalTask = t.assignee_type === "user" && t.assigned_to === req.user.id && t.assigned_by === req.user.id;
      const blockedFromAdmin = isAdmin && isPrivateTask(t) && t.assigned_to !== req.user.id;
      if (!isOwnPersonalTask && (!isAdmin || blockedFromAdmin)) return res.status(403).json({ error: "Access denied." });

      // Comment attachments are always unique per upload, so always safe to
      // remove. The task's own attachment, however, can be shared across
      // several rows when it came from an "assign to all users" bulk
      // creation — only delete the physical file once nothing else points
      // at it, or a sibling task would lose its attachment.
      const commentFiles = await db.all("SELECT attachment_path FROM task_comments WHERE task_id = ? AND attachment_path IS NOT NULL", [req.params.id]);
      commentFiles.forEach(c => fs.unlink(path.join(uploadsDir, path.basename(c.attachment_path)), () => {}));

      if (t.attachment_path) {
        const stillUsed = await db.get("SELECT COUNT(*) AS cnt FROM tasks WHERE attachment_path = ? AND id != ?", [t.attachment_path, req.params.id]);
        if (!stillUsed || stillUsed.cnt === 0) {
          fs.unlink(path.join(uploadsDir, path.basename(t.attachment_path)), () => {});
        }
      }

      await db.run("DELETE FROM tasks WHERE id = ?", [req.params.id]);
      res.json({ message: "Task deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // ── Comments — visible/addable by the task's owner, its creator, or any
  // admin. A comment can be text, a file attachment, or both (at least one
  // is required).
  router.get("/:id/comments", authenticate, async (req, res) => {
    try {
      const t = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
      if (!t) return res.status(404).json({ error: "Task not found." });
      if (!canAccessTask(t, req.user))
        return res.status(403).json({ error: "Access denied." });

      const comments = await db.all(`${getCommentsQuery} WHERE c.task_id = ? ORDER BY c.created_at ASC, c.id ASC`, [req.params.id]);
      res.json(comments);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  router.post("/:id/comments", authenticate, (req, res) => {
    handleUpload(req, res, async () => {
      try {
        const comment = (req.body.comment || "").trim();
        if (!comment && !req.file) {
          return res.status(400).json({ error: "Add some text or attach a file." });
        }

        const t = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
        if (!t) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(404).json({ error: "Task not found." });
        }
        if (!canAccessTask(t, req.user)) {
          if (req.file) fs.unlink(req.file.path, () => {});
          return res.status(403).json({ error: "Access denied." });
        }

        const att = req.file
          ? {
              path: `/task-files/${req.file.filename}`,
              name: req.file.originalname,
              size: req.file.size,
              type: fileTypeLabel(path.extname(req.file.originalname).toLowerCase()),
            }
          : null;

        const result = await db.run(
          "INSERT INTO task_comments (task_id, author_id, author_name, comment, attachment_path, attachment_name, attachment_size, attachment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [req.params.id, req.user.id, req.user.name, comment, att?.path || null, att?.name || null, att?.size || null, att?.type || null]
        );
        const created = await db.get(`${getCommentsQuery} WHERE c.id = ?`, [result.lastInsertRowid]);

        // Notify the other party in the conversation (owner <-> creator) instantly.
        sse.broadcast("task-comment", { task_id: Number(req.params.id), task_title: t.title, author_id: req.user.id, author_name: req.user.name, assignee_type: t.assignee_type, assigned_to: t.assignee_type === "user" ? t.assigned_to : null, assigned_by: t.assigned_by });

        res.status(201).json(created);
      } catch (err) {
        console.error(err);
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: "Server error." });
      }
    });
  });

  return router;
};
