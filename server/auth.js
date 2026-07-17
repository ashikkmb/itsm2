const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "itHelpDesk@SecretKey2026!";

// Set once at startup (see index.js) so `authenticate` can look the user's
// *current* role up in the DB instead of trusting whatever role was baked
// into the JWT at login time.
//
// Why this matters: admin tokens last 30 days. If an admin demotes someone
// (or narrows their Role Management access) mid-session, the old JWT still
// carries the old role — every route that scoped data with `req.user.role`
// (e.g. Complaints' "only see your own complaints") would keep treating
// them as admin until the token happened to expire. Refreshing here closes
// that gap immediately, for every route, without changing any route code.
let _db = null;
function setDb(db) { _db = db; }

async function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  // EventSource (used for the live notification stream) cannot set custom
  // headers, so that one endpoint passes the token as a query parameter
  // instead. Every other route continues to use the Authorization header.
  const queryToken = req.query && req.query.token;

  const token = authHeader ? authHeader.split(" ")[1] : queryToken;
  if (!token) return res.status(401).json({ error: "No token provided." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    if (_db) {
      const row = await _db.get("SELECT role, department FROM users WHERE id = ?", [decoded.id]);
      if (!row) return res.status(401).json({ error: "Account no longer exists." });
      req.user.role = row.role;
      req.user.department = row.department;
    }

    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = { authenticate, adminOnly, setDb, JWT_SECRET };
