import { useState, useEffect, useCallback } from "react";
import { api, clearToken, getToken } from "./api.js";
import { Icons, Badge, Toast, S, STA_COLOR, STA_BG, PRI_COLOR, CATEGORIES, STATUSES, fmtDate } from "./components.jsx";
import { ComplaintsTable, ComplaintForm, DetailDrawer } from "./Complaints.jsx";
import PrintRegister from "./PrintRegister.jsx";
import KnowledgeReferences from "./KnowledgeReferences.jsx";
import LunchPass from "./LunchPass.jsx";
import TasksPage from "./Tasks.jsx";
import FileSharingPage from "./FileSharingPage.jsx";
import FileTrackingDashboard from "./FileTracking.jsx";
import LoginPage from "./LoginPage.jsx";
import SettingsPage from "./SettingsPage.jsx";
import Dashboard from "./Dashboard.jsx";
import SoftwareRepository from "./SoftwareRepository.jsx";
import orgLogo from "./assets/logo.png";
import { useIdleTimeout } from "./useIdleTimeout.js";
import { useComplaintNotifications } from "./useComplaintNotifications.js";
import { useTaskNotifications } from "./useTaskNotifications.js";

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user,      setUser]      = useState(() => { try { return JSON.parse(localStorage.getItem("hd_user")); } catch { return null; } });
  const [page,      setPage]      = useState("dashboard");
  const [servicesOpen, setServicesOpen] = useState(false);
  const [complaintsOpen, setComplaintsOpen] = useState(false);
  const [complaints,setComplaints]= useState([]);
  const [stats,     setStats]     = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [showForm,  setShowForm]  = useState(false);
  const [toast,     setToast]     = useState(null);
  const [catFilter, setCatFilter] = useState("All");
  const [staFilter, setStaFilter] = useState("All");
  const [search,    setSearch]    = useState("");
  const [dueTaskCount, setDueTaskCount] = useState(0);
  const [unreadFileCount, setUnreadFileCount] = useState(0);

  const isAdmin = user?.role === "admin";
  const hasModule = (key) => isAdmin || (user?.modules || []).includes(key);

  // Map each routable page key to the module that gates it (pages not
  // listed here — dashboard, settings — have their own access rules).
  const PAGE_MODULE = {
    hardware: "complaints", software: "complaints", inams: "complaints", all: "complaints",
    tasks: "tasks", "file-sharing": "file-sharing", "file-tracking": "file-tracking",
    knowledge: "knowledge", print: "print", lunchpass: "lunchpass",
  };

  // If the module backing the current page was revoked (e.g. by an admin
  // in Role Management, picked up by the profile refresh above), bounce
  // back to the dashboard rather than showing a page the user can no
  // longer use.
  useEffect(() => {
    const requiredModule = PAGE_MODULE[page];
    if (requiredModule && !hasModule(requiredModule)) setPage("dashboard");
    if ((page === "settings" || page === "software-repo") && !isAdmin) setPage("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user?.modules, isAdmin]);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }

  // ── Load complaints ──────────────────────────────────────────────────────
  const loadComplaints = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = {};
      if (page === "hardware") params.category = "Hardware";
      if (page === "software") params.category = "Software";
      if (page === "inams")    params.category = "INAMS";
      if (catFilter !== "All" && page === "all") params.category = catFilter;
      if (staFilter !== "All") params.status = staFilter;
      if (search.trim()) params.search = search.trim();
      setComplaints(await api.getComplaints(params));
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [user, page, catFilter, staFilter, search]);

  const loadStats = useCallback(async () => {
    if (!user) return;
    try { setStats(await api.getStats()); }
    catch {}
  }, [user]);

  useEffect(() => { loadComplaints(); }, [loadComplaints]);
  useEffect(() => { if (page === "dashboard") loadStats(); }, [page, loadStats]);
  useEffect(() => {
    if (["hardware", "software", "inams", "all", "print"].includes(page)) setComplaintsOpen(true);
  }, [page]);

  // Pull the current role + module access fresh from the server once per
  // session load — covers the case where an admin changed this user's
  // access in Settings -> Role Management since their last login.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.me().then(fresh => {
      if (cancelled) return;
      const merged = { ...user, role: fresh.role, department: fresh.department, modules: fresh.modules };
      setUser(merged);
      localStorage.setItem("hd_user", JSON.stringify(merged));
    }).catch(() => { /* non-fatal — keep using the cached profile */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleLogin(u) { setUser(u); setPage("dashboard"); }

  function handleLogout(reason) {
    clearToken();
    setUser(null);
    setPage("dashboard");
    setComplaints([]);
    setStats(null);
    setDueTaskCount(0);
    setUnreadFileCount(0);
    if (reason === "idle") {
      // Show the message on the now-visible login page rather than a toast
      // that would disappear instantly along with the rest of the UI.
      sessionStorage.setItem("hd_logout_reason", "You were signed out due to inactivity.");
    }
  }

  // ── Auto-logout after 5 minutes of inactivity, with a 30s warning toast ────
  // IT Admin accounts are exempt — the PC itself is access-controlled, so a
  // session timeout on top of that is unnecessary friction for staff who need
  // to stay logged in all day to receive new-complaint notifications.
  useIdleTimeout({
    active: !!user && !isAdmin,
    timeoutMs: 5 * 60 * 1000,
    warnMs: 30 * 1000,
    onWarning: () => showToast("You'll be signed out in 30 seconds due to inactivity.", "error"),
    onIdle: () => handleLogout("idle"),
  });

  // ── Live push notifications for new complaints (admin only) ────────────────
  // Note: `permission`/`requestPermission` reflect the browser's single
  // shared Notification permission for this site, not something specific
  // to complaints — the same grant also powers task/comment alerts for
  // every user via useTaskNotifications below. Only the "new-complaint"
  // SSE subscription itself is gated to admins here.
  const { permission: notifPermission, requestPermission: requestNotifPermission } = useComplaintNotifications({
    active: !!user && isAdmin,
    token: getToken(),
    onNewComplaint: (data) => {
      showToast(`New complaint: ${data.ticket_no} — ${data.complainant_name} (${data.raised_by_dept}) — ${data.title}`);
      // Refresh the dashboard/list in the background so counts and the
      // recent-complaints table reflect the new ticket immediately.
      loadComplaints();
      loadStats();
    },
  });

  // ── Task reminders — instant push on assignment/comment + recurring
  //    30-min due-date alerts, for whichever account is logged in (each
  //    user only ever receives due-task data for their own tasks; admins
  //    receive due-task data across everyone) ──────────────────────────────
  useTaskNotifications({
    active: !!user,
    token: getToken(),
    userId: user?.id,
    isAdmin,
    onDueTasks: (due) => setDueTaskCount(due.length),
  });

  // ── File Sharing badge — unread (not-yet-downloaded) received files ────────
  useEffect(() => {
    if (!user) { setUnreadFileCount(0); return; }
    let cancelled = false;
    async function checkUnread() {
      try {
        const files = await api.getFileShares();
        if (!cancelled) setUnreadFileCount(files.filter(f => f.recipient_id === user.id && !f.downloaded_at).length);
      } catch { /* non-fatal — badge just stays at its last known value */ }
    }
    checkUnread();
    const interval = setInterval(checkUnread, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user]);

  async function handleSubmit(form) {
    const c = await api.createComplaint(form);
    showToast(`${c.ticket_no} submitted successfully.`);
    setShowForm(false);
    loadComplaints();
    loadStats();
  }

  async function handleClose(id, remarks) {
    await api.closeComplaint(id, remarks);
    showToast("Complaint closed.");
    loadComplaints();
    loadStats();
  }

  async function handleStatusChange(id, status, comment, priority) {
    await api.updateStatus(id, status, comment, priority);
    showToast("Status updated.");
    loadComplaints();
  }

  if (!user) return <LoginPage onLogin={handleLogin} />;

  // ── Nav ────────────────────────────────────────────────────────────────
  // Complaints is a collapsible group (Hardware / Software / INAMS / All /
  // Print Register). The group itself shows if the user has 'complaints'
  // and/or 'print' — each child is then filtered by its own module, so a
  // user granted only Print Register still sees the group with just that
  // one child. Knowledge References and Lunch Pass are separate flat items,
  // admin-only by default until granted in Settings -> Role Management.
  const complaintsChildren = [
    { key: "hardware", label: "Hardware",       icon: <Icons.Hardware />, module: "complaints" },
    { key: "software", label: "Software",       icon: <Icons.Software />, module: "complaints" },
    { key: "inams",    label: "INAMS",          icon: <Icons.Network />,  module: "complaints" },
    { key: "all",      label: "All Complaints", icon: <Icons.List />,     module: "complaints" },
    { key: "print",    label: "Print Register", icon: <Icons.Print />,    module: "print" },
  ].filter(item => hasModule(item.module));

  const flatNavItems = [
    { key: "tasks",          label: "Tasks",                 icon: <Icons.Tasks />,   module: "tasks" },
    { key: "file-sharing",   label: "File Sharing",           icon: <Icons.Share />,   module: "file-sharing" },
    { key: "file-tracking",  label: "File Tracking",          icon: <Icons.File />,    module: "file-tracking" },
    { key: "knowledge",      label: "Knowledge References",   icon: <Icons.Book />,    module: "knowledge" },
  ].filter(item => hasModule(item.module));

  // Flat lookup across every routable page, just for the header title
  const pageTitleMap = {
    dashboard: "Dashboard", settings: "Settings", lunchpass: "Lunch Pass", "software-repo": "Software Repository",
    ...Object.fromEntries(complaintsChildren.map(c => [c.key, c.label])),
    ...Object.fromEntries(flatNavItems.map(f => [f.key, f.label])),
  };
  const pageTitle = pageTitleMap[page] || "Dashboard";

  // Active counts for badge
  const badge = (cat) => stats?.byCat?.find(b => b.category === cat)?.active || 0;

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F1F5F9" }}>

      {/* ── Sidebar ── */}
      <aside style={{ width: 228, background: "#0F172A", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 72, height: 72, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img src={orgLogo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 13 }}>ITSM - NAD (A)</div>
              <div style={{ color: "#64748B", fontSize: 10 }}>IT Service Management System</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "14px 10px", overflowY: "auto" }}>
          {/* ── Dashboard ── */}
          <button onClick={() => { setPage("dashboard"); setCatFilter("All"); setStaFilter("All"); setSearch(""); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: page === "dashboard" ? "#1E40AF" : "transparent", color: page === "dashboard" ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: page === "dashboard" ? 700 : 500, marginBottom: 2, textAlign: "left", transition: "all .15s" }}
            onMouseEnter={e => { if (page !== "dashboard") { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}}
            onMouseLeave={e => { if (page !== "dashboard") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}}>
            <Icons.Dashboard />
            <span style={{ flex: 1 }}>Dashboard</span>
          </button>

          {/* ── Complaints (expandable: Hardware / Software / INAMS / All / Print Register) ── */}
          {complaintsChildren.length > 0 && (
            <div style={{ marginTop: 2 }}>
              <button onClick={() => setComplaintsOpen(o => !o)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: complaintsChildren.some(c => c.key === page) && !complaintsOpen ? "#1E40AF" : "transparent", color: complaintsChildren.some(c => c.key === page) && !complaintsOpen ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, marginBottom: 2, textAlign: "left", transition: "all .15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}
                onMouseLeave={e => { e.currentTarget.style.background = complaintsChildren.some(c => c.key === page) && !complaintsOpen ? "#1E40AF" : "transparent"; e.currentTarget.style.color = complaintsChildren.some(c => c.key === page) && !complaintsOpen ? "white" : "#94A3B8"; }}>
                <Icons.List />
                <span style={{ flex: 1 }}>Complaints</span>
                <span style={{ transform: complaintsOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", display: "flex" }}><Icons.Chevron /></span>
              </button>

              {complaintsOpen && (
                <div style={{ paddingLeft: 14, marginBottom: 2 }}>
                  {complaintsChildren.map(({ key, label, icon }) => {
                    const cnt = key === "hardware" ? badge("Hardware") : key === "software" ? badge("Software") : key === "inams" ? badge("INAMS") : 0;
                    const active = page === key;
                    return (
                      <button key={key} onClick={() => { setPage(key); setCatFilter("All"); setStaFilter("All"); setSearch(""); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: active ? "#1E40AF" : "transparent", color: active ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: active ? 700 : 500, marginBottom: 2, textAlign: "left", transition: "all .15s" }}
                        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}}
                        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}}>
                        {icon}
                        <span style={{ flex: 1 }}>{label}</span>
                        {cnt > 0 && <span style={{ background: "#EF4444", color: "white", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>{cnt}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Everything else the user has module access to ── */}
          {flatNavItems.map(({ key, label, icon }) => {
            const cnt = key === "tasks" ? dueTaskCount : key === "file-sharing" ? unreadFileCount : 0;
            const active = page === key;
            return (
              <button key={key} onClick={() => { setPage(key); setCatFilter("All"); setStaFilter("All"); setSearch(""); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: active ? "#1E40AF" : "transparent", color: active ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 500, marginBottom: 2, textAlign: "left", transition: "all .15s" }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}}>
                {icon}
                <span style={{ flex: 1 }}>{label}</span>
                {cnt > 0 && <span style={{ background: "#EF4444", color: "white", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>{cnt}</span>}
              </button>
            );
          })}

          {/* ── Software Repository — admin only, not part of the grantable
               module system (unlike Lunch Pass / Knowledge / Print) ── */}
          {isAdmin && (
            <button onClick={() => setPage("software-repo")}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: page === "software-repo" ? "#1E40AF" : "transparent", color: page === "software-repo" ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: page === "software-repo" ? 700 : 500, marginBottom: 2, textAlign: "left", transition: "all .15s" }}
              onMouseEnter={e => { if (page !== "software-repo") { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}}
              onMouseLeave={e => { if (page !== "software-repo") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}}>
              <Icons.Package />
              <span style={{ flex: 1 }}>Software Repository</span>
            </button>
          )}

          {/* ── Services (expandable) — currently just Lunch Pass, room for more later.
               Admin-only by default, but appears for any user granted the 'lunchpass' module. ── */}
          {hasModule("lunchpass") && (
            <div style={{ marginTop: 2 }}>
              <button onClick={() => setServicesOpen(o => !o)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: "transparent", color: "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, marginBottom: 2, textAlign: "left", transition: "all .15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}>
                <Icons.Services />
                <span style={{ flex: 1 }}>Services</span>
                <span style={{ transform: servicesOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", display: "flex" }}><Icons.Chevron /></span>
              </button>

              {servicesOpen && (
                <div style={{ paddingLeft: 14, marginBottom: 2 }}>
                  <button onClick={() => setPage("lunchpass")}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: page === "lunchpass" ? "#1E40AF" : "transparent", color: page === "lunchpass" ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: page === "lunchpass" ? 700 : 500, textAlign: "left", transition: "all .15s" }}
                    onMouseEnter={e => { if (page !== "lunchpass") { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}}
                    onMouseLeave={e => { if (page !== "lunchpass") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}}>
                    <Icons.Utensils />
                    <span>Lunch Pass</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>

        <div style={{ padding: "14px 10px", borderTop: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", marginBottom: 4 }}>
            <div style={{ width: 30, height: 30, borderRadius: 99, background: "linear-gradient(135deg,#0E7490,#6366F1)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{user.name[0]}</div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ color: "white", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
              <div style={{ color: "#64748B", fontSize: 10 }}>{isAdmin ? "IT Admin" : user.department}</div>
            </div>
          </div>

          {notifPermission !== "unsupported" && (
            <button
              onClick={() => {
                if (notifPermission === "granted") {
                  showToast("To turn off alerts, use Chrome's site settings (lock icon in the address bar) — browsers don't allow sites to revoke their own notification permission.", "error");
                  return;
                }
                if (notifPermission === "denied") {
                  showToast("Alerts are blocked in Chrome for this site. Click the lock/info icon in the address bar → Notifications → Allow, then click this again.", "error");
                  return;
                }
                requestNotifPermission();
              }}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, marginBottom: 4,
                background: notifPermission === "granted" ? "#064E3B" : notifPermission === "denied" ? "#1E293B" : "#1E293B",
                color: notifPermission === "granted" ? "#6EE7B7" : notifPermission === "denied" ? "#F87171" : "#FBBF24",
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icons.Alert />
                {notifPermission === "granted" ? "Notifications: ON" : notifPermission === "denied" ? "Alerts Blocked" : "Enable Notifications"}
              </span>
              {/* Simple visual toggle indicator */}
              <span style={{
                width: 30, height: 16, borderRadius: 99, position: "relative", flexShrink: 0, transition: "background .15s",
                background: notifPermission === "granted" ? "#10B981" : "#475569",
              }}>
                <span style={{
                  position: "absolute", top: 2, left: notifPermission === "granted" ? 16 : 2, width: 12, height: 12,
                  borderRadius: 99, background: "white", transition: "left .15s",
                }} />
              </span>
            </button>
          )}

          {isAdmin && (
            <button onClick={() => setPage("settings")}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: page === "settings" ? "#1E40AF" : "transparent", color: page === "settings" ? "white" : "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: page === "settings" ? 700 : 500, marginBottom: 4 }}
              onMouseEnter={e => { if (page !== "settings") { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "white"; }}}
              onMouseLeave={e => { if (page !== "settings") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}}>
              <Icons.Settings /> Settings
            </button>
          )}

          <button onClick={handleLogout}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, background: "transparent", color: "#94A3B8", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#1E293B"; e.currentTarget.style.color = "#EF4444"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94A3B8"; }}>
            <Icons.Logout /> Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ background: "white", borderBottom: "1px solid #E2E8F0", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: "#0F172A" }}>{pageTitle}</h1>
          {!isAdmin && hasModule("complaints") && page !== "tasks" && (
            <button onClick={() => setShowForm(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              <Icons.Plus /> New Complaint
            </button>
          )}
        </header>

        <div style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>

          {/* ── Dashboard ── */}
          {page === "dashboard" && (
            <Dashboard
              user={user} isAdmin={isAdmin} complaints={complaints} loading={loading}
              setPage={setPage} setCatFilter={setCatFilter} setStaFilter={setStaFilter} setSearch={setSearch}
              onSelectComplaint={setSelected}
            />
          )}

          {/* ── Settings (admin only) — Role Management + Manage Users ── */}
          {page === "settings" && isAdmin && <SettingsPage />}

          {/* ── Software Repository (admin only) ── */}
          {page === "software-repo" && isAdmin && <SoftwareRepository />}

          {/* ── Print Register page ── */}
          {page === "print" && hasModule("print") && <PrintRegister />}

          {/* ── Knowledge References page ── */}
          {page === "knowledge" && hasModule("knowledge") && <KnowledgeReferences isAdmin={isAdmin} />}

          {/* ── Tasks page ── */}
          {page === "tasks" && <TasksPage user={user} isAdmin={isAdmin} />}

          {page === "file-sharing" && <FileSharingPage user={user} />}

          {page === "file-tracking" && <FileTrackingDashboard user={user} isAdmin={isAdmin} />}

          {/* ── Lunch Pass page (under Services) ── */}
          {page === "lunchpass" && hasModule("lunchpass") && <LunchPass />}

          {/* ── List pages ── */}
          {["hardware", "software", "inams", "all"].includes(page) && (
            <>
              <div style={{ background: "white", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #E2E8F0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticket, title, user…" style={{ flex: 1, minWidth: 180, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                {page === "all" && (
                  <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={S.select}>
                    <option value="All">All Categories</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                )}
                <select value={staFilter} onChange={e => setStaFilter(e.target.value)} style={S.select}>
                  <option value="All">All Statuses</option>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                <button onClick={loadComplaints} style={{ padding: "7px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Apply</button>
                <span style={{ fontSize: 12, color: "#94A3B8" }}>{complaints.length} result{complaints.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
                <ComplaintsTable complaints={complaints} onSelect={setSelected} loading={loading} />
              </div>
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      {showForm && <ComplaintForm user={user} onSubmit={handleSubmit} onClose={() => setShowForm(false)} />}
      {selected && (
        <DetailDrawer
          complaint={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onCloseComplaint={handleClose}
          onStatusChange={handleStatusChange}
        />
      )}
      {toast && <Toast {...toast} />}
    </div>
  );
}
