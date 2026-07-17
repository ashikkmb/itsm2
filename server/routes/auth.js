const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { authenticate, JWT_SECRET } = require("../auth");
const { authenticateAD } = require("../ldap-auth");
const { getUserModules, getDefaultModules, seedUserModules } = require("../permissions");

module.exports = function authRoutes(db) {
  const router = express.Router();

  // POST /api/auth/login
  // Tries Active Directory first. If that fails (or AD is unreachable),
  // falls back to local accounts (useful for test/demo accounts like itadmin).
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ error: "Username and password are required." });

      const inputRaw = email.trim();
      // Accept either "jsmith" or "jsmith@domain.mil" — extract just the AD username part
      const adUsername = inputRaw.includes("@") ? inputRaw.split("@")[0] : inputRaw;

      // ── Try Active Directory first ─────────────────────────────────────────
      const adResult = await authenticateAD(adUsername, password);

      if (adResult.success) {
        // AD login succeeded — find or auto-create the local profile record
        let user = await db.get("SELECT * FROM users WHERE ad_username = ?", [adUsername.toLowerCase()]);

        if (!user) {
          // First-time login for this AD user — auto-provision a local record
          const displayName = adResult.profile.displayName || adUsername;
          const department  = adResult.profile.department || "Unassigned";

          const result = await db.run(
            `INSERT INTO users (name, email, password, auth_source, ad_username, role, department)
             VALUES (?, ?, NULL, 'ad', ?, 'user', ?)`,
            [displayName, adUsername.toLowerCase(), adUsername.toLowerCase(), department]
          );
          user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastInsertRowid]);
          const defaults = await getDefaultModules(db);
          await seedUserModules(db, user.id, defaults);
          console.log(`AD auto-provisioned new user: ${displayName} (${adUsername})`);
        }

        const token = jwt.sign(
          { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department },
          JWT_SECRET,
          { expiresIn: user.role === "admin" ? "30d" : "8h" }
        );

        const modules = await getUserModules(db, user);
        return res.json({
          token,
          user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, modules }
        });
      }

      // ── Fall back to local accounts (e.g. itadmin and other local test accounts) ───
      const localUser = await db.get(
        "SELECT * FROM users WHERE email = ? AND auth_source = 'local'",
        [inputRaw.toLowerCase()]
      );

      if (!localUser || !localUser.password) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      const valid = bcrypt.compareSync(password, localUser.password);
      if (!valid) return res.status(401).json({ error: "Invalid username or password." });

      const token = jwt.sign(
        { id: localUser.id, name: localUser.name, email: localUser.email, role: localUser.role, department: localUser.department },
        JWT_SECRET,
        { expiresIn: localUser.role === "admin" ? "30d" : "8h" }
      );

      const modules = await getUserModules(db, localUser);
      res.json({
        token,
        user: { id: localUser.id, name: localUser.name, email: localUser.email, role: localUser.role, department: localUser.department, modules }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error during login." });
    }
  });

  router.get("/me", authenticate, async (req, res) => {
    try {
      const user = await db.get(
        "SELECT id, name, email, role, department, auth_source, created_at FROM users WHERE id = ?",
        [req.user.id]
      );
      if (!user) return res.status(404).json({ error: "User not found." });
      const modules = await getUserModules(db, user);
      res.json({ ...user, modules });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  // Local password change only applies to local accounts, not AD users
  router.post("/change-password", authenticate, async (req, res) => {
    try {
      const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);

      if (user.auth_source === "ad") {
        return res.status(400).json({ error: "Your password is managed by your organization's domain. Please contact IT to change your domain password." });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword)
        return res.status(400).json({ error: "Both fields are required." });
      if (newPassword.length < 6)
        return res.status(400).json({ error: "New password must be at least 6 characters." });

      if (!bcrypt.compareSync(currentPassword, user.password))
        return res.status(401).json({ error: "Current password is incorrect." });

      const hashed = bcrypt.hashSync(newPassword, 10);
      await db.run("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);
      res.json({ message: "Password changed successfully." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error." });
    }
  });

  return router;
};
