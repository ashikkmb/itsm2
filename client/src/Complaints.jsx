import { useState, useEffect } from "react";
import { api } from "./api.js";
import { Badge, Modal, Icons, S, STA_COLOR, STA_BG, CAT_COLOR, PRI_COLOR, fmtDate, fmtDateOnly, CATEGORIES, PRIORITIES } from "./components.jsx";

// ─── Complaints Table ─────────────────────────────────────────────────────────
export function ComplaintsTable({ complaints, onSelect, loading }) {
  if (loading) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );
  if (!complaints.length) return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: "0 auto 12px", display: "block" }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
      <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1" }}>No complaints found</p>
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0" }}>
            {["Ticket", "Title", "Complainant", "Category", "Priority", "Status", "Raised By", "Dept", "Date"].map(h => (
              <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {complaints.map((c, i) => (
            <tr key={c.id} onClick={() => onSelect(c)}
              style={{ borderBottom: "1px solid #F1F5F9", cursor: "pointer", background: i % 2 === 0 ? "white" : "#FAFCFF", transition: "background .1s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "white" : "#FAFCFF"}
            >
              <td style={{ padding: "11px 14px", fontWeight: 700, color: "#0E7490", fontFamily: "monospace", whiteSpace: "nowrap" }}>{c.ticket_no}</td>
              <td style={{ padding: "11px 14px", color: "#1E293B", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</td>
              <td style={{ padding: "11px 14px", color: "#475569" }}>{c.complainant_name || "—"}</td>
              <td style={{ padding: "11px 14px" }}><Badge label={c.category} color={CAT_COLOR[c.category]} /></td>
              <td style={{ padding: "11px 14px" }}><Badge label={c.priority} color={PRI_COLOR[c.priority]} /></td>
              <td style={{ padding: "11px 14px" }}><Badge label={c.status}   color={STA_COLOR[c.status]} bg={STA_BG[c.status]} /></td>
              <td style={{ padding: "11px 14px", color: "#475569", whiteSpace: "nowrap" }}>{c.user_name}</td>
              <td style={{ padding: "11px 14px", color: "#94A3B8", whiteSpace: "nowrap" }}>{c.user_dept}</td>
              <td style={{ padding: "11px 14px", color: "#94A3B8", whiteSpace: "nowrap" }}>{fmtDateOnly(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Text formatting helpers ──────────────────────────────────────────────────
// Capitalizes the first letter of every word (for names): "john smith" -> "John Smith"
function capitalizeWords(str) {
  return str.replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

// Capitalizes only the very first letter of the whole text (for descriptions):
// "the monitor is broken" -> "The monitor is broken"
// Parses the attachment_path column, which may be either:
//   - a single bare path string (complaints created before multi-image support), or
//   - a JSON array of path strings (current format, supports up to 5 images)
// Always returns an array, so callers don't need to know which format applies.
function getAttachmentPaths(attachmentPath) {
  if (!attachmentPath) return [];
  if (attachmentPath.startsWith("[")) {
    try {
      const parsed = JSON.parse(attachmentPath);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [attachmentPath];
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Capitalizes the first letter of every sentence: capitalizes the very start
// of the text, and again after each ". ", "! ", or "? " — leaves everything
// else untouched. Used for Title, Remarks, and Comment fields.
function capitalizeSentences(str) {
  if (!str) return str;
  return str.replace(/(^\s*\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
}

// ─── New Complaint Form ───────────────────────────────────────────────────────
const MAX_ATTACHMENTS = 5;

export function ComplaintForm({ user, onSubmit, onClose }) {
  const [form, setForm]     = useState({ category: "Hardware", title: "", description: "", complainant_name: "", attachments: [] });
  const [previews, setPreviews] = useState([]); // { url, name } objects, parallel to form.attachments
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const remainingSlots = MAX_ATTACHMENTS - form.attachments.length;

    if (remainingSlots <= 0) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} images per complaint.`);
      e.target.value = "";
      return;
    }

    const accepted = [];
    for (const file of files.slice(0, remainingSlots)) {
      if (!validTypes.includes(file.type)) {
        setError("Only image files (JPG, PNG, GIF, WEBP) are allowed.");
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(`"${file.name}" is larger than 5MB and was skipped.`);
        continue;
      }
      accepted.push(file);
    }

    if (files.length > remainingSlots) {
      setError(`Only ${remainingSlots} more image(s) could be added (max ${MAX_ATTACHMENTS} total).`);
    } else if (accepted.length === files.length) {
      setError("");
    }

    if (accepted.length) {
      setForm(f => ({ ...f, attachments: [...f.attachments, ...accepted] }));
      setPreviews(p => [...p, ...accepted.map(file => ({ url: URL.createObjectURL(file), name: file.name }))]);
    }
    e.target.value = "";
  }

  function removeAttachment(index) {
    setForm(f => ({ ...f, attachments: f.attachments.filter((_, i) => i !== index) }));
    setPreviews(p => p.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!form.complainant_name.trim()) { setError("Complainant name is required."); return; }
    if (!form.title.trim()) { setError("Title is required."); return; }
    setLoading(true); setError("");
    try { await onSubmit(form); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose}>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>New Complaint</h2>
      <p style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>Logged by {user.name} · {user.department}</p>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <label style={S.label}>Complainant Name *</label>
      <input style={{ ...S.input, marginBottom: 18 }} placeholder="Name of the person raising this complaint" value={form.complainant_name} onChange={e => setForm(f => ({ ...f, complainant_name: capitalizeWords(e.target.value) }))} />

      <label style={S.label}>Category *</label>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setForm(f => ({ ...f, category: c }))}
            style={{ flex: 1, padding: "9px 0", border: `2px solid ${form.category === c ? CAT_COLOR[c] : "#E2E8F0"}`, borderRadius: 8, background: form.category === c ? CAT_COLOR[c] + "15" : "white", color: form.category === c ? CAT_COLOR[c] : "#64748B", fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all .15s" }}>
            {c}
          </button>
        ))}
      </div>

      <label style={S.label}>Title *</label>
      <input style={{ ...S.input, marginBottom: 18 }} placeholder="Brief summary of the issue" value={form.title} onChange={e => setForm(f => ({ ...f, title: capitalizeSentences(e.target.value) }))} />

      <label style={S.label}>Description (optional)</label>
      <textarea style={{ ...S.input, height: 100, resize: "vertical", marginBottom: 18 }} placeholder="Describe the problem in detail — when it started, any error messages…" value={form.description} onChange={e => setForm(f => ({ ...f, description: capitalizeSentences(e.target.value) }))} />

      <label style={S.label}>Attach Screenshots (optional, up to {MAX_ATTACHMENTS})</label>

      {previews.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8, marginBottom: 12 }}>
          {previews.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={p.url} alt={p.name} style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #E2E8F0", display: "block" }} />
              <button onClick={() => removeAttachment(i)} type="button"
                style={{ position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: 99, background: "#DC2626", color: "white", border: "2px solid white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icons.Close />
              </button>
            </div>
          ))}
        </div>
      )}

      {form.attachments.length < MAX_ATTACHMENTS && (
        <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: 80, border: "2px dashed #E2E8F0", borderRadius: 9, marginBottom: 24, cursor: "pointer", color: "#94A3B8", background: "#FAFCFF" }}>
          <Icons.Upload />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {previews.length > 0 ? "Add another image" : "Click to upload image(s)"}
          </span>
          <span style={{ fontSize: 11, color: "#CBD5E1" }}>JPG, PNG, GIF, WEBP — max 5MB each</span>
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple onChange={handleFileChange} style={{ display: "none" }} />
        </label>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 12, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading}
          style={{ flex: 2, padding: 12, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {loading ? <><span className="spinner" style={{ width: 16, height: 16, borderTopColor: "white", borderColor: "rgba(255,255,255,0.3)" }} />Submitting…</> : "Submit Complaint"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────
export function DetailDrawer({ complaint, isAdmin, onClose, onCloseComplaint, onStatusChange }) {
  const [showClose,  setShowClose]  = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [activity,   setActivity]   = useState([]);
  const [loadAct,    setLoadAct]    = useState(false);

  useEffect(() => {
    if (!complaint) return;
    setLoadAct(true);
    api.getActivity(complaint.id)
      .then(setActivity)
      .catch(() => {})
      .finally(() => setLoadAct(false));
  }, [complaint?.id]);

  if (!complaint) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#00000040", zIndex: 40 }} />
      <div className="fade-in" style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 460, background: "white", zIndex: 50, boxShadow: "-8px 0 40px #0003", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>{complaint.ticket_no}</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A" }}>{complaint.title}</h3>
          </div>
          <button onClick={onClose} style={{ background: "#F1F5F9", border: "none", borderRadius: 7, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icons.Close /></button>
        </div>

        <div style={{ padding: "24px 28px", flex: 1 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            <Badge label={complaint.status}   color={STA_COLOR[complaint.status]} bg={STA_BG[complaint.status]} />
            <Badge label={complaint.category} color={CAT_COLOR[complaint.category]} />
            <Badge label={complaint.priority} color={PRI_COLOR[complaint.priority]} />
          </div>

          <DetailField label="Raised By"    value={`${complaint.user_name} · ${complaint.user_dept}`} />
          {complaint.complainant_name && <DetailField label="Complainant Name" value={complaint.complainant_name} />}
          <DetailField label="Created"      value={fmtDate(complaint.created_at)} />
          <DetailField label="Last Updated" value={fmtDate(complaint.updated_at)} />
          {complaint.description && <DetailField label="Description"  value={complaint.description} multiline />}
          {(() => {
            const images = getAttachmentPaths(complaint.attachment_path);
            if (!images.length) return null;
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                  Attached Screenshot{images.length > 1 ? `s (${images.length})` : ""}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: images.length === 1 ? "1fr" : "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                  {images.map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                      <img src={src} alt={`Complaint attachment ${i + 1}`}
                        style={{ width: "100%", maxHeight: images.length === 1 ? 220 : 110, height: images.length === 1 ? "auto" : 110, objectFit: "cover", borderRadius: 8, border: "1px solid #E2E8F0", display: "block", cursor: "zoom-in" }} />
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}
          {complaint.remarks && <DetailField label="Resolution Remarks" value={complaint.remarks} multiline accent />}
          {complaint.closed_by_name && <DetailField label="Closed By" value={complaint.closed_by_name} />}

          {/* Activity log */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Activity Log</div>
            {loadAct ? <span className="spinner" /> : activity.length === 0 ? <p style={{ fontSize: 13, color: "#CBD5E1" }}>No activity yet.</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activity.map(a => (
                  <div key={a.id} style={{ display: "flex", gap: 10, fontSize: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: "#0E7490", marginTop: 4, flexShrink: 0 }} />
                    <div>
                      <span style={{ fontWeight: 700, color: "#334155" }}>{a.actor_name}</span>
                      <span style={{ color: "#94A3B8" }}> · {a.action}</span>
                      {a.detail && <div style={{ color: "#64748B", marginTop: 2 }}>{a.detail}</div>}
                      <div style={{ color: "#CBD5E1", marginTop: 1 }}>{fmtDate(a.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {isAdmin && complaint.status !== "Closed" && (
          <div style={{ padding: "20px 28px", borderTop: "1px solid #E2E8F0", display: "flex", gap: 10 }}>
            <button onClick={() => setShowStatus(true)} style={{ flex: 1, padding: 10, background: "#EFF6FF", border: "2px solid #BFDBFE", borderRadius: 9, color: "#1D4ED8", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Update Status</button>
            <button onClick={() => setShowClose(true)}  style={{ flex: 1, padding: 10, background: "linear-gradient(135deg,#059669,#0E7490)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✓ Close</button>
          </div>
        )}
      </div>

      {showClose  && <CloseModal  complaint={complaint} onClose={() => setShowClose(false)}  onConfirm={async (id, r) => { await onCloseComplaint(id, r); setShowClose(false); onClose(); }} />}
      {showStatus && <StatusModal complaint={complaint} onClose={() => setShowStatus(false)} onConfirm={async (id, s, comment, priority) => { await onStatusChange(id, s, comment, priority); setShowStatus(false); onClose(); }} />}
    </>
  );
}

function DetailField({ label, value, multiline, accent }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: accent ? "#059669" : "#334155", lineHeight: 1.6, background: accent ? "#ECFDF5" : "#F8FAFC", borderRadius: 8, padding: multiline ? "10px 12px" : "7px 12px", whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  );
}

// ─── Close Modal ──────────────────────────────────────────────────────────────
function CloseModal({ complaint, onClose, onConfirm }) {
  const [remarks, setRemarks] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    if (!remarks.trim()) { setError("Remarks are required."); return; }
    setLoading(true); setError("");
    try { await onConfirm(complaint.id, remarks); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Close Complaint</h3>
      <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>{complaint.ticket_no} · {complaint.title}</p>
      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#DC2626", fontSize: 13 }}>{error}</div>}
      <label style={S.label}>Resolution Remarks *</label>
      <textarea style={{ ...S.input, height: 110, resize: "vertical", marginBottom: 20 }} placeholder="Describe what was done to resolve this issue…" value={remarks} onChange={e => setRemarks(capitalizeSentences(e.target.value))} />
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleConfirm} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#059669,#0E7490)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Closing…" : "✓ Close Complaint"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Status Modal ─────────────────────────────────────────────────────────────
function StatusModal({ complaint, onClose, onConfirm }) {
  const [status,   setStatus]   = useState(complaint.status);
  const [priority, setPriority] = useState(complaint.priority);
  const [comment,  setComment]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleConfirm() {
    if (status === "In Progress" && !comment.trim()) {
      setError("A comment is required when moving to In Progress.");
      return;
    }
    setError("");
    setLoading(true);
    try { await onConfirm(complaint.id, status, comment, priority); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={420}>
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Update Status</h3>
      <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>{complaint.ticket_no} · {complaint.title}</p>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <label style={S.label}>Status</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {["Open", "In Progress"].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            style={{ padding: "11px 16px", border: `2px solid ${status === s ? STA_COLOR[s] : "#E2E8F0"}`, borderRadius: 9, background: status === s ? STA_BG[s] : "white", color: STA_COLOR[s], fontWeight: 700, fontSize: 14, cursor: "pointer", textAlign: "left" }}>
            {s === "Open" ? "🔴" : "🟡"} {s}
          </button>
        ))}
      </div>

      <label style={S.label}>Priority</label>
      <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
        {PRIORITIES.map(p => (
          <button key={p} onClick={() => setPriority(p)}
            style={{ flex: 1, padding: "7px 0", border: `2px solid ${priority === p ? PRI_COLOR[p] : "#E2E8F0"}`, borderRadius: 8, background: priority === p ? PRI_COLOR[p] + "15" : "white", color: priority === p ? PRI_COLOR[p] : "#64748B", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
            {p}
          </button>
        ))}
      </div>

      <label style={S.label}>
        Comment {status === "In Progress" ? "*" : "(optional)"}
      </label>
      <textarea style={{ ...S.input, height: 80, resize: "vertical", marginBottom: 20 }}
        placeholder={status === "In Progress" ? "Describe what action is being taken…" : "Optional note…"}
        value={comment} onChange={e => setComment(capitalizeSentences(e.target.value))} />

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleConfirm}
          disabled={loading} style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Updating…" : "Update Status"}
        </button>
      </div>
    </Modal>
  );
}
