const express = require("express");
const { authenticate } = require("../auth");
const { MODULE_KEYS } = require("../permissions");

function istToday() {
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = function dashboardRoutes(db) {
  const router = express.Router();

  // GET /api/dashboard/summary — one call, one JSON blob with a section per
  // module the caller actually has access to (admins get all of them).
  // This is what the landing-page Dashboard renders its widgets from.
  router.get("/summary", authenticate, async (req, res) => {
    try {
      const isAdmin = req.user.role === "admin";
      const uid = req.user.id;
      const modules = isAdmin
        ? MODULE_KEYS
        : (await db.all("SELECT module_key FROM user_modules WHERE user_id = ?", [uid])).map(r => r.module_key);

      const summary = {};

      // ── Complaints — status split, category split, 14-day trend ──────────
      if (modules.includes("complaints")) {
        const where  = isAdmin ? "" : "WHERE c.user_id = ?";
        const params = isAdmin ? [] : [uid];
        const andor  = isAdmin ? "WHERE" : "AND";

        const total  = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where}`, params)).n;
        const open   = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where} ${andor} c.status = 'Open'`, params)).n;
        const inprog = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where} ${andor} c.status = 'In Progress'`, params)).n;
        const closed = (await db.get(`SELECT COUNT(*) as n FROM complaints c ${where} ${andor} c.status = 'Closed'`, params)).n;

        const byCat = await db.all(`
          SELECT category, COUNT(*) as total,
            SUM(CASE WHEN status != 'Closed' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'Closed'  THEN 1 ELSE 0 END) as closed_count
          FROM complaints c ${where}
          GROUP BY category
        `, params);

        const trendRows = await db.all(`
          SELECT date(created_at) as day, COUNT(*) as n
          FROM complaints c ${where} ${andor} date(created_at) >= date('now','-13 days')
          GROUP BY day
        `, params);
        const trendMap = Object.fromEntries(trendRows.map(r => [r.day, r.n]));
        const trend = [];
        for (let i = 13; i >= 0; i--) {
          const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          trend.push({ date: key, count: trendMap[key] || 0 });
        }

        summary.complaints = { total, open, inprog, closed, byCat, trend };
      }

      // ── Tasks — same visibility rule as GET /api/tasks ────────────────────
      if (modules.includes("tasks")) {
        const today = istToday();
        let scope = "WHERE assignee_type = 'user' AND assigned_to = ?";
        const tparams = [uid];
        if (isAdmin) {
          scope = "WHERE NOT (assignee_type = 'user' AND assigned_to = assigned_by AND assigned_to != ?)";
        }
        const pending    = (await db.get(`SELECT COUNT(*) as n FROM tasks ${scope} AND status = 'Pending'`, tparams)).n;
        const inProgress = (await db.get(`SELECT COUNT(*) as n FROM tasks ${scope} AND status = 'In Progress'`, tparams)).n;
        const completed  = (await db.get(`SELECT COUNT(*) as n FROM tasks ${scope} AND status = 'Completed'`, tparams)).n;
        const overdue    = (await db.get(`SELECT COUNT(*) as n FROM tasks ${scope} AND status != 'Completed' AND due_date < ?`, [...tparams, today])).n;
        summary.tasks = { pending, inProgress, completed, overdue, total: pending + inProgress + completed };
      }

      // ── File Sharing — always private to sender/recipient, even for admins ─
      if (modules.includes("file-sharing")) {
        const sent     = (await db.get("SELECT COUNT(*) as n FROM shared_files WHERE sender_id = ?", [uid])).n;
        const received = (await db.get("SELECT COUNT(*) as n FROM shared_files WHERE recipient_id = ?", [uid])).n;
        const unread   = (await db.get("SELECT COUNT(*) as n FROM shared_files WHERE recipient_id = ? AND downloaded_at IS NULL", [uid])).n;
        summary.fileSharing = { sent, received, unread, total: sent + received };
      }

      // ── File Tracking — always private per creator, even for admins ──────
      if (modules.includes("file-tracking")) {
        const today = istToday();
        const pending    = (await db.get("SELECT COUNT(*) as n FROM file_tracking_tasks WHERE status = 'Pending' AND created_by = ?", [uid])).n;
        const inProgress = (await db.get("SELECT COUNT(*) as n FROM file_tracking_tasks WHERE status = 'In Progress' AND created_by = ?", [uid])).n;
        const completed  = (await db.get("SELECT COUNT(*) as n FROM file_tracking_tasks WHERE status = 'Completed' AND created_by = ?", [uid])).n;
        const overdue    = (await db.get(
          `SELECT COUNT(*) as n FROM file_tracking_tasks WHERE due_date IS NOT NULL AND due_date < ? AND status NOT IN ('Completed','Closed','Cancelled') AND created_by = ?`,
          [today, uid]
        )).n;
        const total = (await db.get("SELECT COUNT(*) as n FROM file_tracking_tasks WHERE created_by = ?", [uid])).n;
        summary.fileTracking = { pending, inProgress, completed, overdue, total };
      }

      // ── Knowledge References — office-wide library ───────────────────────
      if (modules.includes("knowledge")) {
        const total = (await db.get("SELECT COUNT(*) as n FROM knowledge_docs")).n;
        const recent = await db.all("SELECT title, created_at FROM knowledge_docs ORDER BY created_at DESC LIMIT 3");
        summary.knowledge = { total, recent };
      }

      // ── Lunch Pass — office-wide gate register ────────────────────────────
      if (modules.includes("lunchpass")) {
        const total   = (await db.get("SELECT COUNT(*) as n FROM lunch_passes")).n;
        const active  = (await db.get("SELECT COUNT(*) as n FROM lunch_passes WHERE status = 'Active'")).n;
        const expired = (await db.get("SELECT COUNT(*) as n FROM lunch_passes WHERE status = 'Expired'")).n;
        const today = new Date().toISOString().slice(0, 10);
        const in7   = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        const expiringSoon = (await db.get(
          "SELECT COUNT(*) as n FROM lunch_passes WHERE status = 'Active' AND valid_to BETWEEN ? AND ?", [today, in7]
        )).n;
        summary.lunchpass = { total, active, expired, expiringSoon };
      }

      // ── Print Register — no storage of its own (reports off Complaints
      // data), so it just gets a presence flag for a shortcut card ──────────
      if (modules.includes("print")) {
        summary.print = { available: true };
      }

      res.json(summary);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
