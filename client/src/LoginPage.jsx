import { useState } from "react";
import { api, setToken } from "./api.js";
import { Icons, S } from "./components.jsx";
import orgLogo from "./assets/logo.png";

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [error, setError] = useState(() => {
    const reason = sessionStorage.getItem("hd_logout_reason");
    if (reason) sessionStorage.removeItem("hd_logout_reason");
    return reason || "";
  });
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !pass) { setError("Please enter username and password."); return; }
    setLoading(true); setError("");
    try {
      const data = await api.login(email.trim(), pass);
      setToken(data.token);
      localStorage.setItem("hd_user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0F172A 0%, #1E3A5F 60%, #0E7490 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="fade-up" style={{ background: "white", borderRadius: 16, padding: "48px 44px", width: 400, boxShadow: "0 24px 64px #0008" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={orgLogo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#0F172A" }}>ITSM - NAD (A)</div>
            <div style={{ fontSize: 11, color: "#64748B", fontWeight: 500 }}>IT Service Management System</div>
          </div>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Sign in</h2>
        <p style={{ fontSize: 13, color: "#64748B", marginBottom: 28 }}>Use your domain network username and password</p>

        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 18, color: "#DC2626", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.Alert /> {error}
          </div>
        )}

        <label style={S.label}>Username</label>
        <input style={{ ...S.input, marginBottom: 16 }} type="text" placeholder="Enter your username" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />

        <label style={S.label}>Password</label>
        <input style={{ ...S.input, marginBottom: 24 }} type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />

        <button onClick={handleLogin} disabled={loading}
          style={{ width: "100%", padding: "12px", background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          {loading ? <><span className="spinner" style={{ borderTopColor: "white", borderColor: "rgba(255,255,255,0.3)" }} /> Signing in…</> : "Sign In →"}
        </button>

      </div>

      <p style={{ marginTop: 24, width: 400, fontSize: 12, color: "rgba(255,255,255,0.65)", fontWeight: 500, textAlign: "center" }}>
        Developed &amp; Maintained by IT Cell, NAD (A)
      </p>
    </div>
  );
}
