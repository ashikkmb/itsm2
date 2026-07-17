// ── Module-based access control ──────────────────────────────────────────────
// Admins implicitly have access to every module. Non-admin users only see/use
// a module if it's listed in user_modules for their account. New users are
// seeded from the 'default_modules' row in app_settings at creation time
// (local accounts) or first AD login (auto-provisioned accounts).

const MODULES = [
  { key: "complaints",    label: "Complaints" },
  { key: "tasks",          label: "Tasks" },
  { key: "file-sharing",   label: "File Sharing" },
  { key: "file-tracking",  label: "File Tracking" },
  { key: "knowledge",      label: "Knowledge References" },
  { key: "print",          label: "Print Register" },
  { key: "lunchpass",      label: "Lunch Pass" },
];

const MODULE_KEYS = MODULES.map(m => m.key);

// Core ITSM modules every new user gets automatically. Lunch Pass, Knowledge
// References, and Print Register are intentionally left out — those start
// admin-only until an admin grants them to specific users via Settings ->
// Role Management.
const DEFAULT_NEW_USER_MODULES = ["complaints", "tasks", "file-sharing", "file-tracking"];

async function getDefaultModules(db) {
  const row = await db.get("SELECT value FROM app_settings WHERE key = 'default_modules'");
  if (!row) return DEFAULT_NEW_USER_MODULES;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter(k => MODULE_KEYS.includes(k)) : DEFAULT_NEW_USER_MODULES;
  } catch {
    return DEFAULT_NEW_USER_MODULES;
  }
}

// Full effective module list for a user — admins get everything, everyone
// else gets whatever's been explicitly granted in user_modules.
async function getUserModules(db, user) {
  if (!user) return [];
  if (user.role === "admin") return MODULE_KEYS;
  const rows = await db.all("SELECT module_key FROM user_modules WHERE user_id = ?", [user.id]);
  return rows.map(r => r.module_key);
}

// Grants a set of modules to a (presumably just-created) user. Safe to call
// with modules the user already has — duplicates are ignored.
async function seedUserModules(db, userId, moduleKeys) {
  for (const key of moduleKeys) {
    if (MODULE_KEYS.includes(key)) {
      await db.run("INSERT OR IGNORE INTO user_modules (user_id, module_key) VALUES (?, ?)", [userId, key]);
    }
  }
}

// Express middleware factory — blocks non-admins who don't have moduleKey.
// Looks the grant up fresh from the DB on every request (rather than trusting
// the JWT) so an admin revoking access takes effect immediately, not just
// after the user's token expires and they log back in.
function moduleAccess(db, moduleKey) {
  return async (req, res, next) => {
    if (req.user.role === "admin") return next();
    try {
      const row = await db.get(
        "SELECT 1 FROM user_modules WHERE user_id = ? AND module_key = ?",
        [req.user.id, moduleKey]
      );
      if (row) return next();
      return res.status(403).json({ error: "You don't have access to this module. Contact your administrator." });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error." });
    }
  };
}

module.exports = {
  MODULES,
  MODULE_KEYS,
  DEFAULT_NEW_USER_MODULES,
  getDefaultModules,
  getUserModules,
  seedUserModules,
  moduleAccess,
};
