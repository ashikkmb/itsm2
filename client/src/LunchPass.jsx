import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "./api.js";
import { Icons, Modal, S, Toast, fmtDateOnly } from "./components.jsx";

const GATES = ["West Gate", "East Gate"];
const STA_COLOR = { Active: "#10B981", Expired: "#EF4444", Deactivated: "#64748B" };
const STA_BG    = { Active: "#ECFDF5", Expired: "#FEF2F2", Deactivated: "#F1F5F9" };

function capitalizeWords(str) {
  return str.replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export default function LunchPass() {
  const [passes, setPasses]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [gateFilter, setGateFilter]     = useState("All");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [printing, setPrinting] = useState(null); // array of passes to print, or null
  const [selected, setSelected] = useState(new Map()); // id -> pass object
  const [toast, setToast]       = useState(null);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (statusFilter !== "All") params.status = statusFilter;
      if (gateFilter !== "All") params.gate = gateFilter;
      if (expiringOnly) params.expiringSoon = "true";
      setPasses(await api.getLunchPasses(params));
      // Note: selected is intentionally NOT reset here, so picks made
      // during an earlier search survive when the user searches again
      // for a different person (selection is only cleared explicitly,
      // e.g. after printing).
    } catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [statusFilter, gateFilter, expiringOnly]);

  function toggleSelect(pass) {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(pass.id)) next.delete(pass.id); else next.set(pass.id, pass);
      return next;
    });
  }
  function toggleSelectAll() {
    const allVisibleSelected = passes.length > 0 && passes.every(p => selected.has(p.id));
    setSelected(prev => {
      const next = new Map(prev);
      if (allVisibleSelected) {
        // Deselect only the currently visible ones; keep picks from other searches.
        passes.forEach(p => next.delete(p.id));
      } else {
        // Select all currently visible, on top of any existing picks.
        passes.forEach(p => next.set(p.id, p));
      }
      return next;
    });
  }

  function handleSearchKey(e) { if (e.key === "Enter") load(); }

  async function handleRenew(pass) {
    if (!window.confirm(`Renew pass for ${pass.name}${pass.pass_no ? ` (${pass.pass_no})` : ""}? This resets the validity period to a fresh 1-year term.`)) return;
    try { await api.renewLunchPass(pass.id); showToast("Pass renewed."); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function handleToggleStatus(pass) {
    const next = pass.status === "Deactivated" ? "Active" : "Deactivated";
    if (!window.confirm(`${next === "Active" ? "Reactivate" : "Deactivate"} pass for ${pass.name}${pass.pass_no ? ` (${pass.pass_no})` : ""}?`)) return;
    try { await api.setLunchPassStatus(pass.id, next); showToast(`Pass ${next.toLowerCase()}.`); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function handleDelete(pass) {
    if (!window.confirm(`Permanently delete pass for ${pass.name}${pass.pass_no ? ` (${pass.pass_no})` : ""}? This cannot be undone.`)) return;
    try { await api.deleteLunchPass(pass.id); showToast("Pass deleted."); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  const counts = {
    active: passes.filter(p => p.status === "Active").length,
    expired: passes.filter(p => p.status === "Expired").length,
    deactivated: passes.filter(p => p.status === "Deactivated").length,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Registry ({passes.length})</h2>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
            {counts.active} Issued Passes · {counts.expired} Expired 
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setPrinting(Array.from(selected.values()))}
            disabled={selected.size === 0}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: selected.size === 0 ? "#F1F5F9" : "#EFF6FF", color: selected.size === 0 ? "#94A3B8" : "#1D4ED8", border: `1px solid ${selected.size === 0 ? "#E2E8F0" : "#BFDBFE"}`, borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: selected.size === 0 ? "not-allowed" : "pointer" }}>
            🖨️ Print Selected {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
          <button onClick={() => setShowCreate(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            <Icons.Plus />New Pass
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ background: "white", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #E2E8F0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearchKey} placeholder="Search name, ID No, pass no, section…"
          style={{ flex: 1, minWidth: 180, padding: "7px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, outline: "none" }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.select}>
          <option value="All">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Expired">Expired</option>
       
        </select>
        <select value={gateFilter} onChange={e => setGateFilter(e.target.value)} style={S.select}>
          <option value="All">All Gates</option>
          {GATES.map(g => <option key={g}>{g}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={expiringOnly} onChange={e => setExpiringOnly(e.target.checked)} />
          Expiring in 30 days
        </label>
        <button onClick={load} style={{ padding: "7px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Search</button>
      </div>

      {/* Registry table */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>
        ) : passes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🍽️</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1" }}>No lunch passes found</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "75vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0" }}>
                  <th style={{ padding: "11px 14px", position: "sticky", top: 0, background: "#F8FAFC", zIndex: 1 }}>
                    <input type="checkbox" checked={passes.length > 0 && passes.every(p => selected.has(p.id))} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                  </th>
                  {["Photo", "Name", "ID No", "Section", "Gate", "Valid To", "Status", "Actions"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#F8FAFC", zIndex: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {passes.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #F1F5F9", background: selected.has(p.id) ? "#EFF6FF" : i % 2 === 0 ? "white" : "#FAFCFF" }}>
                    <td style={{ padding: "8px 14px" }}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p)} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ padding: "8px 14px" }}>
                      {p.photo_path
                        ? <img src={p.photo_path} alt={p.name} style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", objectPosition: `${p.photo_position_x ?? 50}% ${p.photo_position_y ?? 50}%`, border: "1px solid #E2E8F0" }} />
                        : <div style={{ width: 34, height: 34, borderRadius: 6, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#CBD5E1" }}>—</div>}
                    </td>
                    
                    <td style={{ padding: "11px 14px", color: "#1E293B", fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: "11px 14px", color: "#475569" }}>{p.id_no || "—"}</td>
                    <td style={{ padding: "11px 14px", color: "#475569" }}>{p.section || "—"}</td>
                    <td style={{ padding: "11px 14px", color: "#475569" }}>{p.gate}</td>
                    <td style={{ padding: "11px 14px", color: "#94A3B8", whiteSpace: "nowrap" }}>{fmtDateOnly(p.valid_to)}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ background: STA_BG[p.status], color: STA_COLOR[p.status], border: `1px solid ${STA_COLOR[p.status]}40`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{p.status}</span>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => setPrinting([p])} style={actionBtnStyle("#1D4ED8", "#EFF6FF", "#BFDBFE")}>Print</button>
                        <button onClick={() => setEditing(p)} style={actionBtnStyle("#475569", "#F1F5F9", "#E2E8F0")}>Edit</button>
                        {p.status !== "Deactivated" && <button onClick={() => handleRenew(p)} style={actionBtnStyle("#059669", "#ECFDF5", "#A7F3D0")}>Renew</button>}
                        
                        <button onClick={() => handleDelete(p)} style={actionBtnStyle("#DC2626", "#FEF2F2", "#FECACA")}><Icons.Trash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <PassFormModal onClose={() => setShowCreate(false)} onSaved={() => { load(); setShowCreate(false); showToast("Pass created successfully."); }} />}
      {editing && <PassFormModal pass={editing} onClose={() => setEditing(null)} onSaved={() => { load(); setEditing(null); showToast("Pass updated."); }} />}
      {printing && printing.length > 0 && <PrintPassModal passes={printing} onClose={() => setPrinting(null)} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}

function actionBtnStyle(color, bg, border) {
  return { padding: "5px 10px", background: bg, border: `1px solid ${border}`, borderRadius: 6, color, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 };
}

// ─── Create / Edit Form Modal ─────────────────────────────────────────────────
function PassFormModal({ pass, onClose, onSaved }) {
  const isEdit = !!pass;
  const [form, setForm] = useState({
    name: pass?.name || "",
    id_no: pass?.id_no || "",
    designation: pass?.designation || "",
    mobile: pass?.mobile || "",
    section: pass?.section || "",
    gate: pass?.gate || "West Gate",
    valid_from: pass?.valid_from || new Date().toISOString().slice(0, 10),
  });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(pass?.photo_path || null);
  const [photoPos, setPhotoPos] = useState({ x: pass?.photo_position_x ?? 50, y: pass?.photo_position_y ?? 50 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) { setError("Only JPG, PNG, or WEBP images are allowed."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Photo must be smaller than 5MB."); return; }
    setError("");
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setPhotoPos({ x: 50, y: 50 }); // recenter on a freshly chosen photo
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!isEdit) {
      if (!form.id_no.trim()) { setError("ID No is required."); return; }
      if (!form.designation.trim()) { setError("Designation is required."); return; }
      if (!form.mobile.trim()) { setError("Mobile No is required."); return; }
      if (!form.section.trim()) { setError("Section is required."); return; }
      if (!photo) { setError("Photo is required."); return; }
    }
    setLoading(true); setError("");
    try {
      const data = { ...form, photo, photo_position_x: photoPos.x, photo_position_y: photoPos.y };
      if (isEdit) await api.updateLunchPass(pass.id, data);
      else await api.createLunchPass(data);
      onSaved();
    } catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={460}>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>{isEdit ? `Edit Pass — ${pass.name}` : "New Lunch Pass"}</h3>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Name *</label>
          <input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: capitalizeWords(e.target.value) }))} placeholder="Full name" />
        </div>
        <div>
          <label style={S.label}>Photo {!isEdit && "*"}</label>
          <PhotoCropBox preview={preview} position={photoPos} onPositionChange={setPhotoPos} onFileChange={handlePhotoChange} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>ID No {!isEdit && "*"}</label>
          <input style={S.input} value={form.id_no} onChange={e => setForm(f => ({ ...f, id_no: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Designation {!isEdit && "*"}</label>
          <input style={S.input} value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Mobile No {!isEdit && "*"}</label>
          <input style={S.input} value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value.replace(/\D/g, "") }))} maxLength={10} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Section {!isEdit && "*"}</label>
          <input style={S.input} value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))} />
        </div>
      </div>

      <label style={S.label}>Gate *</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {GATES.map(g => (
          <button key={g} onClick={() => setForm(f => ({ ...f, gate: g }))}
            style={{ flex: 1, padding: "9px 0", border: `2px solid ${form.gate === g ? "#0E7490" : "#E2E8F0"}`, borderRadius: 8, background: form.gate === g ? "#0E749015" : "white", color: form.gate === g ? "#0E7490" : "#64748B", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {g}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Create Pass"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Draggable photo crop box ─────────────────────────────────────────────────
// Box matches the printed photo box aspect ratio (1.7cm × 2.05cm). The photo
// fills it with object-fit: cover; dragging adjusts object-position so the
// admin can align the face within the frame before saving.
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function PhotoCropBox({ preview, position, onPositionChange, onFileChange }) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(e) {
    if (!preview || !boxRef.current) return;
    e.preventDefault();
    boxRef.current.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPos: { ...position } };
    setDragging(true);
  }
  function handlePointerMove(e) {
    if (!dragRef.current || !boxRef.current) return;
    const { width, height } = boxRef.current.getBoundingClientRect();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // Dragging the pointer right reveals more of the image's left side (feels natural),
    // so the object-position % moves opposite to the pointer's direction.
    const nextX = clamp(dragRef.current.startPos.x - (dx / width) * 100, 0, 100);
    const nextY = clamp(dragRef.current.startPos.y - (dy / height) * 100, 0, 100);
    onPositionChange({ x: nextX, y: nextY });
  }
  function handlePointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div>
      <div
        ref={boxRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          width: 84, height: 101, border: "2px dashed #E2E8F0", borderRadius: 8,
          overflow: "hidden", background: "#FAFCFF", position: "relative",
          cursor: preview ? (dragging ? "grabbing" : "grab") : "pointer", touchAction: "none",
        }}>
        {preview ? (
          <img src={preview} alt="Preview" draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${position.x}% ${position.y}%`, pointerEvents: "none", userSelect: "none" }} />
        ) : (
          <label style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icons.Upload />
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} style={{ display: "none" }} />
          </label>
        )}
      </div>
      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 5, alignItems: "center" }}>
          <p style={{ fontSize: 9.5, color: "#94A3B8", textAlign: "center", lineHeight: 1.3 }}>Drag to align face</p>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ fontSize: 10.5, color: "#0E7490", fontWeight: 700, cursor: "pointer" }}>
              Change
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} style={{ display: "none" }} />
            </label>
            <button type="button" onClick={() => onPositionChange({ x: 50, y: 50 })}
              style={{ fontSize: 10.5, color: "#64748B", fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Print Pass Modal ──────────────────────────────────────────────────────
// The on-screen modal (a scrollable box inside a position:fixed overlay) is
// ONLY a visual preview. The actual content that gets printed is rendered
// separately via a portal straight into document.body — completely outside
// the modal's scrollable/fixed ancestry. That ancestry is what was silently
// breaking print pagination: a scrollable "overflow: auto" box has no
// meaning to the print engine, so it was clipping cards at the scroll
// boundary and then duplicating content while trying to recover the rest.
// A plain, unclipped, non-fixed block at the body level paginates cleanly.
const PASSES_PER_PAGE = 8; // 2 cols × 4 rows fits cleanly within one A4 page

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function PrintPassModal({ passes, onClose }) {
  function handlePrint() { window.print(); }
  const count = passes.length;
  const pages = chunk(passes, PASSES_PER_PAGE);
  const sheets = pages.length;

  return (
    <>
      {/* On-screen preview only — never what actually gets printed */}
      <div style={{ position: "fixed", inset: 0, background: "#00000070", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ background: "#e5e7eb", borderRadius: 14, padding: 30, maxHeight: "92vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>
                {count === 1 ? `Print Lunch Pass — ${passes[0].pass_no || passes[0].name}` : `Print ${count} Lunch Passes`}
              </h3>
              {count > 1 && (
                <p style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  {count} passes · {PASSES_PER_PAGE} per A4 sheet · {sheets} sheet{sheets > 1 ? "s" : ""}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handlePrint} style={{ padding: "9px 18px", background: "linear-gradient(135deg,#059669,#0E7490)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>🖨️ Print</button>
              <button onClick={onClose} style={{ background: "#F1F5F9", border: "none", borderRadius: 7, width: 36, height: 36, cursor: "pointer" }}><Icons.Close /></button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4cm" }}>
            {passes.map(p => <PassCard key={p.id} pass={p} />)}
          </div>
        </div>
      </div>

      {/* Actual print output — portaled to document.body, outside any
          scrollable or fixed-position ancestor, so it paginates cleanly */}
      {createPortal(
        <div className="print-root">
          {pages.map((pagePasses, pageIdx) => (
            <div className="print-page" key={pageIdx}>
              {pagePasses.map(p => (
                <div className="pass-card-wrap" key={p.id}>
                  <PassCard pass={p} />
                </div>
              ))}
            </div>
          ))}
          <style>{`
            .print-root { display: none; }
            @media print {
              html, body { background: #ffffff !important; }
              body > *:not(.print-root) { display: none !important; }
              .print-root { display: block !important; }
              .print-page {
                width: 100%;
                display: grid;
                grid-template-columns: repeat(2, 9.5cm);
                grid-auto-rows: 6.5cm;
                gap: 0.3cm;
                justify-content: center;
                page-break-after: always;
                break-after: page;
              }
              .print-page:last-child {
                page-break-after: auto;
                break-after: auto;
              }
              .pass-card { box-shadow: none !important; }
              @page { size: A4; margin: 0.5cm; }
            }
          `}</style>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── The actual pass card (matches the approved template) ────────────────────
function PassCard({ pass }) {
  const isBlue = pass.gate === "West Gate";
  return (
    <div className="pass-card" style={{
      width: "9.5cm", height: "6.5cm", border: "2px solid #0f172a", borderRadius: 4,
      background: isBlue ? "#BFDBFE" : "#ffffff", padding: "0.22cm 0.3cm",
      fontFamily: "Arial, sans-serif", boxSizing: "border-box", overflow: "hidden",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    }}>
      <p style={{ textAlign: "center", fontSize: "11.5pt", fontWeight: "bold", color: "#0f172a", textDecoration: "underline", textTransform: "uppercase", margin: 0 }}>
        Temporary Lunch Pass &ndash; NAD (A)
      </p>
      <p style={{ textAlign: "center", fontSize: "7.5pt", fontWeight: "bold", color: "#1e293b", margin: "0.05cm 0 0.1cm" }}>
        (<u>Valid with Identity Pass</u>)
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0.1cm" }}>
        <tbody>
          <tr>
            <td style={{ fontSize: "8pt", fontWeight: "bold", color: "#0f172a", textAlign: "left", width: "33%", whiteSpace: "nowrap" }}>
              Pass No.
                
            </td> 
            <td style={{ fontSize: "8pt", fontWeight: "bold", color: "#0f172a", textAlign: "center", width: "34%", whiteSpace: "nowrap" }}>
              <u>{pass.gate.toUpperCase()}</u>
            </td>
            <td style={{ width: "33%" }}></td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0.1cm" }}>
        <tbody>
          <tr>
            <td style={{ border: "1.3px solid #0f172a", padding: "0.1cm 0.15cm", verticalAlign: "middle" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <tr><td colSpan={2} style={{ fontSize: "10pt", color: "#0f172a", padding: "0.04cm 0", textAlign: "left", paddingBottom: "0cm", whiteSpace: "nowrap" }}><b>Name:</b> {pass.name}</td></tr>
                  <tr><td style={{fontSize: "10pt", color: "#0f172a", padding: "0.04cm 0", textAlign: "left", width: "50%", whiteSpace: "nowrap" }}><b>Designation:</b> {pass.designation || "—"}</td></tr>
                  <tr><td style={{ fontSize: "10pt", color: "#0f172a", padding: "0.04cm 0", textAlign: "left", width: "50%", whiteSpace: "nowrap" }}><b>ID No:</b> {pass.id_no || "—"}</td></tr>
                  
                  <tr>
                    <td style={{ fontSize: "10pt", color: "#0f172a", padding: "0.04cm 0", textAlign: "left", whiteSpace: "nowrap" }}><b>Mob:</b> {pass.mobile || "—"}<b>   Section:</b> {pass.section || "—"}</td>
                    <td style={{ fontSize: "10pt", color: "#0f172a", padding: "0.04cm 0 0.04cm 0.15cm", textAlign: "left", whiteSpace: "nowrap" }}> </td>
                  </tr>
                </tbody>
              </table>
            </td>
            <td style={{ border: "1.3px solid #0f172a", padding: "0.08cm", width: "1.9cm", textAlign: "center", verticalAlign: "middle" }}>
              <div style={{ width: "1.7cm", height: "2.05cm", border: "1.3px solid #0f172a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#f1f5f9" }}>
                {pass.photo_path
                  ? <img src={pass.photo_path} alt={pass.name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${pass.photo_position_x ?? 50}% ${pass.photo_position_y ?? 50}%`, display: "block" }} />
                  : <span style={{ fontSize: "6.5pt", color: "#94a3b8", fontWeight: "bold" }}>PHOTO</span>}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <th rowSpan={2} style={{ width: "26%", fontSize: "7.3pt", fontWeight: "bold", color: "#0f172a", border: "1px solid #0f172a", padding: "1px 2px", textDecoration: "underline", background: "rgba(255,255,255,0.4)" }}>Lunch Intervals</th>
            <th colSpan={2} style={{ width: "50%", fontSize: "7.3pt", fontWeight: "bold", color: "#0f172a", border: "1px solid #0f172a", padding: "1px 2px", textDecoration: "underline", background: "rgba(255,255,255,0.4)" }}>Valid</th>
            <th rowSpan={2} style={{ width: "24%", fontSize: "7.3pt", fontWeight: "bold", color: "#0f172a", border: "1px solid #0f172a", padding: "1px 2px", textDecoration: "underline", background: "rgba(255,255,255,0.4)" }}>Signature of RO</th>
          </tr>
          <tr>
            <th style={{ width: "23%", fontSize: "6.3pt", fontWeight: "bold", color: "#0f172a", border: "1px solid #0f172a", padding: "1px 2px", textDecoration: "underline", background: "rgba(255,255,255,0.4)" }}>From</th>
            <th style={{ width: "23%", fontSize: "6.3pt", fontWeight: "bold", color: "#0f172a", border: "1px solid #0f172a", padding: "1px 2px", textDecoration: "underline", background: "rgba(255,255,255,0.4)" }}>To</th>
          </tr>
          {[1, 2, 3, 4].map(i => (
            <tr key={i}>
              <td style={{ border: "1px solid #0f172a", height: "0.4cm", background: "rgba(255,255,255,0.25)" }}></td>
              <td style={{ border: "1px solid #0f172a", height: "0.4cm", background: "rgba(255,255,255,0.25)" }}></td>
              <td style={{ border: "1px solid #0f172a", height: "0.4cm", background: "rgba(255,255,255,0.25)" }}></td>
              <td style={{ border: "1px solid #0f172a", height: "0.4cm", background: "rgba(255,255,255,0.25)" }}></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}