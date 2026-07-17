import { useState, useEffect, useCallback, useRef } from "react";
import { api, fileTrackingDownloadUrl, fileTrackingViewUrl } from "./api.js";
import { Icons, Modal, Badge, Toast, S, fmtDate } from "./components.jsx";

// ─── Constants ──────────────────────────────────────────────────────────────
const PRIORITIES = ["Low", "Medium", "High"];
const NEW_FILE_STATUSES = ["Pending", "In Progress", "Completed"];
const PRI_ROW_BG   = { High: "#FCA5A5", Medium: "#FDE68A", Low: "#86EFAC" };
const PRI_BADGE    = { Low: "#16A34A", Medium: "#CA8A04", High: "#DC2626" };
const AGE_COLOR    = { green: "#16A34A", yellow: "#CA8A04", orange: "#EA580C", red: "#DC2626" };
const AGE_BG       = { green: "#F0FDF4", yellow: "#FEFCE8", orange: "#FFF7ED", red: "#FEF2F2" };

function rowBackground(task) {
  if (task.status === "Closed") return "#CBD5E1";
  if (task.status === "Completed") return "#93C5FD";
  return PRI_ROW_BG[task.priority] || "white";
}

const CARDS = [
  { key: "pending", label: "Pending", statKey: "pending", color: "#CA8A04" },
  { key: "in-progress", label: "In Progress", statKey: "inProgress", color: "#2563EB" },
  { key: "completed", label: "Completed", statKey: "completed", color: "#16A34A" },
  { key: "overdue", label: "Overdue", statKey: "overdue", color: "#DC2626" },
  { key: "mine", label: "My Files", statKey: "myFiles", color: "#7C3AED" },
  { key: "pinned", label: "Pinned Files", statKey: "pinnedFiles", color: "#0E7490" },
];

const COLUMNS = [
  { key: "serial", label: "S.No", width: 55, sortable: false },
  { key: "pin", label: "", width: 40, sortable: false },
  { key: "file_no", label: "File No", width: 160, sortable: true },
  { key: "subject", label: "Subject", width: 320, sortable: true },
  { key: "current_holder", label: "Current Holder", width: 170, sortable: true },
  { key: "status", label: "Status", width: 140, sortable: true },
  { key: "file_age", label: "File Age", width: 120, sortable: true },
  { key: "due_date", label: "Due Date", width: 120, sortable: true },
  { key: "last_updated", label: "Last Updated", width: 160, sortable: true },
];

function fmtDateOnlyPlain(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + (dateStr.length <= 10 ? "" : "Z"));
  if (isNaN(d)) return "—";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return dateStr.length <= 10
    ? `${dateStr.slice(8,10)} ${months[parseInt(dateStr.slice(5,7),10)-1]} ${dateStr.slice(0,4)}`
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function PrinterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function capitalizeSentences(text) {
  if (!text) return text;
  let result = text.replace(/^(\s*)([a-z])/, (m, p1, p2) => p1 + p2.toUpperCase());
  result = result.replace(/([.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  return result;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function openPrintWindow(title, bodyHtml) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; margin: 0; padding: 0; }
          h1 { font-size: 16px; margin: 0 0 2px; }
          .sub { font-size: 11px; color: #64748B; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
          th, td { border: 1px solid #CBD5E1; padding: 5px 6px; text-align: left; vertical-align: top; }
          th { background: #F1F5F9; font-weight: 700; text-transform: uppercase; font-size: 9px; }
          tr, .entry { page-break-inside: avoid; }
          .entry { border-bottom: 1px solid #E2E8F0; padding: 10px 0; }
          .date { font-size: 10.5px; color: #94A3B8; font-weight: 600; }
          .remarks { font-size: 13px; font-weight: 700; margin-top: 3px; white-space: pre-wrap; }
          .moved { font-size: 11px; font-weight: 600; color: #0E7490; margin-top: 3px; }
          .status { font-size: 10.5px; color: #64748B; margin-top: 2px; }
        </style>
      </head>
      <body>
        ${bodyHtml}
      </body>
    </html>
  `);
  doc.close();

  function cleanup() {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }

  const printWin = iframe.contentWindow;
  printWin.onafterprint = cleanup;

  // Small delay lets the iframe finish rendering before the print dialog opens.
  setTimeout(() => {
    printWin.focus();
    printWin.print();
  }, 50);

  // Fallback cleanup in case 'afterprint' never fires in some browsers.
  setTimeout(cleanup, 60000);
}

function printFilesList(rows) {
  const rowsHtml = rows.map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(t.file_no)}</td>
      <td>${escapeHtml(t.subject)}</td>
      <td>${escapeHtml(t.current_holder)}</td>
      <td>${escapeHtml(t.status)}</td>
      <td>${escapeHtml(t.priority)}</td>
      <td>${fmtDateOnlyPlain(t.due_date)}</td>
      <td>${fmtDate(t.last_updated)}</td>
    </tr>
  `).join("");
  const bodyHtml = `
    <h1>File Tracking — Full File List</h1>
    <div class="sub">Generated on ${new Date().toLocaleString("en-IN")} • ${rows.length} file(s)</div>
    <table>
      <thead>
        <tr><th>S.No</th><th>File No</th><th>Subject</th><th>Current Holder</th><th>Status</th><th>Priority</th><th>Due Date</th><th>Last Updated</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  openPrintWindow("File Tracking - All Files", bodyHtml);
}

function printMovementHistory(task) {
  const entriesHtml = task.updates.map(u => {
    const isCreated = u.entry_type === "created";
    return `
      <div class="entry">
        <div class="date">${fmtDate(u.updated_at)}</div>
        ${u.remarks ? `<div class="remarks">${escapeHtml(u.remarks)}</div>` : ""}
        ${isCreated || u.current_holder !== u.previous_holder ? `<div class="moved">${isCreated ? "Created by" : "Forwarded to"} ${escapeHtml(u.current_holder)}</div>` : ""}
        ${u.previous_status && u.previous_status !== u.status ? `<div class="status">Status: ${escapeHtml(u.status)}</div>` : ""}
      </div>
    `;
  }).join("");
  const bodyHtml = `
    <h1>${escapeHtml(task.file_no)} — ${escapeHtml(task.subject)}</h1>
    <div class="sub">Movement History • Generated on ${new Date().toLocaleString("en-IN")}</div>
    ${entriesHtml}
  `;
  openPrintWindow(`Movement History - ${task.file_no}`, bodyHtml);
}

// ─── Main dashboard ─────────────────────────────────────────────────────────
export default function FileTrackingDashboard({ user, isAdmin }) {
  const [stats, setStats]     = useState(null);
  const [tasks, setTasks]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const pageSize = 25;
  const [sortBy, setSortBy]   = useState("last_updated");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch]   = useState("");
  const [quick, setQuick]     = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter]     = useState("");
  const [statuses, setStatuses] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [toast, setToast]     = useState(null);
  const [colWidths, setColWidths] = useState(() => Object.fromEntries(COLUMNS.map(c => [c.key, c.width])));

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }

  const loadStats = useCallback(() => api.getFileTrackingStats().then(setStats).catch(() => {}), []);
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir };
      if (search.trim()) params.search = search.trim();
      if (quick !== "all") params.quick = quick;
      if (priorityFilter) params.priority = priorityFilter;
      if (statusFilter) params.status = statusFilter;
      const data = await api.getFileTrackingTasks(params);
      setTasks(data.rows);
      setTotal(data.total);
    } catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, [page, sortBy, sortDir, search, quick, priorityFilter, statusFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { api.getFileTrackingStatuses().then(setStatuses).catch(() => {}); }, []);

  function handleCardClick(key) { setQuick(key); setPage(1); }
  function handleSort(col) {
    if (!col.sortable) return;
    if (sortBy === col.key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col.key); setSortDir("asc"); }
  }

  async function handlePinToggle(task) {
    try {
      if (task.is_pinned) { await api.unpinFileTrackingTask(task.id); showToast("Unpinned."); }
      else { await api.pinFileTrackingTask(task.id); showToast("Pinned."); }
      loadTasks(); loadStats();
    } catch (e) { showToast(e.message, "error"); }
  }

  function resizeColumn(key, deltaX) {
    setColWidths(w => ({ ...w, [key]: Math.max(50, (w[key] || 100) + deltaX) }));
  }

  async function handlePrintAll() {
    try {
      const params = { page: 1, page_size: 100000, sort_by: sortBy, sort_dir: sortDir };
      if (search.trim()) params.search = search.trim();
      if (quick !== "all") params.quick = quick;
      if (priorityFilter) params.priority = priorityFilter;
      if (statusFilter) params.status = statusFilter;
      const data = await api.getFileTrackingTasks(params);
      printFilesList(data.rows);
    } catch (e) { showToast(e.message, "error"); }
  }

  if (detailId) {
    return (
      <FileDetailView
        taskId={detailId} user={user} isAdmin={isAdmin} statuses={statuses}
        onClose={() => setDetailId(null)}
        onChanged={() => { loadTasks(); loadStats(); }}
        showToast={showToast}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Office file movement, current holder, and complete history</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handlePrintAll} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "white", color: "#334155", border: "1px solid #E2E8F0", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            <PrinterIcon /> Print All
          </button>
          <button onClick={() => setShowNew(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            <Icons.Plus /> Register New File
          </button>
        </div>
      </div>

      {/* ── Dashboard cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 18 }}>
        {CARDS.map(c => (
          <button key={c.key} onClick={() => handleCardClick(c.key)} style={{
            textAlign: "left", padding: "14px 16px", borderRadius: 12, cursor: "pointer",
            background: "white", border: quick === c.key ? `1.5px solid ${c.color}` : "1px solid #E2E8F0",
            boxShadow: quick === c.key ? `0 0 0 3px ${c.color}22` : "none",
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{stats ? stats[c.statKey] : "—"}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", marginTop: 2 }}>{c.label}</div>
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ background: "white", borderRadius: 12, padding: "14px 18px", marginBottom: 14, border: "1px solid #E2E8F0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search File No, Subject, Current Holder…"
          style={{ flex: 1, minWidth: 220, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }} style={S.select}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={S.select}>
          <option value="">All Statuses</option>
          {NEW_FILE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || priorityFilter || statusFilter || quick !== "all") && (
          <button onClick={() => { setSearch(""); setPriorityFilter(""); setStatusFilter(""); setQuick("all"); setPage(1); }}
            style={{ padding: "7px 12px", background: "#F1F5F9", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: "#64748B", cursor: "pointer" }}>
            Clear Filters
          </button>
        )}
      </div>

      {/* ── Grid ── */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <FileGrid
          tasks={tasks} loading={loading} columns={COLUMNS} colWidths={colWidths}
          sortBy={sortBy} sortDir={sortDir} onSort={handleSort} onResize={resizeColumn}
          onOpen={t => setDetailId(t.id)} onPinToggle={handlePinToggle}
          page={page} pageSize={pageSize}
        />
      </div>

      {/* ── Pagination ── */}
      {total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 12.5, color: "#64748B" }}>
          <div>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #E2E8F0", background: page <= 1 ? "#F8FAFC" : "white", color: page <= 1 ? "#CBD5E1" : "#334155", cursor: page <= 1 ? "not-allowed" : "pointer", fontWeight: 600 }}>Previous</button>
            <span style={{ padding: "6px 10px" }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #E2E8F0", background: page >= totalPages ? "#F8FAFC" : "white", color: page >= totalPages ? "#CBD5E1" : "#334155", cursor: page >= totalPages ? "not-allowed" : "pointer", fontWeight: 600 }}>Next</button>
          </div>
        </div>
      )}

      {showNew && (
        <NewFileModal
          statuses={statuses}
          onClose={() => setShowNew(false)}
          onSaved={(id) => { setShowNew(false); loadTasks(); loadStats(); showToast("File registered."); setDetailId(id); }}
        />
      )}
      {toast && <Toast {...toast} />}
    </div>
  );
}

// ─── Excel-style grid ───────────────────────────────────────────────────────
function FileGrid({ tasks, loading, columns, colWidths, sortBy, sortDir, onSort, onResize, onOpen, onPinToggle, page, pageSize }) {
  const dragState = useRef(null);

  function startResize(e, key) {
    e.preventDefault();
    dragState.current = { key, startX: e.clientX };
    function onMove(ev) {
      if (!dragState.current) return;
      const delta = ev.clientX - dragState.current.startX;
      dragState.current.startX = ev.clientX;
      onResize(dragState.current.key, delta);
    }
    function onUp() {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (loading) return <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>;
  if (!tasks.length) return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
      <Icons.File />
      <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1", marginTop: 10 }}>No files found</p>
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed", width: "100%" }}>
        <thead>
          <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", position: "sticky", top: 0, zIndex: 1 }}>
            {columns.map(col => (
              <th key={col.key} style={{ width: colWidths[col.key], position: "relative", padding: "10px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", cursor: col.sortable ? "pointer" : "default", userSelect: "none" }}
                onClick={() => onSort(col)}>
                {col.label}
                {sortBy === col.key && <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                <span onMouseDown={e => { e.stopPropagation(); startResize(e, col.key); }}
                  style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize" }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t, i) => (
            <tr key={t.id} style={{ background: rowBackground(t), borderBottom: "1px solid #0000001a" }}>
              <td style={{ width: colWidths.serial, padding: "8px 10px", color: "#475569", fontWeight: 600, textAlign: "center" }}>{(page - 1) * pageSize + i + 1}</td>
              <td style={{ width: colWidths.pin, padding: "8px 10px", textAlign: "center" }}>
                <button onClick={() => onPinToggle(t)} title={t.is_pinned ? "Unpin" : "Pin (max 3)"}
                  style={{ background: "none", border: "none", cursor: "pointer", color: t.is_pinned ? "#0E7490" : "#94A3B899", display: "inline-flex" }}>
                  <Icons.Pin />
                </button>
              </td>
              <td style={{ width: colWidths.file_no, padding: "8px 10px", fontWeight: 700, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.file_no}</td>
              <td style={{ width: colWidths.subject, padding: "8px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <button onClick={() => onOpen(t)} style={{ background: "none", border: "none", padding: 0, color: "#0F172A", fontWeight: 700, cursor: "pointer", textAlign: "left", textDecoration: "underline" }}>{t.subject}</button>
              </td>
              <td style={{ width: colWidths.current_holder, padding: "8px 10px", fontWeight: 600, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.current_holder}</td>
              <td style={{ width: colWidths.status, padding: "8px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1E293B", fontWeight: 600 }}>{t.status}</td>
              <td style={{ width: colWidths.file_age, padding: "8px 10px" }}>
                <Badge label={t.file_age.label} color={AGE_COLOR[t.file_age.colorBucket]} bg={AGE_BG[t.file_age.colorBucket]} />
              </td>
              <td style={{ width: colWidths.due_date, padding: "8px 10px", whiteSpace: "nowrap", color: "#1E293B" }}>{fmtDateOnlyPlain(t.due_date)}</td>
              <td style={{ width: colWidths.last_updated, padding: "8px 10px", color: "#334155", whiteSpace: "nowrap", fontSize: 11.5 }}>{fmtDate(t.last_updated)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── New File modal ─────────────────────────────────────────────────────────
function NewFileModal({ statuses, onClose, onSaved }) {
  const [fileNo, setFileNo]           = useState("");
  const [subject, setSubject]         = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority]       = useState("Medium");
  const [status, setStatus]           = useState("Pending");
  const [currentHolder, setCurrentHolder] = useState("");
  const [dueDate, setDueDate]         = useState("");
  const [files, setFiles]             = useState([]);
  const [dragOver, setDragOver]       = useState(false);
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);

  function addFiles(fileList) {
    setFiles(prev => [...prev, ...Array.from(fileList)]);
  }
  function removeFile(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)); }

  async function handleSubmit() {
    if (!fileNo.trim()) return setError("File No is required.");
    if (!subject.trim()) return setError("Subject is required.");
    if (!currentHolder.trim()) return setError("Current Holder is required.");
    setError(""); setLoading(true);
    try {
      const created = await api.createFileTrackingTask({
        file_no: fileNo, subject, description,
        priority, status, current_holder: currentHolder, due_date: dueDate || undefined,
      }, files);
      onSaved(created.id);
    } catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={560}>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Register New File</h3>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <label style={S.label}>File No *</label>
      <input style={{ ...S.input, marginBottom: 16 }} placeholder="e.g. NAD/IT/2026/014" value={fileNo} onChange={e => setFileNo(e.target.value)} />

      <label style={S.label}>Subject *</label>
      <input style={{ ...S.input, marginBottom: 16 }} value={subject} onChange={e => setSubject(capitalizeSentences(e.target.value))} />

      <label style={S.label}>Description</label>
      <textarea style={{ ...S.input, height: 80, resize: "vertical", marginBottom: 16 }} value={description} onChange={e => setDescription(capitalizeSentences(e.target.value))} />

      <label style={S.label}>Current Holder *</label>
      <input style={{ ...S.input, marginBottom: 16 }} placeholder="e.g. Admin Officer" value={currentHolder} onChange={e => setCurrentHolder(capitalizeSentences(e.target.value))} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={S.label}>Priority</label>
          <select style={{ ...S.input, cursor: "pointer" }} value={priority} onChange={e => setPriority(e.target.value)}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Status</label>
          <select style={{ ...S.input, cursor: "pointer" }} value={status} onChange={e => setStatus(e.target.value)}>
            {NEW_FILE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Due Date</label>
          <input type="date" style={S.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>

      <label style={S.label}>Attachments (optional)</label>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        style={{ border: `1.5px dashed ${dragOver ? "#0E7490" : "#CBD5E1"}`, borderRadius: 9, padding: 16, textAlign: "center", background: dragOver ? "#F0FDFA" : "#F8FAFC", marginBottom: 10 }}>
        <Icons.Paperclip />
        <p style={{ fontSize: 12.5, color: "#64748B", margin: "6px 0" }}>Drag &amp; drop files here, or</p>
        <label style={{ display: "inline-block", padding: "6px 14px", background: "white", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12.5, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
          Browse Files
          <input type="file" multiple style={{ display: "none" }} onChange={e => addFiles(e.target.files)}
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt" />
        </label>
      </div>
      {files.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 7, marginBottom: 4 }}>
              <Icons.File />
              <span style={{ flex: 1, fontSize: 12.5, color: "#0E7490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <button type="button" onClick={() => removeFile(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#0E7490", display: "flex" }}><Icons.Close /></button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Registering…" : "Register File"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Full-screen file detail view ───────────────────────────────────────────
function FileDetailView({ taskId, user, isAdmin, statuses, onClose, onChanged, showToast }) {
  const [task, setTask]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [newHolder, setNewHolder] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const [files, setFiles]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [pinning, setPinning] = useState(false);
  const [viewAtt, setViewAtt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.getFileTrackingTask(taskId);
      setTask(t);
      setNewHolder(t.current_holder);
      setNewStatus(t.status);
      setNewDueDate(t.due_date ? t.due_date.slice(0, 10) : "");
      setNewPriority(t.priority);
    } catch (e) { showToast(e.message, "error"); onClose(); }
    finally { setLoading(false); }
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function handleSaveUpdate() {
    if (!remarks.trim() || !newHolder.trim() || !newStatus.trim()) return showToast("Remarks, Current Holder and Status are required.", "error");
    setSaving(true);
    try {
      await api.addFileTrackingUpdate(taskId, {
        remarks, current_holder: newHolder, status: newStatus, due_date: newDueDate || "", priority: newPriority,
      }, files);
      setRemarks(""); setFiles([]);
      await load();
      onChanged();
      showToast("Update saved.");
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
  }

  async function handlePinToggle() {
    setPinning(true);
    try {
      if (task.is_pinned) { await api.unpinFileTrackingTask(taskId); showToast("Unpinned."); }
      else { await api.pinFileTrackingTask(taskId); showToast("Pinned."); }
      await load(); onChanged();
    } catch (e) { showToast(e.message, "error"); }
    finally { setPinning(false); }
  }

  if (loading || !task) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#64748B", fontWeight: 700, fontSize: 13 }}>
          <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icons.Chevron /></span> Back to Grid
        </button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Badge label={`Currently with: ${task.current_holder}`} color="#0E7490" />
          <button onClick={handlePinToggle} disabled={pinning} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: task.is_pinned ? "#F0FDFA" : "white", border: `1px solid ${task.is_pinned ? "#99F6E4" : "#E2E8F0"}`, borderRadius: 8, color: task.is_pinned ? "#0E7490" : "#64748B", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
            <Icons.Pin /> {task.is_pinned ? "Pinned" : "Pin"}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ background: "white", borderRadius: 14, border: "1px solid #E2E8F0", padding: "22px 26px", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>{task.file_no}</div>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0F172A", marginTop: 4 }}>{task.subject}</h1>
              </div>
              <Badge label={task.priority} color={PRI_BADGE[task.priority]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <DetailField label="Current Holder" value={task.current_holder} />
              <DetailField label="Status" value={task.status} />
              <DetailField label="Created" value={fmtDate(task.created_date)} />
              <DetailField label="Due Date" value={fmtDateOnlyPlain(task.due_date)} />
              <DetailField label="Last Updated" value={fmtDate(task.last_updated)} />
              <DetailField label="File Age" value={<Badge label={task.file_age.label} color={AGE_COLOR[task.file_age.colorBucket]} bg={AGE_BG[task.file_age.colorBucket]} />} />
            </div>
            {task.description && (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #F1F5F9" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Description</div>
                <p style={{ fontSize: 13.5, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{task.description}</p>
              </div>
            )}
            {task.attachments.length > 0 && (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #F1F5F9" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>File-level Attachments</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {task.attachments.map(a => <AttachmentPill key={a.id} att={a} onView={setViewAtt} />)}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20, alignItems: "start" }}>
            <div style={{ background: "white", borderRadius: 14, border: "1px solid #E2E8F0", padding: "22px 26px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Movement History</h3>
                <button onClick={() => printMovementHistory(task)} title="Print Movement History"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
                  <PrinterIcon /> Print
                </button>
              </div>
              <div style={{ maxHeight: 560, overflowY: "auto", paddingRight: 6 }}>
                {task.updates.map((u, i) => (
                  <TimelineEntry key={u.id} update={u} isLast={i === task.updates.length - 1} onViewAttachment={setViewAtt} />
                ))}
              </div>
            </div>

            <div style={{ background: "white", borderRadius: 14, border: "1px solid #E2E8F0", padding: "22px 26px", position: "sticky", top: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Add Update / Move File</h3>

              <label style={S.label}>Remarks *</label>
              <textarea style={{ ...S.input, height: 70, resize: "vertical", marginBottom: 14 }} value={remarks} onChange={e => setRemarks(capitalizeSentences(e.target.value))} placeholder="What's happening with this file?" />

              <label style={S.label}>Current Holder *</label>
              <input style={{ ...S.input, marginBottom: 14 }} value={newHolder} onChange={e => setNewHolder(capitalizeSentences(e.target.value))} placeholder="e.g. Admin Officer" />

              <label style={S.label}>Status *</label>
              <select style={{ ...S.input, cursor: "pointer", marginBottom: 14 }} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {NEW_FILE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={S.label}>Priority</label>
                  <select style={{ ...S.input, cursor: "pointer" }} value={newPriority} onChange={e => setNewPriority(e.target.value)}>
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Due Date</label>
                  <input type="date" style={S.input} value={newDueDate} onChange={e => setNewDueDate(e.target.value)} />
                </div>
              </div>

              <label style={S.label}>Attachment</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 8, color: "#64748B", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
                <Icons.Paperclip /> Attach file(s)
                <input type="file" multiple style={{ display: "none" }} onChange={e => setFiles(Array.from(e.target.files))}
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt" />
              </label>
              {files.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  {files.map((f, i) => <div key={i} style={{ fontSize: 11.5, color: "#0E7490", marginBottom: 3 }}>{f.name}</div>)}
                </div>
              )}

              <button onClick={handleSaveUpdate} disabled={saving}
                style={{ width: "100%", padding: 12, background: saving ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Saving…" : "Save Update"}
              </button>
            </div>
          </div>
      </div>
      {viewAtt && <AttachmentViewerModal att={viewAtt} onClose={() => setViewAtt(null)} />}
    </div>
  );
}

function TimelineEntry({ update, isLast, onViewAttachment }) {
  const isCreated = update.entry_type === "created";
  return (
    <div style={{ display: "flex", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: isCreated ? "#7C3AED" : "#0E7490", flexShrink: 0, marginTop: 4 }} />
        {!isLast && <div style={{ width: 2, flex: 1, background: "#E2E8F0", minHeight: 30 }} />}
      </div>
      <div style={{ paddingBottom: 22, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: "#94A3B8", fontWeight: 600 }}>{fmtDate(update.updated_at)}</div>

        {update.remarks && (
          <p style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", marginTop: 4, whiteSpace: "pre-wrap" }}>{update.remarks}</p>
        )}

        {(isCreated || update.current_holder !== update.previous_holder) && (
          <div style={{ fontSize: 12, fontWeight: 600, color: "#0E7490", marginTop: update.remarks ? 6 : 4 }}>
            {isCreated ? "Created by" : "Forwarded to"} <span>{update.current_holder}</span>
          </div>
        )}
        {update.previous_status && update.previous_status !== update.status && (
          <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>
            Status: <strong>{update.status}</strong>
          </div>
        )}

        {update.attachments && update.attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {update.attachments.map(a => <AttachmentPill key={a.id} att={a} onView={onViewAttachment} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentPill({ att, onView }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: "#334155" }}>
      <a href={fileTrackingViewUrl(att.id)}
         onClick={e => { if (onView) { e.preventDefault(); onView(att); } }}
         style={{ display: "flex", alignItems: "center", gap: 5, textDecoration: "none", color: "inherit" }}
         title={`View ${att.original_name}`}>
        <Icons.File />
        <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.original_name}</span>
      </a>
      <a href={fileTrackingViewUrl(att.id)}
         onClick={e => { if (onView) { e.preventDefault(); onView(att); } }}
         style={{ display: "flex", color: "inherit", opacity: 0.8 }} title="View">
        <EyeIcon />
      </a>
    </div>
  );
}

function AttachmentViewerModal({ att, onClose }) {
  const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(att.original_name || "");
  return (
    <Modal onClose={onClose} width={860}>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
        <Icons.Close />
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, paddingRight: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icons.File />
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.original_name}</span>
        </div>
        <a href={fileTrackingDownloadUrl(att.id)} download={att.original_name}
           style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, fontWeight: 600, color: "#334155", textDecoration: "none", flexShrink: 0 }}>
          <Icons.Download /> Download
        </a>
      </div>
      <div style={{
        height: "min(78vh, 1050px)",
        width: "auto",
        maxWidth: "100%",
        aspectRatio: "210 / 297",
        margin: "0 auto",
        background: "#F1F5F9",
        border: "1px solid #E2E8F0",
        borderRadius: 8,
        overflow: "hidden",
      }}>
        {isImage ? (
          <img src={fileTrackingViewUrl(att.id)} alt={att.original_name}
               style={{ width: "100%", height: "100%", objectFit: "contain", background: "white" }} />
        ) : (
          <iframe src={fileTrackingViewUrl(att.id)} title={att.original_name}
                  style={{ width: "100%", height: "100%", border: "none", background: "white" }} />
        )}
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
