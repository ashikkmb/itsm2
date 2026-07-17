import { useState, useRef, useEffect } from "react";
import { api } from "./api.js";
import { Icons, S, toUtcDate } from "./components.jsx";

const CATEGORY_OPTIONS = ["Hardware", "Software", "INAMS"];

export default function PrintRegister({ orgName = "ITCMS - NAD (A)" }) {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // first of this month
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedCategories, setSelectedCategories] = useState(new Set(["Hardware", "Software"])); // default ticked
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryRef = useRef(null);
  const [status, setStatus] = useState("All");
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState("");

  // Close the category dropdown when clicking anywhere outside it
  useEffect(() => {
    function handleClickOutside(e) {
      if (categoryRef.current && !categoryRef.current.contains(e.target)) setCategoryOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleCategory(cat) {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const categoryLabel = selectedCategories.size === 0
    ? "No categories selected"
    : selectedCategories.size === CATEGORY_OPTIONS.length
    ? "All Categories"
    : [...selectedCategories].join(", ");

  async function handleGenerate() {
    if (!fromDate || !toDate) { setError("Please select both dates."); return; }
    if (fromDate > toDate) { setError("From date must be before To date."); return; }
    setError("");
    setLoading(true);
    try {
      const params = {};
      if (status !== "All") params.status = status;
      const all = await api.getComplaints(params);

      // Filter by date range (inclusive), comparing the IST calendar date —
      // not the raw UTC string, which could be off by a day near midnight IST.
      const filtered = all.filter(c => {
        const createdIST = toUtcDate(c.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // en-CA gives YYYY-MM-DD
        return createdIST >= fromDate && createdIST <= toDate;
      });

      // Sort oldest first for a register-style chronological listing
      filtered.sort((a, b) => toUtcDate(a.created_at) - toUtcDate(b.created_at));

      setComplaints(filtered);
      setGenerated(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const fmtShort = (iso) => {
    // fromDate/toDate inputs are plain "YYYY-MM-DD" with no time — display as-is.
    // Complaint created_at values are full UTC timestamps — convert to IST first.
    const d = iso.length === 10 ? new Date(iso + "T00:00:00") : toUtcDate(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: iso.length === 10 ? undefined : "Asia/Kolkata" });
  };
  const fmtRangeLabel = `${fmtShort(fromDate)} to ${fmtShort(toDate)}`;

  // Only complaints whose category is currently ticked in the dropdown get shown/printed
  const displayedComplaints = complaints.filter(c => selectedCategories.has(c.category));

  return (
    <div>
      {/* ── Screen-only controls (hidden when printing) ── */}
      <div className="no-print" style={{ background: "white", borderRadius: 12, padding: "20px 24px", border: "1px solid #E2E8F0", marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 16 }}>Generate Printable Register</h3>

        {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#DC2626", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={S.label}>From Date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={S.input} />
          </div>
          <div>
            <label style={S.label}>To Date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={S.input} />
          </div>
          <div ref={categoryRef} style={{ position: "relative" }}>
            <label style={S.label}>Category</label>
            <button type="button" onClick={() => setCategoryOpen(o => !o)}
              style={{ ...S.select, height: 39, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", minWidth: 180, textAlign: "left" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{categoryLabel}</span>
              <span style={{ fontSize: 10, color: "#94A3B8" }}>▾</span>
            </button>
            {categoryOpen && (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "white", border: "1px solid #E2E8F0", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", padding: 8, zIndex: 20, minWidth: 180 }}>
                {CATEGORY_OPTIONS.map(cat => (
                  <label key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: 13, color: "#334155", cursor: "pointer", borderRadius: 6 }}>
                    <input type="checkbox" checked={selectedCategories.has(cat)} onChange={() => toggleCategory(cat)} />
                    {cat}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label style={S.label}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...S.select, height: 39 }}>
              <option value="All">All Statuses</option>
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <button onClick={handleGenerate} disabled={loading}
            style={{ padding: "10px 20px", background: loading ? "#94A3B8" : "linear-gradient(135deg,#0E7490,#1E40AF)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: loading ? "not-allowed" : "pointer", height: 39 }}>
            {loading ? "Loading…" : "Generate"}
          </button>
          {generated && (
            <button onClick={handlePrint} disabled={selectedCategories.size === 0}
              style={{ padding: "10px 20px", background: selectedCategories.size === 0 ? "#94A3B8" : "linear-gradient(135deg,#059669,#0E7490)", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: selectedCategories.size === 0 ? "not-allowed" : "pointer", height: 39, display: "flex", alignItems: "center", gap: 8 }}>
              🖨️ Print / Save as PDF
            </button>
          )}
        </div>
      </div>

      {/* ── Printable A4 Register ── */}
      {generated && (
        <div className="print-page" style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "32px 36px" }}>
          {/* Compact meta line (org header removed) */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>
              Period: {fmtRangeLabel} · Category: {categoryLabel}
              {status !== "All" && ` · Status: ${status}`}
            </p>
          </div>

          {displayedComplaints.length === 0 ? (
            <p style={{ textAlign: "center", color: "#94A3B8", padding: "40px 0" }}>No complaints found for the selected criteria.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <thead>
                <tr style={{ background: "#F1F5F9" }}>
                  {["S.No", "Ticket No", "Date", "Complainant", "Category", "Nature of Complaint", "Status", "Remarks"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedComplaints.map((c, i) => (
                  <tr key={c.id} style={{ breakInside: "avoid" }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace" }}>{c.ticket_no}</td>
                    <td style={tdStyle}>{fmtShort(c.created_at)}</td>
                    <td style={tdStyle}>
                      {c.complainant_name || c.user_name}
                      {(c.raised_by_dept || c.user_dept) && (
                        <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>{c.raised_by_dept || c.user_dept}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{c.category}</td>
                    <td style={{ ...tdStyle, maxWidth: 170 }}>{c.title}</td>
                    <td style={tdStyle}>{c.status}</td>
                    <td style={{ ...tdStyle, maxWidth: 180, fontSize: 9.5 }}>{c.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Signature block for physical record-keeping */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 48, paddingTop: 16 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ borderTop: "1px solid #334155", width: 180, marginBottom: 4 }} />
              <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>Prepared By</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ borderTop: "1px solid #334155", width: 180, marginBottom: 4 }} />
              <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>IT Admin Signature</p>
            </div>
          </div>
        </div>
      )}

      {/* Print-specific styles */}
      <style>{`
        @media print {
          html, body {
            background: white !important;
            overflow: visible !important;
            height: auto !important;
            width: auto !important;
          }
          .no-print { display: none !important; }
          aside, header, nav { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; height: auto !important; }

          /* Hide everything except the register, then pull it out of any
             scrollable/fixed-height ancestor so no scrollbar can appear. */
          body * { visibility: hidden; }
          .print-page, .print-page * { visibility: visible; }
          .print-page {
            position: fixed;
            top: 0;
            left: 0;
            width: 100% !important;
            max-width: none !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
          .print-page table { width: 100% !important; }

          @page {
            size: A4;
            margin: 2cm;
          }
        }
      `}</style>
    </div>
  );
}

const thStyle = {
  padding: "6px 8px",
  textAlign: "left",
  fontWeight: 700,
  color: "#334155",
  border: "1px solid #CBD5E1",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};

const tdStyle = {
  padding: "6px 8px",
  border: "1px solid #E2E8F0",
  color: "#1E293B",
  verticalAlign: "top",
};
