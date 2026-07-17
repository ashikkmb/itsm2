const express = require("express");
const bcrypt  = require("bcryptjs");
const { authenticate, adminOnly } = require("../auth");
const { getDefaultModules, seedUserModules } = require("../permissions");

module.exports = function userRoutes(db) {
  const router = express.Router();

  router.get("/", authenticate, adminOnly, async (req, res) => {
    try {
      const users = await db.all(
        "SELECT id, name, email, role, department, auth_source, created_at FROM users ORDER BY id"
      );
      res.json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // GET /api/users/directory — a much smaller, non-admin-gated user list
  // (just id/name/department) so any logged-in person can pick a recipient
  // when sharing a file. Deliberately excludes email, role, and auth_source,
  // which stay admin-only via GET / above.
  router.get("/directory", authenticate, async (req, res) => {
    try {
      const users = await db.all(
        "SELECT id, name, department FROM users WHERE id != ? ORDER BY name ASC",
        [req.user.id]
      );
      res.json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // Create a LOCAL account (for accounts outside the domain, e.g. contractors/test accounts)
  router.post("/", authenticate, adminOnly, async (req, res) => {
    try {
      const { name, email, password, role, department } = req.body;
      if (!name || !email || !password || !department)
        return res.status(400).json({ error: "Name, email, password, and department are required." });
      if (password.length < 6)
        return res.status(400).json({ error: "Password must be at least 6 characters." });

      const existing = await db.get("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()]);
      if (existing) return res.status(409).json({ error: "Email already registered." });

      const hashed = bcrypt.hashSync(password, 10);
      const result = await db.run(
        "INSERT INTO users (name, email, password, auth_source, role, department) VALUES (?, ?, ?, 'local', ?, ?)",
        [name.trim(), email.trim().toLowerCase(), hashed, role || "user", department.trim()]
      );

      if ((role || "user") !== "admin") {
        const defaults = await getDefaultModules(db);
        await seedUserModules(db, result.lastInsertRowid, defaults);
      }

      const user = await db.get(
        "SELECT id, name, email, role, department, auth_source, created_at FROM users WHERE id = ?",
        [result.lastInsertRowid]
      );
      res.status(201).json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  router.delete("/:id", authenticate, adminOnly, async (req, res) => {
    try {
      const userId = req.params.id;

      if (parseInt(userId) === req.user.id)
        return res.status(400).json({ error: "Cannot delete your own account." });

      const user = await db.get("SELECT id, email FROM users WHERE id = ?", [userId]);
      if (!user) return res.status(404).json({ error: "User not found." });
      if (["itadmin", "admin@org.local"].includes(user.email))
        return res.status(400).json({ error: "The built-in IT Admin account cannot be deleted." });

      // Unlink (don't delete) their complaints — the permanent raised_by_name/dept
      // snapshot already preserves who filed them, so the records stay intact
      // and fully readable even after the user account itself is removed.
      await db.run("UPDATE complaints SET user_id = NULL WHERE user_id = ?", [userId]);
      await db.run("UPDATE complaints SET closed_by = NULL WHERE closed_by = ?", [userId]);
      await db.run("UPDATE activity_log SET user_id = NULL WHERE user_id = ?", [userId]);

      await db.run("DELETE FROM users WHERE id = ?", [userId]);

      res.json({ message: "User deleted. Their complaints and activity history have been preserved." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error while deleting user." });
    }
  });

  // Reset password — only valid for LOCAL accounts (AD passwords are managed by the domain)
  router.patch("/:id/reset-password", authenticate, adminOnly, async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6)
        return res.status(400).json({ error: "Password must be at least 6 characters." });

      const user = await db.get("SELECT id, auth_source FROM users WHERE id = ?", [req.params.id]);
      if (!user) return res.status(404).json({ error: "User not found." });
      if (user.auth_source === "ad")
        return res.status(400).json({ error: "This is a domain account. Password changes must be done through Active Directory." });

      const hashed = bcrypt.hashSync(newPassword, 10);
      await db.run("UPDATE users SET password = ? WHERE id = ?", [hashed, req.params.id]);
      res.json({ message: "Password reset successfully." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // Promote/demote a user's role (works for both AD and local accounts)
  router.patch("/:id/role", authenticate, adminOnly, async (req, res) => {
    try {
      const { role } = req.body;
      if (!["user", "admin"].includes(role))
        return res.status(400).json({ error: "Role must be 'user' or 'admin'." });

      if (parseInt(req.params.id) === req.user.id)
        return res.status(400).json({ error: "Cannot change your own role." });

      const user = await db.get("SELECT id, email FROM users WHERE id = ?", [req.params.id]);
      if (!user) return res.status(404).json({ error: "User not found." });
      if (["itadmin", "admin@org.local"].includes(user.email))
        return res.status(400).json({ error: "The built-in IT Admin account's role cannot be changed." });

      await db.run("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);

      // Demoted from admin -> user: they've never had explicit module grants
      // (admins bypass the table entirely), so give them the current defaults
      // rather than dropping them to zero-access.
      if (role === "user") {
        const existing = await db.get("SELECT COUNT(*) as cnt FROM user_modules WHERE user_id = ?", [req.params.id]);
        if (existing.cnt === 0) {
          const defaults = await getDefaultModules(db);
          await seedUserModules(db, req.params.id, defaults);
        }
      }

      res.json({ message: `Role updated to ${role}.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
