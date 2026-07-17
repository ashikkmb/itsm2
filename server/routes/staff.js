const express = require("express");
const { authenticate, adminOnly } = require("../auth");

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = function staffRoutes(db) {
  const router = express.Router();

  // GET /api/staff — list IT staff (active by default; ?include_inactive=1 for all)
  router.get("/", authenticate, adminOnly, async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === "1";
      const rows = await db.all(
        `SELECT * FROM it_staff ${includeInactive ? "" : "WHERE active = 1"} ORDER BY name ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // POST /api/staff — quick-add a new IT staff member (usable inline from the assign-task form)
  router.post("/", authenticate, adminOnly, async (req, res) => {
    try {
      const { name, department } = req.body;
      if (!name || !name.trim())
        return res.status(400).json({ error: "Staff name is required." });

      const clean = capitalizeFirst(name.trim());
      const existing = await db.get("SELECT * FROM it_staff WHERE name = ?", [clean]);
      if (existing) {
        // Re-adding a previously deactivated staff member just reactivates them.
        if (!existing.active) {
          await db.run("UPDATE it_staff SET active = 1, department = COALESCE(?, department) WHERE id = ?", [department || null, existing.id]);
          return res.json(await db.get("SELECT * FROM it_staff WHERE id = ?", [existing.id]));
        }
        return res.status(409).json({ error: "A staff member with this name already exists." });
      }

      const result = await db.run(
        "INSERT INTO it_staff (name, department) VALUES (?, ?)",
        [clean, department ? department.trim() : ""]
      );
      res.status(201).json(await db.get("SELECT * FROM it_staff WHERE id = ?", [result.lastInsertRowid]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // PATCH /api/staff/:id — rename, update department, or activate/deactivate
  router.patch("/:id", authenticate, adminOnly, async (req, res) => {
    try {
      const existing = await db.get("SELECT * FROM it_staff WHERE id = ?", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Staff member not found." });

      const { name, department, active } = req.body;
      await db.run(
        "UPDATE it_staff SET name = ?, department = ?, active = ? WHERE id = ?",
        [
          name ? capitalizeFirst(name.trim()) : existing.name,
          department !== undefined ? department.trim() : existing.department,
          active !== undefined ? (active ? 1 : 0) : existing.active,
          req.params.id,
        ]
      );
      res.json(await db.get("SELECT * FROM it_staff WHERE id = ?", [req.params.id]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // DELETE /api/staff/:id — only allowed if no tasks reference this staff member;
  // otherwise deactivate instead (keeps task history intact, matches the
  // superadmin-style "protect records in use" pattern used elsewhere).
  router.delete("/:id", authenticate, adminOnly, async (req, res) => {
    try {
      const existing = await db.get("SELECT * FROM it_staff WHERE id = ?", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Staff member not found." });

      const inUse = await db.get("SELECT COUNT(*) AS cnt FROM tasks WHERE assigned_to = ?", [req.params.id]);
      if (inUse.cnt > 0) {
        await db.run("UPDATE it_staff SET active = 0 WHERE id = ?", [req.params.id]);
        return res.json({ message: "Staff member has task history, so they were deactivated instead of deleted." });
      }

      await db.run("DELETE FROM it_staff WHERE id = ?", [req.params.id]);
      res.json({ message: "Staff member deleted." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
