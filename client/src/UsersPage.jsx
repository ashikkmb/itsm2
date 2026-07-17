import { useState, useEffect } from "react";
import { api } from "./api.js";
import { Icons, Modal, S, Toast, fmtDateOnly } from "./components.jsx";

export default function UsersPage() {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast,   setToast]   = useState(null);
  const [resetTarget, setResetTarget] = useState(null);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    try { setUsers(await api.getUsers()); }
    catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleDelete(u) {
    if (!window.confirm(`Delete user "${u.name}"? Their complaints will remain.`)) return;
    try { await api.deleteUser(u.id); showToast("User deleted."); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function handleRoleToggle(u) {
    const newRole = u.role === "admin" ? "user" : "admin";
    if (!window.confirm(`Change ${u.name}'s role to ${newRole === "admin" ? "IT Admin" : "User"}?`)) return;
    try { await api.updateUserRole(u.id, newRole); showToast(`${u.name} is now ${newRole === "admin" ? "an IT Admin" : "a regular User"}.`); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>User Accounts ({users.length})</h2>
        <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          <Icons.Plus /> Add Local User
        </button>
      </div>

      <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 14 }}>
        Domain (AD) users are added automatically on their first login. Use "Add Local User" only for accounts outside the domain.
      </p>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        {loading ? <div style={{ textAlign: "center", padding: 48 }}><span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0" }}>
                {["Name", "Username", "Department", "Source", "Role", "Joined", "Actions"].map(h => (
                  <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "white" : "#FAFCFF" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#1E293B" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 99, background: u.role === "admin" ? "linear-gradient(135deg,#7C3AED,#0E7490)" : "linear-gradient(135deg,#0E7490,#1E40AF)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{u.name[0]}</div>
                      {u.name}
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", color: "#475569" }}>{u.email}</td>
                  <td style={{ padding: "12px 14px", color: "#475569" }}>{u.department}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ background: u.auth_source === "ad" ? "#ECFDF5" : "#F1F5F9", color: u.auth_source === "ad" ? "#059669" : "#64748B", border: `1px solid ${u.auth_source === "ad" ? "#A7F3D0" : "#E2E8F0"}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
                      {u.auth_source === "ad" ? "Domain (AD)" : "Local"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ background: u.role === "admin" ? "#EDE9FE" : "#EFF6FF", color: u.role === "admin" ? "#7C3AED" : "#1D4ED8", border: `1px solid ${u.role === "admin" ? "#C4B5FD" : "#BFDBFE"}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
                      {u.role === "admin" ? "IT Admin" : "User"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", color: "#94A3B8" }}>{fmtDateOnly(u.created_at)}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      {!["itadmin", "admin@org.local"].includes(u.email) && (
                        <button onClick={() => handleRoleToggle(u)} style={{ padding: "5px 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, color: "#1D4ED8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          {u.role === "admin" ? "Make User" : "Make Admin"}
                        </button>
                      )}
                      {u.auth_source === "local" && (
                        <button onClick={() => setResetTarget(u)} style={{ padding: "5px 10px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 6, color: "#C2410C", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Icons.Key />Reset</button>
                      )}
                      {u.role !== "admin" && <button onClick={() => handleDelete(u)} style={{ padding: "5px 10px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, color: "#DC2626", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Icons.Trash />Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={() => { load(); setShowAdd(false); showToast("User created successfully."); }} />}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} onReset={() => { setResetTarget(null); showToast("Password reset successfully."); }} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}

function AddUserModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "user", department: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.name || !form.email || !form.password || !form.department) { setError("All fields are required."); return; }
    setLoading(true); setError("");
    try { await api.createUser(form); onAdded(); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={460}>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Add Local User Account</h3>
      <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 16 }}>For accounts outside the domain only. Domain users are added automatically when they first log in.</p>
      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      {[["Full Name", "name", "text", "John Doe"], ["Username", "email", "text", "jdoe"], ["Password", "password", "password", "min. 6 characters"], ["Department", "department", "text", "Finance, HR, Operations…"]].map(([lbl, key, type, ph]) => (
        <div key={key} style={{ marginBottom: 14 }}>
          <label style={S.label}>{lbl} *</label>
          <input style={S.input} type={type} placeholder={ph} value={form[key]} onChange={f(key)} />
        </div>
      ))}

      <label style={S.label}>Role *</label>
      <select style={{ ...S.select, width: "100%", marginBottom: 24 }} value={form.role} onChange={f("role")}>
        <option value="user">User</option>
        <option value="admin">IT Admin</option>
      </select>

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Creating…" : "Create User"}
        </button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onReset }) {
  const [pass,   setPass]   = useState("");
  const [error,  setError]  = useState("");
  const [loading,setLoading]= useState(false);

  async function handleReset() {
    if (pass.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try { await api.resetPassword(user.id, pass); onReset(); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={400}>
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Reset Password</h3>
      <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>For: {user.name} ({user.email})</p>
      {/* Note: "user.email" still holds the username value internally — only the label changed */}
      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#DC2626", fontSize: 13 }}>{error}</div>}
      <label style={S.label}>New Password *</label>
      <input style={{ ...S.input, marginBottom: 20 }} type="password" placeholder="min. 6 characters" value={pass} onChange={e => setPass(e.target.value)} />
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleReset} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#C2410C,#9A3412)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Resetting…" : "Reset Password"}
        </button>
      </div>
    </Modal>
  );
}
