// ── Active Directory Authentication via LDAP ───────────────────────────────────
// Validates username/password against your Domain Controller and retrieves
// basic profile info (display name, department, email) on successful login.

const ldap = require("ldapjs");

// ── CONFIGURATION — edit these for your environment ───────────────────────────
const AD_CONFIG = {
  // Your Domain Controller address, e.g. "ldap://dc01.nasoa.mil" or "ldap://192.168.1.10"
  url: process.env.AD_URL || "ldap://YOUR-DC-SERVER-HERE:389",

  // Your AD domain suffix, e.g. "nasoa.mil" or "corp.local"
  domain: process.env.AD_DOMAIN || "yourdomain.mil",

  // Base DN to search for users, e.g. "DC=nasoa,DC=mil"
  baseDN: process.env.AD_BASE_DN || "DC=yourdomain,DC=mil",
};

/**
 * Authenticates a user against Active Directory.
 * @param {string} username - the AD username (without domain suffix), e.g. "jsmith"
 * @param {string} password - the user's AD password
 * @returns {Promise<{success: boolean, profile?: object, error?: string}>}
 */
function authenticateAD(username, password) {
  return new Promise((resolve) => {
    if (!username || !password) {
      return resolve({ success: false, error: "Username and password are required." });
    }

    // If AD hasn't been configured yet, skip straight to local fallback (no point waiting on a timeout)
    if (!process.env.AD_URL || AD_CONFIG.url.includes("YOUR-DC-SERVER-HERE")) {
      return resolve({ success: false, error: "AD not configured." });
    }

    const client = ldap.createClient({
      url: AD_CONFIG.url,
      timeout: 5000,
      connectTimeout: 5000,
    });

    client.on("error", (err) => {
      resolve({ success: false, error: "Cannot reach domain controller: " + err.message });
    });

    // AD accepts login as "username@domain" (UPN format) — most reliable method
    const userPrincipal = `${username}@${AD_CONFIG.domain}`;

    client.bind(userPrincipal, password, (err) => {
      if (err) {
        client.unbind();
        return resolve({ success: false, error: "Invalid username or password." });
      }

      // Bind succeeded — now look up the user's profile details
      const searchOptions = {
        filter: `(sAMAccountName=${escapeLdapFilter(username)})`,
        scope: "sub",
        attributes: ["displayName", "department", "mail", "memberOf", "sAMAccountName"],
      };

      client.search(AD_CONFIG.baseDN, searchOptions, (searchErr, res) => {
        if (searchErr) {
          client.unbind();
          return resolve({
            success: true,
            profile: { displayName: username, department: "", mail: "", memberOf: [] },
          });
        }

        let entry = null;
        res.on("searchEntry", (e) => { entry = e.pojo ? e.pojo.attributes : e.object; });
        res.on("error", () => {
          client.unbind();
          resolve({ success: true, profile: { displayName: username, department: "", mail: "", memberOf: [] } });
        });
        res.on("end", () => {
          client.unbind();
          if (!entry) {
            return resolve({
              success: true,
              profile: { displayName: username, department: "", mail: "", memberOf: [] },
            });
          }

          const getAttr = (name) => {
            const found = Array.isArray(entry)
              ? entry.find(a => a.type === name)
              : null;
            if (found) return Array.isArray(found.values) ? found.values[0] : found.vals?.[0];
            return entry[name] || "";
          };

          resolve({
            success: true,
            profile: {
              displayName: getAttr("displayName") || username,
              department: getAttr("department") || "",
              mail: getAttr("mail") || "",
              memberOf: getAttr("memberOf") || [],
            },
          });
        });
      });
    });
  });
}

function escapeLdapFilter(str) {
  return str.replace(/[\\*()\0/]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

module.exports = { authenticateAD, AD_CONFIG };
