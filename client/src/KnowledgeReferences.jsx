import { useState, useEffect } from "react";
import { api } from "./api.js";
import { Icons, Modal, S, Toast, fmtDateOnly } from "./components.jsx";

const TYPE_COLOR = { PDF: "#DC2626", Word: "#1D4ED8", PowerPoint: "#C2410C", Excel: "#059669" };
const TYPE_ICON  = { PDF: "📄", Word: "📝", PowerPoint: "📊", Excel: "📈" };

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeReferences({ isAdmin }) {
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [toast, setToast]     = useState(null);
  const [search, setSearch]   = useState("");

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    try { setDocs(await api.getKnowledgeDocs()); }
    catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try { await api.deleteKnowledgeDoc(doc.id); showToast("Document deleted."); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  const filtered = docs.filter(d =>
    !search.trim() || d.title.toLowerCase().includes(search.toLowerCase()) || d.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Reference Documents ({docs.length})</h2>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Policies, guides, and general information shared by IT</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowUpload(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            <Icons.Plus /> Upload Document
          </button>
        )}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…"
        style={{ width: "100%", maxWidth: 360, padding: "9px 14px", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 13, outline: "none", marginBottom: 18 }} />

      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📚</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1" }}>No reference documents yet</p>
          {isAdmin && <p style={{ fontSize: 13, marginTop: 4 }}>Click "Upload Document" to add the first one.</p>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {filtered.map(doc => (
            <div key={doc.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "18px 20px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{TYPE_ICON[doc.file_type] || "📄"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", lineHeight: 1.3, marginBottom: 4 }}>{doc.title}</div>
                  <span style={{ background: (TYPE_COLOR[doc.file_type] || "#64748B") + "15", color: TYPE_COLOR[doc.file_type] || "#64748B", border: `1px solid ${(TYPE_COLOR[doc.file_type] || "#64748B")}40`, borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>
                    {doc.file_type}
                  </span>
                </div>
              </div>

              {doc.description && <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.5, marginBottom: 12, flex: 1 }}>{doc.description}</p>}

              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 14 }}>
                {fmtSize(doc.file_size)} · Uploaded {fmtDateOnly(doc.created_at)} by {doc.uploaded_by_name}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setViewing(doc)} style={{ flex: 1, padding: "8px 0", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  👁 View
                </button>
                {isAdmin && (
                  <button onClick={() => handleDelete(doc)} style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#DC2626", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    <Icons.Trash />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { load(); setShowUpload(false); showToast("Document uploaded successfully."); }} />}
      {viewing && <ViewerModal doc={viewing} onClose={() => setViewing(null)} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded }) {
  const [title, setTitle]   = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile]     = useState(null);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const ACCEPTED = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx";

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) { setFile(null); return; }
    if (f.size > 25 * 1024 * 1024) {
      setError("File must be smaller than 25MB.");
      e.target.value = "";
      return;
    }
    setError("");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""));
  }

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    if (!file) { setError("Please select a file to upload."); return; }
    setLoading(true); setError("");
    try { await onUploaded(await api.uploadKnowledgeDoc({ title, description, file })); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <Modal onClose={onClose} width={460}>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Upload Reference Document</h3>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <label style={S.label}>Title *</label>
      <input style={{ ...S.input, marginBottom: 16 }} placeholder="e.g. Acceptable Use Policy 2026" value={title} onChange={e => setTitle(e.target.value)} />

      <label style={S.label}>Description (optional)</label>
      <textarea style={{ ...S.input, height: 70, resize: "vertical", marginBottom: 16 }} placeholder="Brief note about what this document covers…" value={description} onChange={e => setDescription(e.target.value)} />

      <label style={S.label}>File *</label>
      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: 90, border: "2px dashed #E2E8F0", borderRadius: 9, marginBottom: 24, cursor: "pointer", color: file ? "#0E7490" : "#94A3B8", background: "#FAFCFF" }}>
        <Icons.Upload />
        <span style={{ fontSize: 12, fontWeight: 600, textAlign: "center", padding: "0 12px" }}>{file ? file.name : "Click to choose a file"}</span>
        <span style={{ fontSize: 11, color: "#CBD5E1" }}>PDF, Word, PowerPoint, Excel — max 25MB</span>
        <input type="file" accept={ACCEPTED} onChange={handleFileChange} style={{ display: "none" }} />
      </label>

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading}
          style={{ flex: 2, padding: 11, background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Uploading…" : "Upload Document"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Viewer Modal ─────────────────────────────────────────────────────────────
// PDFs render natively in an <iframe>. Word/Excel/PowerPoint files can't be
// rendered directly by browsers, so for those we offer a direct open/download
// link instead (still "viewing in the browser" via the OS-associated app or
// the browser's own download flow — no extra server-side conversion needed).
function ViewerModal({ doc, onClose }) {
  const isPdf = doc.file_type === "PDF";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000070", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: 14, width: "100%", maxWidth: isPdf ? 900 : 460, height: isPdf ? "90vh" : "auto", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px #0005" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>{doc.file_name}</div>
          </div>
          <button onClick={onClose} style={{ background: "#F1F5F9", border: "none", borderRadius: 7, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 12 }}><Icons.Close /></button>
        </div>

        {isPdf ? (
          <iframe src={doc.file_path} title={doc.title} style={{ flex: 1, border: "none", width: "100%" }} />
        ) : (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>{TYPE_ICON[doc.file_type] || "📄"}</div>
            <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>
              {doc.file_type} files open in their associated application. Click below to open or download.
            </p>
            <a href={doc.file_path} target="_blank" rel="noopener noreferrer" download={doc.file_name}
              style={{ display: "inline-block", padding: "11px 24px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", borderRadius: 9, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
              Open / Download File
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
