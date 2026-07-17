import { useState, useEffect, useCallback } from "react";
import { api, fileShareDownloadUrl } from "./api.js";
import { Icons, Modal, Badge, Toast, S, fmtDate, toUtcDate } from "./components.jsx";

const MAX_SIZE = 200 * 1024 * 1024; // 200MB, matches the server-side multer limit

function fmtFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function daysLeft(expiresAt) {
  const exp = toUtcDate(expiresAt);
  if (!exp) return null;
  return Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function expiryInfo(expiresAt) {
  const d = daysLeft(expiresAt);
  if (d === null) return { label: "—", color: "#94A3B8" };
  if (d <= 0) return { label: "Expiring today", color: "#EF4444" };
  if (d === 1) return { label: "Expires in 1 day", color: "#F59E0B" };
  return { label: `Expires in ${d} days`, color: d <= 1 ? "#F59E0B" : "#64748B" };
}

const FILE_TYPE_COLOR = {
  Image: "#0EA5E9", PDF: "#EF4444", Word: "#2563EB", Excel: "#16A34A", PowerPoint: "#EA580C",
  Archive: "#7C3AED", Video: "#DB2777", Audio: "#0D9488", Text: "#64748B", CSV: "#16A34A",
};

export default function FileSharingPage({ user }) {
  const [files, setFiles]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState("received"); // 'received' | 'sent'
  const [showShare, setShowShare] = useState(false);
  const [toast, setToast]   = useState(null);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try { setFiles(await api.getFileShares()); }
    catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const received = files.filter(f => f.recipient_id === user.id);
  const sent = files.filter(f => f.sender_id === user.id);
  const list = tab === "received" ? received : sent;
  const unreadCount = received.filter(f => !f.downloaded_at).length;

  function handleDownload(f) {
    // Same-origin download with the auth token carried in the URL (a plain
    // link can't set an Authorization header) — browser handles the save,
    // then we refresh so "downloaded" status reflects it.
    window.location.href = fileShareDownloadUrl(f.id);
    setTimeout(load, 1200);
  }

  async function handleDelete(f) {
    const isMine = f.sender_id === user.id;
    if (!window.confirm(isMine
      ? `Delete "${f.file_name}"? This removes it from the server for both you and ${f.recipient_name}.`
      : `Delete "${f.file_name}"? This frees up server space — make sure you've downloaded it first.`))
      return;
    try { await api.deleteFileShare(f.id); showToast("File deleted."); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>File Sharing ({files.length})</h2>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Share files up to 200MB directly with another user — only the two of you can see them.</p>
        </div>
        <button onClick={() => setShowShare(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          <Icons.Plus /> Share a File
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #E2E8F0" }}>
        {[
          { key: "received", label: "Received", count: received.length },
          { key: "sent", label: "Sent", count: sent.length },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 16px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid #0E7490" : "2px solid transparent",
            color: tab === t.key ? "#0E7490" : "#64748B", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
          }}>
            {t.label} ({t.count})
            {t.key === "received" && unreadCount > 0 && (
              <span style={{ background: "#EF4444", color: "white", fontSize: 10, fontWeight: 800, borderRadius: 99, padding: "1px 6px" }}>{unreadCount} new</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <FilesTable list={list} tab={tab} loading={loading} onDownload={handleDownload} onDelete={handleDelete} />
      </div>

      {showShare && (
        <ShareFileModal
          onClose={() => setShowShare(false)}
          onSaved={() => { load(); setShowShare(false); showToast("File shared."); }}
        />
      )}
      {toast && <Toast {...toast} />}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────
function FilesTable({ list, tab, loading, onDownload, onDelete }) {
  if (loading) return <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>;
  if (!list.length) return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#94A3B8" }}>
      <Icons.Share />
      <p style={{ fontSize: 15, fontWeight: 600, color: "#CBD5E1", marginTop: 10 }}>
        {tab === "received" ? "Nothing shared with you yet" : "You haven't shared any files yet"}
      </p>
    </div>
  );

  const headers = tab === "received" ? ["File", "From", "Message", "Shared", "Status", "Actions"] : ["File", "To", "Message", "Shared", "Status", "Actions"];

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
          {list.map((f, i) => {
            const exp = expiryInfo(f.expires_at);
            const otherParty = tab === "received" ? f.sender_name : f.recipient_name;
            return (
              <tr key={f.id} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "white" : "#FAFCFF" }}>
                <td style={{ padding: "11px 14px", maxWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: FILE_TYPE_COLOR[f.file_type] || "#64748B", flexShrink: 0 }}><Icons.File /></span>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ fontWeight: 600, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</div>
                      <div style={{ fontSize: 11, color: "#94A3B8" }}>{f.file_type} · {fmtFileSize(f.file_size)}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "11px 14px", color: "#475569", whiteSpace: "nowrap" }}>{otherParty}</td>
                <td style={{ padding: "11px 14px", color: "#64748B", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.message || "—"}</td>
                <td style={{ padding: "11px 14px", color: "#94A3B8", whiteSpace: "nowrap", fontSize: 12 }}>{fmtDate(f.created_at)}</td>
                <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: exp.color }}>{exp.label}</div>
                  {tab === "received" && (
                    <div style={{ marginTop: 2 }}>
                      {f.downloaded_at ? <Badge label="Downloaded" color="#10B981" /> : <Badge label="Not downloaded" color="#F59E0B" />}
                    </div>
                  )}
                </td>
                <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                  <button onClick={() => onDownload(f)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 7, color: "#1D4ED8", fontWeight: 700, fontSize: 11.5, cursor: "pointer", marginRight: 6 }}>
                    <Icons.Download /> Download
                  </button>
                  <button onClick={() => onDelete(f)} style={{ padding: "6px 8px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, color: "#DC2626", cursor: "pointer" }} title="Delete from server"><Icons.Trash /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Share Modal ────────────────────────────────────────────────────────────────
function ShareFileModal({ onClose, onSaved }) {
  const [users, setUsers]           = useState([]);
  const [recipientId, setRecipientId] = useState("");
  const [message, setMessage]       = useState("");
  const [file, setFile]             = useState(null);
  const [error, setError]           = useState("");
  const [progress, setProgress]     = useState(null); // null = not uploading, 0-100 while uploading
  const [uploadHandle, setUploadHandle] = useState(null);

  useEffect(() => { api.getUserDirectory().then(setUsers).catch(() => {}); }, []);

  function handleFileChange(e) {
    const f = e.target.files?.[0] || null;
    if (f && f.size > MAX_SIZE) {
      setError(`That file is ${fmtFileSize(f.size)} — the limit is 200MB.`);
      e.target.value = "";
      setFile(null);
      return;
    }
    setError("");
    setFile(f);
  }

  function handleCancelUpload() {
    if (uploadHandle) uploadHandle.abort();
  }

  async function handleSubmit() {
    if (!recipientId) return setError("Please choose who to share this with.");
    if (!file) return setError("Please choose a file to share.");
    setError("");
    setProgress(0);

    const { promise, abort } = api.shareFile(recipientId, message, file, setProgress);
    setUploadHandle({ abort });
    try {
      await promise;
      onSaved();
    } catch (e) {
      setError(e.message);
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <Modal onClose={uploading ? () => {} : onClose} width={460}>
      {!uploading && (
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: 6, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Close /></button>
      )}
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Share a File</h3>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#DC2626", fontSize: 13 }}>{error}</div>}

      {uploading ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ color: "#0E7490" }}><Icons.File /></span>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
              <div style={{ fontSize: 11.5, color: "#94A3B8" }}>{fmtFileSize(file.size)}</div>
            </div>
          </div>
          <div style={{ background: "#F1F5F9", borderRadius: 99, height: 10, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(135deg,#0E7490,#1E40AF)", borderRadius: 99, transition: "width .15s" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "#64748B", marginBottom: 20 }}>{progress}% uploaded{progress >= 100 ? " — finishing up…" : ""}</div>
          <button onClick={handleCancelUpload} style={{ width: "100%", padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel Upload</button>
        </div>
      ) : (
        <>
          <label style={S.label}>Share With *</label>
          <select style={{ ...S.input, marginBottom: 16, cursor: "pointer" }} value={recipientId} onChange={e => setRecipientId(e.target.value)}>
            <option value="">Select a user…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.department ? ` — ${u.department}` : ""}</option>)}
          </select>

          <label style={S.label}>Message (optional)</label>
          <textarea style={{ ...S.input, height: 60, resize: "vertical", marginBottom: 16 }} placeholder="What's this file about?" value={message} onChange={e => setMessage(e.target.value)} />

          <label style={S.label}>File *</label>
          {!file ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 9, color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 6 }}>
              <Icons.Upload /> Choose a file to share
              <input type="file" style={{ display: "none" }} onChange={handleFileChange} />
            </label>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 9, marginBottom: 6 }}>
              <span style={{ color: "#0E7490" }}><Icons.File /></span>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0E7490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{fmtFileSize(file.size)}</div>
              </div>
              <button type="button" onClick={() => setFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#0E7490", display: "flex" }}><Icons.Close /></button>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "#94A3B8", marginBottom: 20 }}>Up to 200MB. The recipient has 3 days to download it before it's automatically removed from the server.</div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F1F5F9", border: "none", borderRadius: 9, fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSubmit} style={{ flex: 2, padding: 11, background: "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer" }}>Share File</button>
          </div>
        </>
      )}
    </Modal>
  );
}
