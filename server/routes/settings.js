const express = require("express");
const { authenticate, adminOnly } = require("../auth");
const { MODULES, MODULE_KEYS, getDefaultModules } = require("../permissions");

module.exports = function settingsRoutes(db) {
  const router = express.Router();

  // GET /api/settings/modules — the full catalog of governable modules
  router.get("/modules", authenticate, adminOnly, async (_req, res) => {
    res.json(MODULES);
  });

  // GET/PUT /api/settings/default-modules — which modules a brand-new
  // non-admin user is granted automatically at creation
  router.get("/default-modules", authenticate, adminOnly, async (_req, res) => {
    try {
      res.json(await getDefaultModules(db));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  router.put("/default-modules", authenticate, adminOnly, async (req, res) => {
    try {
      const { modules } = req.body;
      if (!Array.isArray(modules) || modules.some(m => !MODULE_KEYS.includes(m)))
        return res.status(400).json({ error: "Invalid module list." });

      await db.run(
        `INSERT INTO app_settings (key, value) VALUES ('default_modules', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [JSON.stringify(modules)]
      );
      res.json({ message: "Default modules for new users updated.", modules });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/settings/role-access — every non-admin user with their current
  // module grants, for the Role Management screen
  router.get("/role-access", authenticate, adminOnly, async (_req, res) => {
    try {
      const users = await db.all(
        "SELECT id, name, email, department, auth_source FROM users WHERE role != 'admin' ORDER BY name ASC"
      );
      const grants = await db.all("SELECT user_id, module_key FROM user_modules");
      const byUser = {};
      for (const g of grants) (byUser[g.user_id] ||= []).push(g.module_key);
      res.json(users.map(u => ({ ...u, modules: byUser[u.id] || [] })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // PUT /api/settings/role-access/:userId — replace one user's full module set
  router.put("/role-access/:userId", authenticate, adminOnly, async (req, res) => {
    try {
      const { modules } = req.body;
      if (!Array.isArray(modules) || modules.some(m => !MODULE_KEYS.includes(m)))
        return res.status(400).json({ error: "Invalid module list." });

      const user = await db.get("SELECT id, role FROM users WHERE id = ?", [req.params.userId]);
      if (!user) return res.status(404).json({ error: "User not found." });
      if (user.role === "admin")
        return res.status(400).json({ error: "Admins already have full access to every module." });

      await db.run("DELETE FROM user_modules WHERE user_id = ?", [user.id]);
      for (const key of modules) {
        await db.run("INSERT INTO user_modules (user_id, module_key) VALUES (?, ?)", [user.id, key]);
      }
      res.json({ message: "Access updated.", modules });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
