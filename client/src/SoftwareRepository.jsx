import { useState, useEffect, useRef } from "react";
import { api, softwareRepoDownloadUrl } from "./api.js";
import { Icons, Modal, S, Toast, fmtDateOnly } from "./components.jsx";

const TYPE_COLOR = {
  EXE: "#2563EB", MSI: "#2563EB", ZIP: "#B45309", RAR: "#B45309", "7Z": "#B45309",
  ISO: "#7C3AED", PDF: "#DC2626", DMG: "#0F766E", APK: "#059669",
};
const DEFAULT_COLOR = "#64748B";

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SoftwareRepository() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [toast, setToast]     = useState(null);
  const debounceRef = useRef(null);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function load(searchTerm) {
    setLoading(true);
    try { setItems(await api.getSoftwareRepo(searchTerm)); }
    catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }

  // Initial load
  useEffect(() => { load(""); }, []);

  // Debounced search-as-you-type against the backend
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(search), 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    try { await api.deleteSoftware(item.id); showToast("File deleted."); load(search); }
    catch (e) { showToast(e.message, "error"); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>Software Repository ({items.length})</h2>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Installers, drivers, and tools for IT to hand out — admin only</p>
        </div>
        <button onClick={() => setShowUpload(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          <Icons.Upload /> Upload File
        </button>
      </div>

      <div style={{ position: "relative", maxWidth: 380, marginBottom: 18 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or description…"
          style={{ width: "100%", padding: "9px 14px 9px 36px", border: "1px solid #E2E8F0", borderRadius: 9, fontSize: 13, outline: "none" }} />
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", display: "flex" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} /></div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>💾</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1" }}>{search ? "No matching files" : "No files uploaded yet"}</p>
          {!search && <p style={{ fontSize: 13, marginTop: 4 }}>Click "Upload File" to add the first one.</p>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {items.map(item => {
            const color = TYPE_COLOR[item.file_type] || DEFAULT_COLOR;
            return (
              <div key={item.id} style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "18px 20px", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: color + "18", color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icons.File />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", lineHeight: 1.3, marginBottom: 4, wordBreak: "break-word" }}>{item.title}</div>
                    <span style={{ background: color + "15", color, border: `1px solid ${color}40`, borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>
                      {item.file_type}
                    </span>
                  </div>
                </div>

                {item.description && <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.5, marginBottom: 12, flex: 1 }}>{item.description}</p>}

                <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 14 }}>
                  {fmtSize(item.file_size)} · Uploaded {fmtDateOnly(item.created_at)} by {item.uploaded_by_name}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <a href={softwareRepoDownloadUrl(item.id)}
                    style={{ flex: 1, textAlign: "center", padding: "8px 0", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, color: "#1D4ED8", fontWeight: 700, fontSize: 12, textDecoration: "none" }}>
                    <Icons.Download /> Download
                  </a>
                  <button onClick={() => handleDelete(item)} style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, color: "#DC2626", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    <Icons.Trash />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={(msg) => { load(search); setShowUpload(false); showToast(msg); }} />}
      {toast && <Toast {...toast} />}
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }) {
  const [title, setTitle]   = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile]     = useState(null);
  const [error, setError]   = useState("");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const abortRef = useRef(null);

  function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) { setFile(null); return; }
    setError("");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""));
  }

  function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    if (!file) { setError("Please select a file to upload."); return; }
    setError(""); setUploading(true); setProgress(0);

    const { promise, abort } = api.uploadSoftware(title, description, file, setProgress);
    abortRef.current = abort;
    promise
      .then(() => onDone("File uploaded successfully."))
      .catch(e => { setError(e.message); setUploading(false); });
  }

  function handleCancel() {
    if (uploading && abortRef.current) abortRef.current();
    onClose();
  }

  return (
    <Modal onClose={uploading ? () => {} : onClose} width={460}>
      {!uploading && (
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      )}
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Upload to Software Repository</h3>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      <label style={S.label}>Title *</label>
      <input style={{ ...S.input, marginBottom: 16 }} placeholder="e.g. HP LaserJet Driver v4.2" value={title} onChange={e => setTitle(e.target.value)} disabled={uploading} />

      <label style={S.label}>Description (optional)</label>
      <textarea style={{ ...S.input, height: 70, resize: "vertical", marginBottom: 16 }} placeholder="What is this file for, which devices/OS it's for, version notes…" value={description} onChange={e => setDescription(e.target.value)} disabled={uploading} />

      <label style={S.label}>File *</label>
      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: 90, border: "2px dashed #E2E8F0", borderRadius: 9, marginBottom: 20, cursor: uploading ? "default" : "pointer", color: file ? "#0E7490" : "#94A3B8", background: "#FAFCFF" }}>
        <Icons.Upload />
        <span style={{ fontSize: 12, fontWeight: 600, textAlign: "center", padding: "0 12px", wordBreak: "break-word" }}>{file ? file.name : "Click to choose a file"}</span>
        <span style={{ fontSize: 11, color: "#CBD5E1" }}>Any file type — max 10GB</span>
        <input type="file" onChange={handleFileChange} style={{ display: "none" }} disabled={uploading} />
      </label>

      {uploading && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ height: 8, borderRadius: 99, background: "#F1F5F9", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(135deg,#0E7490,#1E40AF)", transition: "width .2s" }} />
          </div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6, textAlign: "center" }}>{progress}% uploaded</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleCancel} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>
          {uploading ? "Cancel Upload" : "Cancel"}
        </button>
        {!uploading && (
          <button onClick={handleSubmit} style={{ flex: 2, padding: 11, background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer" }}>
            Upload File
          </button>
        )}
      </div>
    </Modal>
  );
}
