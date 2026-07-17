import { useState, useEffect } from "react";
import { api } from "./api.js";
import { Icons, Toast, Toggle } from "./components.jsx";
import UsersPage from "./UsersPage.jsx";

// ─── Role Management tab ───────────────────────────────────────────────────
function RoleManagement({ showToast }) {
  const [modules, setModules]   = useState([]);   // module catalog [{key,label}]
  const [defaults, setDefaults] = useState([]);   // default module keys for new users
  const [users, setUsers]       = useState([]);   // non-admin users w/ their modules
  const [loading, setLoading]   = useState(true);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [savingUser, setSavingUser] = useState(null); // user id currently saving

  async function load() {
    setLoading(true);
    try {
      const [mods, defs, roleAccess] = await Promise.all([
        api.getModuleCatalog(),
        api.getDefaultModules(),
        api.getRoleAccess(),
      ]);
      setModules(mods);
      setDefaults(defs);
      setUsers(roleAccess);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function toggleDefault(key) {
    const next = defaults.includes(key) ? defaults.filter(k => k !== key) : [...defaults, key];
    setDefaults(next); // optimistic
    setSavingDefaults(true);
    try {
      await api.setDefaultModules(next);
      showToast("Default modules for new users updated.");
    } catch (e) {
      setDefaults(defaults); // revert
      showToast(e.message, "error");
    } finally {
      setSavingDefaults(false);
    }
  }

  async function toggleUserModule(user, key) {
    const currentModules = user.modules || [];
    const next = currentModules.includes(key) ? currentModules.filter(k => k !== key) : [...currentModules, key];

    // Optimistic update
    setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, modules: next } : u)));
    setSavingUser(user.id);
    try {
      await api.setUserModules(user.id, next);
    } catch (e) {
      // revert on failure
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, modules: currentModules } : u)));
      showToast(e.message, "error");
    } finally {
      setSavingUser(null);
    }
  }

  if (loading) {
    return <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>;
  }

  return (
    <div>
      {/* ── Defaults for new users ── */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "20px 22px", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Default Modules for New Users</h3>
          {savingDefaults && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
        </div>
        <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 14 }}>
          Every module toggled on here is automatically granted to a user the moment their account is created.
          Turn a module off here if new accounts shouldn't get it by default — you can always grant it later, per user, below.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {modules.map(m => {
            const on = defaults.includes(m.key);
            return (
              <button key={m.key} onClick={() => toggleDefault(m.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 99,
                  border: `1px solid ${on ? "#A7F3D0" : "#E2E8F0"}`, background: on ? "#ECFDF5" : "#F8FAFC",
                  color: on ? "#059669" : "#64748B", fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all .15s",
                }}>
                <Toggle on={on} onChange={() => toggleDefault(m.key)} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Per-user access ── */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Per-User Module Access</h3>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
            Grant or revoke access to any module for any individual user. IT Admin accounts always have full access and aren't listed here.
          </p>
        </div>
        {users.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94A3B8", fontSize: 13 }}>No non-admin users yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", position: "sticky", left: 0, background: "#F8FAFC" }}>User</th>
                  {modules.map(m => (
                    <th key={m.key} style={{ padding: "10px 10px", textAlign: "center", fontWeight: 700, color: "#64748B", fontSize: 10.5, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "white" : "#FAFCFF" }}>
                    <td style={{ padding: "10px 14px", position: "sticky", left: 0, background: i % 2 === 0 ? "white" : "#FAFCFF" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 99, background: "linear-gradient(135deg,#0E7490,#1E40AF)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{u.name[0]}</div>
                        <div style={{ overflow: "hidden" }}>
                          <div style={{ fontWeight: 700, color: "#1E293B", whiteSpace: "nowrap" }}>{u.name}</div>
                          <div style={{ color: "#94A3B8", fontSize: 11 }}>{u.department}</div>
                        </div>
                        {savingUser === u.id && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginLeft: 4 }} />}
                      </div>
                    </td>
                    {modules.map(m => (
                      <td key={m.key} style={{ padding: "10px", textAlign: "center" }}>
                        <Toggle on={(u.modules || []).includes(m.key)} onChange={() => toggleUserModule(u, m.key)} disabled={savingUser === u.id} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings page shell (tabbed) ──────────────────────────────────────────
export default function SettingsPage() {
  const [tab, setTab] = useState("roles"); // 'roles' | 'users'
  const [toast, setToast] = useState(null);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const tabs = [
    { key: "roles", label: "Role Management", icon: <Icons.Shield /> },
    { key: "users", label: "Manage Users",     icon: <Icons.Users /> },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 20, borderBottom: "1px solid #E2E8F0" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", border: "none", background: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 700, color: tab === t.key ? "#1E40AF" : "#94A3B8",
              borderBottom: `2px solid ${tab === t.key ? "#1E40AF" : "transparent"}`, marginBottom: -1, transition: "all .15s",
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "roles" && <RoleManagement showToast={showToast} />}
      {tab === "users" && <UsersPage />}

      {toast && <Toast {...toast} />}
    </div>
  );
}
