import { useState, useEffect, useCallback, useRef } from "react";
import { api, wopiEditUrl } from "./api.js";
import { Icons, Modal, Badge, Toast, S, PRIORITIES, PRI_COLOR, TASK_STATUSES, TASK_STA_COLOR, TASK_STA_BG, fmtDate } from "./components.jsx";
// A plain .doc (old binary format) can't reliably round-trip through WOPI —
// only .docx is offered the "Open in Word" link; .doc still falls back to
// the existing view/download behavior below.
function isWopiEditable(name) {
  return !!name && name.toLowerCase().endsWith(".docx");
}

// due_date is stored as a plain "YYYY-MM-DD" calendar date (no time/timezone
// component), so it's compared and formatted as-is rather than through
// fmtDateOnly (which expects a UTC timestamp).
function istTodayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "YYYY-MM-DD"
}
function fmtDue(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
}
function dueState(task) {
  if (task.status === "Completed") return "done";
  const today = istTodayStr();
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "today";
  return "upcoming";
}
const DUE_COLOR = { overdue: "#EF4444", today: "#F59E0B", upcoming: "#64748B", done: "#10B981" };
const DUE_LABEL = { overdue: "Overdue", today: "Due Today", upcoming: "Upcoming", done: "Completed" };

// A non-admin can only fully manage (edit/delete) a task they both created
// and are assigned to — i.e. their own personal task. A task an admin
// assigned to them can still have its status changed and be commented on,
// just not edited or deleted.
function canManage(t, user, isAdmin) {
  return isAdmin || (t.assignee_type === "user" && t.assigned_to === user.id && t.assigned_by === user.id);
}
function canChangeStatus(t, user, isAdmin) {
  return isAdmin || (t.assignee_type === "user" && t.assigned_to === user.id);
}

function fmtFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

// Deterministic color per person (by name) so each participant in a comment
// thread is visually distinguishable at a glance, consistent across reloads.
const AUTHOR_PALETTE = [
  "#0E7490", "#7C3AED", "#B45309", "#0F766E", "#BE185D", "#4338CA", "#15803D", "#B91C1C",
];
function authorColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AUTHOR_PALETTE[hash % AUTHOR_PALETTE.length];
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Clicking the filename, or the eye icon beside it, opens the file in an
// in-app view-mode modal (never a new browser tab or direct download) —
// images render directly, everything else renders in an iframe. `mine`
// switches to a light-on-dark style for use inside an own-message chat
// bubble. Actual download only happens via the explicit "Download" button
// inside that modal.
function AttachmentChip({ path: filePath, name, size, type, mine, wopiId, editedByName, editedAt }) {
  const [preview, setPreview] = useState(false);
  if (!filePath) return null;
  const mutedColor = mine ? "#ffffffb0" : "#94A3B8";
  const isImage = type === "Image";
  const wopiEditable = type === "Word" && wopiId && isWopiEditable(name);

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "5px 6px 5px 10px", borderRadius: 7,
        fontSize: 12, fontWeight: 600, maxWidth: "100%", width: "fit-content", boxSizing: "border-box",
        overflow: "hidden", minWidth: 0,
        background: mine ? "#ffffff26" : "#F8FAFC",
        border: mine ? "1px solid #ffffff40" : "1px solid #E2E8F0",
        color: mine ? "white" : "#334155",
      }}>
        <button type="button" onClick={() => setPreview(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", overflow: "hidden", minWidth: 0, flex: "0 1 auto" }}
          title={`View ${name}`}>
          <Icons.File />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: 220 }}>{name}</span>
          <span style={{ color: mutedColor, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }}>{type ? `· ${type}` : ""} {size ? `· ${fmtFileSize(size)}` : ""}</span>
        </button>
        {wopiEditable && (
          <a href={wopiEditUrl(wopiId)} onClick={e => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, color: "inherit", flexShrink: 0, opacity: 0.85, textDecoration: "none" }}
            title="Open in Word (edits save back here automatically)">
            <Icons.Edit />
          </a>
        )}
        <button type="button" onClick={e => { e.stopPropagation(); setPreview(true); }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, color: "inherit", flexShrink: 0, opacity: 0.85, background: "none", border: "none", cursor: "pointer" }}
          title={`View ${name}`}>
          <EyeIcon />
        </button>
      </div>

      {editedAt && (
        <div style={{ fontSize: 11, color: mutedColor, marginTop: 3, paddingLeft: 10 }}>
          Last edited by {editedByName || "someone"} · {fmtDate(editedAt)}
        </div>
      )}

      {preview && (
        // scrollBody={false}: this panel manages its own fixed-height layout
        // below, so the outer card must never scroll on its own — otherwise
        // a tall iframe/image produces a second scrollbar on top of the
        // iframe's own, and the close button (anchored to the card) drifts
        // as the card scrolls.
        <Modal onClose={() => setPreview(false)} width={isImage ? 640 : 820} scrollBody={false}>
          <button type="button" onClick={e => { e.currentTarget.blur(); setPreview(false); }} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}><Icons.Close /></button>
          <div style={{ height: "calc(90vh - 64px)", maxHeight: "calc(90vh - 64px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <h3 title={name} style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, marginBottom: 16, paddingRight: 30, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</h3>
            <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {isImage ? (
                <img src={filePath} alt={name} style={{ display: "block", maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }} />
              ) : (
                <iframe src={filePath} title={name} style={{ width: "100%", height: "100%", border: "none", borderRadius: 8 }} />
              )}
            </div>
            <div style={{ flexShrink: 0, marginTop: 14, textAlign: "right" }}>
              <a href={filePath} download={name} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 8, color: "#0E7490", fontWeight: 700, fontSize: 12.5, textDecoration: "none" }}>
                <Icons.Download /> Download
              </a>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function TasksPage({ user, isAdmin }) {
  // Admins land on a hub and pick IT Staff Tasks or User Tasks first, so the
  // two never show mixed together. Non-admins only ever have "user" tasks
  // (their own), so they skip the hub entirely.
  const [section, setSection] = useState(isAdmin ? null : "user");
  const [hubCounts, setHubCounts] = useState(null);
  const [hubLoading, setHubLoading] = useState(true);

  const loadHubCounts = useCallback(async () => {
    setHubLoading(true);
    try {
      const [staffTasks, userTasks] = await Promise.all([
        api.getTasks({ assignee_type: "staff" }),
        api.getTasks({ assignee_type: "user" }),
      ]);
      const summarize = (list) => ({
        total: list.length,
        pending: list.filter(t => t.status !== "Completed").length,
        overdue: list.filter(t => t.status !== "Completed" && t.due_date < istTodayStr()).length,
      });
      setHubCounts({ staff: summarize(staffTasks), user: summarize(userTasks) });
    } catch {
      // Non-fatal — tiles just show without counts.
    } finally {
      setHubLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin && !section) loadHubCounts(); }, [isAdmin, section, loadHubCounts]);

  if (isAdmin && !section) {
    return <TasksHub counts={hubCounts} loading={hubLoading} onSelect={setSection} />;
  }

  return (
    <TaskSectionView
      user={user}
      isAdmin={isAdmin}
      section={section}
      onBack={isAdmin ? () => setSection(null) : null}
    />
  );
}

// ─── Hub: large IT Staff Tasks / User Tasks selector (admin only) ─────────────
function TasksHub({ counts, loading, onSelect }) {
  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>Tasks</h2>
      <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 24 }}>Choose a category to view and manage tasks.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, maxWidth: 760 }}>
        <HubTile
          icon={<Icons.Users />}
          title="IT Staff Tasks"
          subtitle="Work assigned to named IT staff"
          color="#7C3AED"
          bg="#F5F3FF"
          loading={loading}
          stats={counts?.staff}
          onClick={() => onSelect("staff")}
        />
        <HubTile
          icon={<Icons.Tasks />}
          title="User Tasks"
          subtitle="Assigned to local & domain user accounts"
          color="#0E7490"
          bg="#F0FDFA"
          loading={loading}
          stats={counts?.user}
          onClick={() => onSelect("user")}
        />
      </div>
    </div>
  );
}

function HubTile({ icon, title, subtitle, color, bg, stats, loading, onClick }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", padding: "28px 26px", borderRadius: 16, border: `1.5px solid ${color}30`, background: "white", cursor: "pointer", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 1px 3px #0000000d", transition: "transform .15s, box-shadow .15s" }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 28px #00000014"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 3px #0000000d"; }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: bg, color, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ transform: "scale(1.7)", display: "flex" }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#0F172A" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#94A3B8", marginTop: 3 }}>{subtitle}</div>
      </div>
      {loading ? (
        <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
      ) : (
        <div style={{ display: "flex", gap: 22 }}>
          <StatPill label="Total" value={stats?.total ?? 0} color="#334155" />
          <StatPill label="Pending" value={stats?.pending ?? 0} color="#F59E0B" />
          <StatPill label="Overdue" value={stats?.overdue ?? 0} color="#EF4444" />
        </div>
      )}
      <div style={{ fontSize: 12.5, fontWeight: 700, color, display: "flex", alignItems: "center", gap: 4 }}>
        View {title} <Icons.Chevron />
      </div>
    </button>
  );
}

function StatPill({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 19, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

// ─── Section view: the actual task list/table for one category ────────────────
function TaskSectionView({ user, isAdmin, section, onBack }) {
  const [tasks, setTasks]       = useState([]);
  const [staff, setStaff]       = useState([]);
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [showStaffMgr, setShowStaffMgr] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [editing, setEditing]   = useState(null);
  const [toast, setToast]       = useState(null);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch]     = useState("");

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (isAdmin) params.assignee_type = section;
      if (statusFilter !== "All") params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      setTasks(await api.getTasks(params));
    } catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, [statusFilter, search, isAdmin, section]);

  const loadStaff = useCallback(() => api.getStaff().then(setStaff).catch(() => {}), []);
  const loadUsers = useCallback(() => api.getUsers().then(setUsers).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isAdmin && section === "staff") loadStaff();
    if (isAdmin && section === "user") loadUsers();
  }, [isAdmin, section, loadStaff, loadUsers]);

  async function handleStatusChange(task, status) {
    try {
      await api.updateTaskStatus(task.id, status);
      showToast(status === "Completed" ? "Task marked completed." : `Status updated to ${status}.`);
      load();
    } catch (e) { showToast(e.message, "error"); }
  }

  async function handleDelete(task) {
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    try { await api.deleteTask(task.id); showToast("Task deleted."); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  const openCount = tasks.filter(t => t.status !== "Completed").length;
  const heading = !isAdmin ? "My Tasks" : section === "staff" ? "IT Staff Tasks" : "User Tasks";
  const subheading = !isAdmin
    ? "track your own to-dos and anything assigned to you"
    : section === "staff" ? "work assigned to named IT staff" : "work assigned to local & domain user accounts";

  return (
    <div>
      {onBack && (
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#64748B", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 14 }}>
          <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icons.Chevron /></span> Back to Tasks Overview
        </button>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>{heading} ({tasks.length})</h2>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{openCount} pending / in progress — {subheading}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {isAdmin && section === "staff" && (
            <button onClick={() => setShowStaffMgr(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "white", color: "#334155", border: "1px solid #E2E8F0", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              <Icons.Users /> Manage Staff
            </button>
          )}
          <button onClick={() => setShowAssign(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            <Icons.Plus /> {isAdmin ? "Assign Task" : "New Task"}
          </button>
        </div>
      </div>

      <div style={{ background: "white", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #E2E8F0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task title…" style={{ flex: 1, minWidth: 180, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.select}>
          <option value="All">All Statuses</option>
          {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <TasksTable
          tasks={tasks}
          loading={loading}
          isAdmin={isAdmin}
          user={user}
          onView={(t) => setDetailTaskId(t.id)}
          onStatusChange={handleStatusChange}
          onEdit={setEditing}
          onDelete={handleDelete}
        />
      </div>

      {showAssign && (
        <TaskFormModal
          isAdmin={isAdmin}
          lockedType={isAdmin ? section : null}
          staff={staff}
          users={users}
          currentUser={user}
          onStaffAdded={loadStaff}
          onClose={() => setShowAssign(false)}
          onSaved={() => { load(); setShowAssign(false); showToast(isAdmin ? "Task assigned." : "Task created."); }}
        />
      )}
      {editing && (
        <TaskFormModal
          task={editing}
          isAdmin={isAdmin}
          lockedType={isAdmin ? section : null}
          staff={staff}
          users={users}
          currentUser={user}
          onStaffAdded={loadStaff}
          onClose={() => setEditing(null)}
          onSaved={() => { load(); setEditing(null); showToast("Task updated."); }}
        />
      )}
      {showStaffMgr && (
        <StaffManagerModal
          onClose={() => { setShowStaffMgr(false); loadStaff(); load(); }}
          showToast={showToast}
        />
      )}
      {detailTaskId && (
        <TaskDetailModal
          taskId={detailTaskId}
          user={user}
          isAdmin={isAdmin}
          onClose={() => setDetailTaskId(null)}
          onChanged={load}
          showToast={showToast}
        />
      )}
      {toast && <Toast {...toast} />}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────
function TasksTable({ tasks, loading, isAdmin, user, onView, onStatusChange, onEdit, onDelete }) {
  if (loading) return <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>;
  if (!tasks.length) return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
      <Icons.Tasks />
      <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1", marginTop: 10 }}>No tasks found</p>
    </div>
  );

  const headers = isAdmin
    ? ["Title", "Assigned To", "Assigned By", "Priority", "Due", "Status", "Actions"]
    : ["Title", "Assigned By", "Priority", "Due", "Status", "Actions"];

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0" }}>
            {headers.map(h => (
              <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t, i) => {
            const ds = dueState(t);
            const manage = canManage(t, user, isAdmin);
            const changeStatus = canChangeStatus(t, user, isAdmin);
            const isSelfCreated = t.assignee_type === "user" && t.assigned_by === user.id && t.assigned_to === user.id;
            return (
              <tr key={t.id} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "white" : "#FAFCFF" }}>
                <td style={{ padding: "11px 14px", maxWidth: 240, cursor: "pointer" }} onClick={() => onView(t)}>
                  <div style={{ fontWeight: 600, color: "#0E7490", display: "flex", alignItems: "center", gap: 6 }}>
                    {t.title}
                    {t.attachment_path && <span style={{ color: "#94A3B8", display: "inline-flex", flexShrink: 0 }} title="Has an attachment"><Icons.Paperclip /></span>}
                  </div>
                  {t.description && <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>}
                </td>
                {isAdmin && (
                  <td style={{ padding: "11px 14px", color: "#475569", whiteSpace: "nowrap" }}>
                    {t.assigned_to_name}
                    {!t.assigned_to_active && <span style={{ marginLeft: 6, fontSize: 10, color: "#94A3B8" }}>(inactive)</span>}
                  </td>
                )}
                <td style={{ padding: "11px 14px", color: "#94A3B8", whiteSpace: "nowrap", fontSize: 12 }}>
                  {isSelfCreated ? "You" : t.assigned_by_name}
                </td>
                <td style={{ padding: "11px 14px" }}><Badge label={t.priority} color={PRI_COLOR[t.priority]} /></td>
                <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: DUE_COLOR[ds], fontWeight: 600, fontSize: 12.5 }}>
                    <Icons.Calendar /> {fmtDue(t.due_date)}
                  </div>
                  {ds !== "done" && <div style={{ fontSize: 10.5, color: DUE_COLOR[ds], fontWeight: 700, marginTop: 2 }}>{DUE_LABEL[ds]}</div>}
                </td>
                <td style={{ padding: "11px 14px" }}>
                  {changeStatus ? (
                    <select value={t.status} onChange={e => onStatusChange(t, e.target.value)}
                      style={{ ...S.select, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, color: TASK_STA_COLOR[t.status], background: TASK_STA_BG[t.status], border: `1px solid ${TASK_STA_COLOR[t.status]}40` }}>
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <Badge label={t.status} color={TASK_STA_COLOR[t.status]} bg={TASK_STA_BG[t.status]} />
                  )}
                </td>
                <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                    <button onClick={() => onView(t)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 7, color: "#0E7490", fontWeight: 700, fontSize: 11.5, cursor: "pointer", flexShrink: 0 }} title="View task & add a comment">
                      <Icons.Comment /> Comments{t.comment_count > 0 ? ` (${t.comment_count})` : ""}
                    </button>
                    {manage && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => onEdit(t)} style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 7, color: "#1D4ED8", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>Edit</button>
                        <button onClick={() => onDelete(t)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 28, width: 28, padding: 0, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, color: "#DC2626", cursor: "pointer" }}><Icons.Trash /></button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Assign / Edit Modal ───────────────────────────────────────────────────────
// lockedType: when set ('user' or 'staff'), the form is being opened from
// within that section of the admin hub, so the User Account / IT Staff
// toggle is hidden entirely and the type can't be changed — keeps the two
// categories from ever getting mixed up while assigning.
function TaskFormModal({ task, isAdmin, lockedType, staff, users, currentUser, onStaffAdded, onClose, onSaved }) {
  const [title, setTitle]             = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [assigneeType, setAssigneeType] = useState(task?.assignee_type || lockedType || "user");
  const [assignedTo, setAssignedTo]   = useState(task ? task.assigned_to : "");
  const [assignAll, setAssignAll]     = useState(false);
  const [priority, setPriority]       = useState(task?.priority || "Medium");
  const [dueDate, setDueDate]         = useState(task?.due_date || istTodayStr());
  const [attachment, setAttachment]   = useState(null); // optional file, create only
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);

  // Inline "+ Add New Staff" — lets the admin add someone to the IT staff
  // directory without leaving the assign form, then auto-selects them.
  const [addingStaff, setAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffDept, setNewStaffDept] = useState("");
  const [staffError, setStaffError]   = useState("");
  const [staffSaving, setStaffSaving] = useState(false);

  const showAssigneeFields = isAdmin; // non-admins never see an "assign to" section

  async function handleAddStaff() {
    if (!newStaffName.trim()) return setStaffError("Enter a name.");
    setStaffSaving(true); setStaffError("");
    try {
      const created = await api.addStaff({ name: newStaffName.trim(), department: newStaffDept.trim() });
      onStaffAdded();
      setAssignedTo(created.id);
      setAddingStaff(false);
      setNewStaffName(""); setNewStaffDept("");
    } catch (e) { setStaffError(e.message); }
    finally { setStaffSaving(false); }
  }

  async function handleSubmit() {
    if (!title.trim()) return setError("Task title is required.");
    if (!dueDate) return setError("Due date is required.");
    if (showAssigneeFields) {
      if (assigneeType === "user" && !assignAll && !assignedTo) return setError("Please choose a user account, or check \u201cassign to all users\u201d.");
      if (assigneeType === "staff" && !assignedTo) return setError("Please choose an IT staff member.");
    }
    setLoading(true); setError("");
    try {
      const payload = { title, description, priority, due_date: dueDate };
      if (showAssigneeFields) {
        payload.assignee_type = assigneeType;
        payload.assigned_to = assigneeType === "user" && assignAll ? "ALL" : assignedTo;
      }
      if (task) await api.updateTask(task.id, payload);
      else await api.createTask({ ...payload, attachment });
      onSaved();
    } catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <button type="button" onClick={e => { e.currentTarget.blur(); onClose(); }} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{task ? "Edit Task" : isAdmin ? "Assign New Task" : "New Task"}</h3>
      {showAssigneeFields && lockedType && (
        <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 16 }}>
          {lockedType === "staff" ? "Assigning to an IT staff member." : "Assigning to a user account."}
        </p>
      )}
      {!lockedType && <div style={{ marginBottom: 16 }} />}

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <label style={S.label}>Task Title *</label>
      <input style={{ ...S.input, marginBottom: 16 }} placeholder="e.g. Replace faulty switch in Server Room" value={title} onChange={e => setTitle(e.target.value)} />

      <label style={S.label}>Description (optional)</label>
      <textarea style={{ ...S.input, height: 70, resize: "vertical", marginBottom: 12 }} placeholder="Additional details or instructions…" value={description} onChange={e => setDescription(e.target.value)} />

      {!task && (
        <div style={{ marginBottom: 16 }}>
          {!attachment ? (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 8, color: "#64748B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <Icons.Paperclip /> Attach a file (optional)
              <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx" style={{ display: "none" }}
                onChange={e => setAttachment(e.target.files?.[0] || null)} />
            </label>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 8, fontSize: 12, color: "#0E7490", fontWeight: 600 }}>
              <Icons.File /> {attachment.name}
              <button type="button" onClick={() => setAttachment(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#0E7490", padding: 0, display: "flex" }}><Icons.Close /></button>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 5 }}>Images, PDF, Word, Excel, or PowerPoint — up to 15MB.</div>
        </div>
      )}

      {showAssigneeFields && (
        <>
          {!lockedType && (
            <>
              <label style={S.label}>Assign To *</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" onClick={() => { setAssigneeType("user"); setAssignedTo(""); setAssignAll(false); }}
                  style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: assigneeType === "user" ? "1.5px solid #0E7490" : "1px solid #E2E8F0", background: assigneeType === "user" ? "#F0FDFA" : "white", color: assigneeType === "user" ? "#0E7490" : "#64748B" }}>
                  User Account
                </button>
                <button type="button" onClick={() => { setAssigneeType("staff"); setAssignedTo(""); setAssignAll(false); }}
                  style={{ flex: 1, padding: 9, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: assigneeType === "staff" ? "1.5px solid #8B5CF6" : "1px solid #E2E8F0", background: assigneeType === "staff" ? "#F5F3FF" : "white", color: assigneeType === "staff" ? "#7C3AED" : "#64748B" }}>
                  IT Staff (by name)
                </button>
              </div>
            </>
          )}

          {assigneeType === "user" ? (
            <div style={{ marginBottom: 16 }}>
              {!task && (
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#334155", marginBottom: 10, cursor: "pointer", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                  <input type="checkbox" checked={assignAll} onChange={e => { setAssignAll(e.target.checked); setAssignedTo(""); }} />
                  Assign to <strong>all</strong> local &amp; domain user accounts
                </label>
              )}
              {!assignAll && (
                <select style={{ ...S.input, cursor: "pointer" }} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                  <option value="">Select user account…</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.department} ({u.auth_source === "ad" ? "Domain" : "Local"})</option>)}
                </select>
              )}
            </div>
          ) : (
            !addingStaff ? (
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <select style={{ ...S.input, cursor: "pointer", flex: 1 }} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                  <option value="">Select IT staff member…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}{s.department ? ` — ${s.department}` : ""}</option>)}
                </select>
                <button onClick={() => setAddingStaff(true)} type="button" style={{ padding: "0 14px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 8, color: "#0E7490", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                  + New Staff
                </button>
              </div>
            ) : (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: 12, marginBottom: 16 }}>
                {staffError && <div style={{ color: "#DC2626", fontSize: 12, marginBottom: 8 }}>{staffError}</div>}
                <input style={{ ...S.input, marginBottom: 8 }} placeholder="New IT staff member's name" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} autoFocus />
                <input style={{ ...S.input, marginBottom: 10 }} placeholder="Department (optional)" value={newStaffDept} onChange={e => setNewStaffDept(e.target.value)} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setAddingStaff(false); setStaffError(""); }} type="button" style={{ flex: 1, padding: 8, background: "white", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, fontWeight: 600, color: "#64748B", cursor: "pointer" }}>Cancel</button>
                  <button onClick={handleAddStaff} type="button" disabled={staffSaving} style={{ flex: 1, padding: 8, background: "#0E7490", border: "none", borderRadius: 7, fontSize: 12.5, fontWeight: 700, color: "white", cursor: "pointer" }}>
                    {staffSaving ? "Adding…" : "Add & Select"}
                  </button>
                </div>
              </div>
            )
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Priority</label>
          <select style={{ ...S.input, cursor: "pointer" }} value={priority} onChange={e => setPriority(e.target.value)}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Due Date *</label>
          <input type="date" style={S.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Saving…" : task ? "Save Changes" : (assignAll ? "Assign to All Users" : isAdmin ? "Assign Task" : "Create Task")}
        </button>
      </div>
    </Modal>
  );
}

// ─── Task Detail + Comments Modal ──────────────────────────────────────────────
function TaskDetailModal({ taskId, user, isAdmin, onClose, onChanged, showToast }) {
  const [task, setTask]         = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [newComment, setNewComment] = useState("");
  const [commentFile, setCommentFile] = useState(null);
  const [posting, setPosting]   = useState(false);
  const commentsBoxRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([api.getTask(taskId), api.getTaskComments(taskId)]);
      setTask(t); setComments(c);
    } catch (e) { showToast(e.message, "error"); onClose(); }
    finally { setLoading(false); }
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Always land on the latest comment/activity — otherwise the pane opens
  // scrolled to the top and older messages, which reads as if the thread is
  // empty/stale. The comment list is the only scrollable region now (see
  // layout below), so this is the only ref that needs to move. A rAF tick is
  // used so this runs after the browser has actually laid out the newly
  // rendered comments (scrollHeight right after a state update can still
  // reflect the pre-render size).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (commentsBoxRef.current) {
        commentsBoxRef.current.scrollTop = commentsBoxRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [comments]);

  async function handleStatusChange(status) {
    try {
      const updated = await api.updateTaskStatus(taskId, status);
      setTask(updated);
      onChanged();
      showToast(status === "Completed" ? "Task marked completed." : `Status updated to ${status}.`);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function handlePostComment() {
    if (!newComment.trim() && !commentFile) return;
    setPosting(true);
    try {
      const c = await api.addTaskComment(taskId, newComment.trim(), commentFile);
      setComments(prev => [...prev, c]);
      setNewComment("");
      setCommentFile(null);
      onChanged(); // refresh list so the comment-count badge updates
    } catch (e) { showToast(e.message, "error"); }
    finally { setPosting(false); }
  }

  if (loading || !task) {
    return <Modal onClose={onClose} width={560}><div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div></Modal>;
  }

  const ds = dueState(task);
  const changeStatus = canChangeStatus(task, user, isAdmin);
  const isSelfCreated = task.assignee_type === "user" && task.assigned_by === user.id && task.assigned_to === user.id;

  return (
    <Modal onClose={onClose} width={560} scrollBody={false}>
      <button type="button" onClick={e => { e.currentTarget.blur(); onClose(); }} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}><Icons.Close /></button>

      {/* Fixed-height flex column: the details above stay static (no scroll
          of their own) and only the Activity & Comments pane below grows to
          fill the remaining space and scrolls internally. This keeps there
          from ever being two nested scrollbars, and keeps the close button
          (positioned relative to the card, not this column) from moving. */}
      <div style={{ height: "calc(90vh - 64px)", maxHeight: "calc(90vh - 64px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      <div style={{ flexShrink: 0 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, paddingRight: 30 }}>{task.title}</h3>
      {task.description && <p style={{ fontSize: 13, color: "#64748B", marginBottom: 10 }}>{task.description}</p>}
      {task.attachment_path && (
        <div style={{ marginBottom: 14 }}>
          <AttachmentChip path={task.attachment_path} name={task.attachment_name} size={task.attachment_size} type={task.attachment_type}
            wopiId={`t${task.id}`} editedByName={task.attachment_edited_by_name} editedAt={task.attachment_edited_at} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {isAdmin && (
          <DetailField label="Assigned To" value={`${task.assigned_to_name}${task.assignee_type === "staff" ? " (IT Staff)" : ""}`} />
        )}
        <DetailField label="Assigned By" value={isSelfCreated ? "You" : task.assigned_by_name} />
        <DetailField label="Priority" value={<Badge label={task.priority} color={PRI_COLOR[task.priority]} />} />
        <DetailField label="Due Date" value={<span style={{ color: DUE_COLOR[ds], fontWeight: 700 }}>{fmtDue(task.due_date)} · {DUE_LABEL[ds]}</span>} />
        <DetailField label="Created" value={fmtDate(task.created_at)} />
        <DetailField label="Last Updated" value={fmtDate(task.updated_at)} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={S.label}>Status</label>
        {changeStatus ? (
          <select value={task.status} onChange={e => handleStatusChange(e.target.value)}
            style={{ ...S.input, cursor: "pointer", fontWeight: 700, color: TASK_STA_COLOR[task.status], background: TASK_STA_BG[task.status] }}>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <div><Badge label={task.status} color={TASK_STA_COLOR[task.status]} bg={TASK_STA_BG[task.status]} /></div>
        )}
      </div>
      </div>

      <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: 14, flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <label style={{ ...S.label, marginBottom: 10, flexShrink: 0 }}>Activity &amp; Comments ({comments.length})</label>
        <div ref={commentsBoxRef} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginBottom: 12, background: "#F8FAFC", border: "1px solid #F1F5F9", borderRadius: 10, padding: comments.length ? 12 : 0 }}>
          {!comments.length ? (
            <p style={{ fontSize: 12.5, color: "#94A3B8", padding: "18px 14px" }}>No comments yet. Add one below — it'll be timestamped automatically.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {comments.map((c, i) => {
                const mine = c.author_id === user.id;
                const prevSameAuthor = i > 0 && comments[i - 1].author_id === c.author_id;
                const color = authorColor(c.author_name);
                return (
                  <div key={c.id} style={{ display: "flex", flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end", gap: 8 }}>
                    <div style={{ width: 26, flexShrink: 0, visibility: prevSameAuthor ? "hidden" : "visible" }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: mine ? "#0E7490" : color, color: "white", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {initials(c.author_name)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", maxWidth: "76%" }}>
                      {!prevSameAuthor && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: mine ? "#0E7490" : color, marginBottom: 3, padding: "0 4px" }}>
                          {mine ? "You" : c.author_name}
                        </span>
                      )}
                      <div style={{
                        background: mine ? "linear-gradient(135deg,#0E7490,#1E40AF)" : "white",
                        color: mine ? "white" : "#1E293B",
                        border: mine ? "none" : "1px solid #E2E8F0",
                        borderRadius: mine ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
                        padding: "8px 12px",
                        boxShadow: "0 1px 2px #0000000a",
                      }}>
                        {c.comment && <p style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{c.comment}</p>}
                        {c.attachment_path && (
                          <div style={{ marginTop: c.comment ? 6 : 0 }}>
                            <AttachmentChip path={c.attachment_path} name={c.attachment_name} size={c.attachment_size} type={c.attachment_type} mine={mine}
                              wopiId={`c${c.id}`} editedByName={c.attachment_edited_by_name} editedAt={c.attachment_edited_at} />
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: "#94A3B8", marginTop: 3, padding: "0 4px" }}>{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
        {commentFile && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 8, fontSize: 11.5, color: "#0E7490", fontWeight: 600, marginBottom: 8, maxWidth: "100%", overflow: "hidden" }}>
            <Icons.File /> <span title={commentFile.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, maxWidth: 260 }}>{commentFile.name}</span>
            <button type="button" onClick={() => setCommentFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#0E7490", padding: 0, display: "flex", flexShrink: 0 }}><Icons.Close /></button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a comment or update…"
            style={{ ...S.input, flex: 1, height: 44, resize: "vertical", fontSize: 13 }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }} />
          <label title="Attach a file (optional)" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, color: "#64748B", cursor: "pointer", flexShrink: 0 }}>
            <Icons.Paperclip />
            <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx" style={{ display: "none" }}
              onChange={e => setCommentFile(e.target.files?.[0] || null)} />
          </label>
          <button type="button" onClick={handlePostComment} disabled={posting || (!newComment.trim() && !commentFile)}
            style={{ padding: "0 16px", height: 38, background: posting || (!newComment.trim() && !commentFile) ? "#CBD5E1" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: posting || (!newComment.trim() && !commentFile) ? "not-allowed" : "pointer", flexShrink: 0 }}>
            Post
          </button>
        </div>
        </div>
      </div>
      </div>
    </Modal>
  );
}

function DetailField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#1E293B" }}>{value}</div>
    </div>
  );
}

// ─── Staff Manager Modal ────────────────────────────────────────────────────────
function StaffManagerModal({ onClose, showToast }) {
  const [staff, setStaff]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [name, setName]       = useState("");
  const [dept, setDept]       = useState("");
  const [error, setError]     = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName]   = useState("");
  const [editDept, setEditDept]   = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.getStaff(showInactive).then(setStaff).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!name.trim()) return setError("Enter a name.");
    setError("");
    try {
      await api.addStaff({ name: name.trim(), department: dept.trim() });
      setName(""); setDept(""); load();
      showToast("Staff member added.");
    } catch (e) { setError(e.message); }
  }

  async function handleToggleActive(s) {
    try { await api.updateStaff(s.id, { active: !s.active }); load(); showToast(s.active ? "Staff member deactivated." : "Staff member reactivated."); }
    catch (e) { showToast(e.message, "error"); }
  }

  function startEdit(s) { setEditingId(s.id); setEditName(s.name); setEditDept(s.department || ""); }

  async function saveEdit(id) {
    if (!editName.trim()) return;
    try { await api.updateStaff(id, { name: editName.trim(), department: editDept.trim() }); setEditingId(null); load(); showToast("Staff member updated."); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function handleDelete(s) {
    if (!window.confirm(`Remove "${s.name}" from the IT staff list?`)) return;
    try {
      const result = await api.deleteStaff(s.id);
      load();
      showToast(result.message || "Staff member removed.");
    } catch (e) { showToast(e.message, "error"); }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <button type="button" onClick={e => { e.currentTarget.blur(); onClose(); }} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Manage IT Staff</h3>
      <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>These are the names available when assigning a task to IT Staff — separate from user login accounts.</p>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input style={{ ...S.input, flex: 1 }} placeholder="Staff member name" value={name} onChange={e => setName(e.target.value)} />
        <input style={{ ...S.input, flex: 1 }} placeholder="Department (optional)" value={dept} onChange={e => setDept(e.target.value)} />
        <button onClick={handleAdd} style={{ padding: "0 16px", background: "#0E7490", border: "none", borderRadius: 8, color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add</button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B", marginBottom: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show deactivated staff
      </label>

      <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #E2E8F0", borderRadius: 9 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 30 }}><span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} /></div>
        ) : !staff.length ? (
          <div style={{ textAlign: "center", padding: 30, color: "#94A3B8", fontSize: 13 }}>No staff added yet.</div>
        ) : staff.map((s, i) => (
          <div key={s.id} style={{ padding: "10px 14px", borderBottom: i < staff.length - 1 ? "1px solid #F1F5F9" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, opacity: s.active ? 1 : 0.55 }}>
            {editingId === s.id ? (
              <div style={{ display: "flex", gap: 6, flex: 1 }}>
                <input style={{ ...S.input, padding: "5px 8px", fontSize: 12.5 }} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                <input style={{ ...S.input, padding: "5px 8px", fontSize: 12.5 }} value={editDept} onChange={e => setEditDept(e.target.value)} placeholder="Dept" />
                <button onClick={() => saveEdit(s.id)} style={{ padding: "5px 10px", background: "#0E7490", border: "none", borderRadius: 6, color: "white", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Save</button>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{s.name} {!s.active && <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500 }}>(inactive)</span>}</div>
                  {s.department && <div style={{ fontSize: 11.5, color: "#94A3B8" }}>{s.department}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => startEdit(s)} style={{ padding: "5px 9px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, color: "#1D4ED8", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Rename</button>
                  <button onClick={() => handleToggleActive(s)} style={{ padding: "5px 9px", background: s.active ? "#FFFBEB" : "#ECFDF5", border: `1px solid ${s.active ? "#FDE68A" : "#A7F3D0"}`, borderRadius: 6, color: s.active ? "#B45309" : "#047857", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    {s.active ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(s)} style={{ padding: "5px 8px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, color: "#DC2626", cursor: "pointer" }}><Icons.Trash /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
