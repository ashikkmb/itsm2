// ── WOPI host for Word attachments on Tasks ──────────────────────────────────
// Implements the small slice of the MS-WOPI protocol that Word desktop needs
// to open a file directly from a link and save changes straight back to this
// server: CheckFileInfo, GetFile, Lock/Unlock/RefreshLock, and PutFile.
//
// A WOPI "file_id" here is a composite string, not a real files-table row —
// "t42" means the attachment on tasks.id = 42; "c187" means the attachment
// on task_comments.id = 187. This lets Word-editing slot in on top of the
// existing attachment_path columns without a schema rework.
//
// Access rule: identical to the rest of the Tasks module. Whoever created
// the task, whoever it's assigned to, or an admin (except on someone else's
// private personal task) can both view AND edit — there's no separate
// read-only tier, per how this module's permissions already work.

const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { JWT_SECRET } = require("../auth");
const { canAccessTask } = require("../taskAccess");
const sse = require("../sse");

const taskFilesDir = path.join(__dirname, "../../data/task-files");
const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes, refreshed by Word while the doc stays open

// WOPI always sends the token as a query parameter (?access_token=...),
// never an Authorization header — desktop Word isn't your browser, so it
// can't reuse the app's normal auth flow. Verifies the same JWT your
// regular `authenticate` middleware does.
async function wopiAuth(req, res, next) {
  const token = req.query.access_token;
  if (!token) return res.status(401).end();
  try {
    req.wopiUser = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).end();
  }
}

module.exports = function wopiRoutes(db) {
  const router = express.Router();

  // Resolve a WOPI file_id to its row, its table name, and the parent task
  // (every access check runs against the parent task, whether the
  // attachment lives on the task itself or on one of its comments).
  async function resolveFile(fileId) {
    const kind = fileId[0];
    const rowId = fileId.slice(1);

    if (kind === "t") {
      const task = await db.get("SELECT * FROM tasks WHERE id = ?", [rowId]);
      if (!task || !task.attachment_path) return null;
      return { table: "tasks", row: task, task };
    }
    if (kind === "c") {
      const comment = await db.get("SELECT * FROM task_comments WHERE id = ?", [rowId]);
      if (!comment || !comment.attachment_path) return null;
      const task = await db.get("SELECT * FROM tasks WHERE id = ?", [comment.task_id]);
      if (!task) return null;
      return { table: "task_comments", row: comment, task };
    }
    return null;
  }

  // Mirrors auth.js's authenticate(): re-reads role from the DB rather than
  // trusting whatever role was baked into the JWT at login time, so a
  // demotion takes effect immediately here too.
  async function currentDbUser(wopiUser) {
    return db.get("SELECT id, name, role FROM users WHERE id = ?", [wopiUser.id]);
  }

  function absPathFor(row) {
    return path.join(taskFilesDir, path.basename(row.attachment_path));
  }

  async function getActiveLock(fileId) {
    const existing = await db.get("SELECT * FROM wopi_locks WHERE file_id = ?", [fileId]);
    if (!existing) return null;
    return new Date(existing.expires_at).getTime() > Date.now() ? existing : null;
  }

  // ── CheckFileInfo — Word calls this first to learn the filename, size,
  //    who's editing, and whether they can write to it. ──────────────────────
  router.get("/files/:fileId", wopiAuth, async (req, res) => {
    const resolved = await resolveFile(req.params.fileId);
    if (!resolved) return res.status(404).end();

    const dbUser = await currentDbUser(req.wopiUser);
    if (!dbUser) return res.status(401).end();
    if (!canAccessTask(resolved.task, dbUser)) return res.status(403).end();

    let size;
    try {
      size = fs.statSync(absPathFor(resolved.row)).size;
    } catch {
      return res.status(404).end();
    }

    res.json({
      BaseFileName: resolved.row.attachment_name,
      Size: size,
      OwnerId: String(resolved.task.assigned_by ?? resolved.task.assigned_to ?? "0"),
      UserId: String(dbUser.id),
      UserFriendlyName: dbUser.name,
      Version: String(resolved.row.attachment_version || 1),
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsUpdate: true,
      UserCanWrite: true,   // reaching this line already means canAccessTask passed
      ReadOnly: false,
    });
  });

  // ── GetFile — Word downloads the current bytes. ─────────────────────────────
  router.get("/files/:fileId/contents", wopiAuth, async (req, res) => {
    const resolved = await resolveFile(req.params.fileId);
    if (!resolved) return res.status(404).end();

    const dbUser = await currentDbUser(req.wopiUser);
    if (!dbUser) return res.status(401).end();
    if (!canAccessTask(resolved.task, dbUser)) return res.status(403).end();

    const absPath = absPathFor(resolved.row);
    if (!fs.existsSync(absPath)) return res.status(404).end();

    res.setHeader("Content-Type", "application/octet-stream");
    fs.createReadStream(absPath).pipe(res);
  });

  // ── Lock / Unlock / RefreshLock / GetLock — dispatched by the
  //    X-WOPI-Override header, all on the same URL per spec. ────────────────
  router.post("/files/:fileId", wopiAuth, async (req, res) => {
    const resolved = await resolveFile(req.params.fileId);
    if (!resolved) return res.status(404).end();

    const dbUser = await currentDbUser(req.wopiUser);
    if (!dbUser) return res.status(401).end();
    if (!canAccessTask(resolved.task, dbUser)) return res.status(403).end();

    const fileId = req.params.fileId;
    const action = req.headers["x-wopi-override"];
    const lockId = req.headers["x-wopi-lock"];
    const activeLock = await getActiveLock(fileId);

    if (action === "LOCK") {
      if (activeLock && activeLock.lock_id !== lockId) {
        res.set("X-WOPI-Lock", activeLock.lock_id);
        return res.status(409).end();
      }
      const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
      if (activeLock) {
        await db.run("UPDATE wopi_locks SET lock_id = ?, locked_by = ?, expires_at = ? WHERE file_id = ?", [lockId, dbUser.id, expiresAt, fileId]);
      } else {
        await db.run(
          "INSERT INTO wopi_locks (file_id, lock_id, locked_by, expires_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(file_id) DO UPDATE SET lock_id = excluded.lock_id, locked_by = excluded.locked_by, expires_at = excluded.expires_at",
          [fileId, lockId, dbUser.id, expiresAt]
        );
      }
      return res.status(200).end();
    }

    if (action === "UNLOCK") {
      if (activeLock && activeLock.lock_id !== lockId) {
        res.set("X-WOPI-Lock", activeLock.lock_id);
        return res.status(409).end();
      }
      await db.run("DELETE FROM wopi_locks WHERE file_id = ?", [fileId]);
      return res.status(200).end();
    }

    if (action === "REFRESH_LOCK") {
      if (!activeLock || activeLock.lock_id !== lockId) {
        res.set("X-WOPI-Lock", activeLock ? activeLock.lock_id : "");
        return res.status(409).end();
      }
      await db.run("UPDATE wopi_locks SET expires_at = ? WHERE file_id = ?", [new Date(Date.now() + LOCK_TTL_MS).toISOString(), fileId]);
      return res.status(200).end();
    }

    if (action === "GET_LOCK") {
      res.set("X-WOPI-Lock", activeLock ? activeLock.lock_id : "");
      return res.status(200).end();
    }

    return res.status(501).end();
  });

  // ── PutFile — the actual save-back from Word's Ctrl+S. ──────────────────────
  // Note: no express.json()/urlencoded() parsing applies here since Word
  // sends a raw octet-stream body with no matching Content-Type — those
  // global middlewares in index.js no-op for this route and leave the
  // request stream untouched, which is what lets the manual read below work.
  router.post("/files/:fileId/contents", wopiAuth, async (req, res) => {
    const resolved = await resolveFile(req.params.fileId);
    if (!resolved) return res.status(404).end();

    const dbUser = await currentDbUser(req.wopiUser);
    if (!dbUser) return res.status(401).end();
    if (!canAccessTask(resolved.task, dbUser)) return res.status(403).end();

    const fileId = req.params.fileId;
    const lockId = req.headers["x-wopi-lock"];
    const activeLock = await getActiveLock(fileId);
    if (activeLock && activeLock.lock_id !== lockId) {
      res.set("X-WOPI-Lock", activeLock.lock_id);
      return res.status(409).end();
    }

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("error", () => res.status(500).end());
    req.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(absPathFor(resolved.row), buffer);

        // resolved.table is always one of our own two hardcoded strings
        // ("tasks" or "task_comments") — never derived from request input —
        // so interpolating it into the query here is safe.
        await db.run(
          `UPDATE ${resolved.table} SET
             attachment_version = attachment_version + 1,
             attachment_edited_by = ?,
             attachment_edited_by_name = ?,
             attachment_edited_at = datetime('now')
           WHERE id = ?`,
          [dbUser.id, dbUser.name, resolved.row.id]
        );

        // Reuses the same event the comment-post route already broadcasts,
        // so the other party's task view refreshes live the moment a
        // correction is saved from Word — no new client-side listener needed.
        sse.broadcast("task-comment", {
          task_id: resolved.task.id,
          task_title: resolved.task.title,
          author_id: dbUser.id,
          author_name: dbUser.name,
          assignee_type: resolved.task.assignee_type,
          assigned_to: resolved.task.assignee_type === "user" ? resolved.task.assigned_to : null,
          assigned_by: resolved.task.assigned_by,
        });

        res.status(200).end();
      } catch (err) {
        console.error("WOPI PutFile error:", err);
        res.status(500).end();
      }
    });
  });

  return router;
};
