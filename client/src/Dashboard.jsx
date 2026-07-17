import { useState, useEffect } from "react";
import { api } from "./api.js";
import { Icons, StatCard, CAT_COLOR, CATEGORIES } from "./components.jsx";
import { ComplaintsTable } from "./Complaints.jsx";

// ─── 14-day trend area chart (hand-rolled SVG, no chart library needed) ────
function TrendArea({ data, color = "#6366F1" }) {
  const w = 560, h = 120, pad = 8;
  const max = Math.max(1, ...data.map(d => d.count));
  const stepX = (w - pad * 2) / (data.length - 1 || 1);
  const points = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (d.count / max) * (h - pad * 2);
    return [x, y];
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${h - pad} L${points[0][0].toFixed(1)},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120, display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#trendFill)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        data[i].count > 0 && <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill={color} />
      ))}
    </svg>
  );
}

// ─── Status donut ───────────────────────────────────────────────────────────
function Donut({ segments, size = 108, thickness = 15 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1F5F9" strokeWidth={thickness} />
        {total > 0 && segments.filter(s => s.value > 0).map((seg, i) => {
          const segLen = (seg.value / total) * circumference;
          const dashArray = `${segLen} ${circumference - segLen}`;
          const dashOffset = -cumulative;
          cumulative += segLen;
          return (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color}
              strokeWidth={thickness} strokeDasharray={dashArray} strokeDashoffset={dashOffset} strokeLinecap="butt" />
          );
        })}
      </g>
      <text x="50%" y="47%" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0F172A">{total}</text>
      <text x="50%" y="63%" textAnchor="middle" fontSize="9.5" fill="#94A3B8" fontWeight="600">TOTAL</text>
    </svg>
  );
}

// ─── Generic module overview card ──────────────────────────────────────────
function ModuleCard({ title, icon, color, onClick, stats, footer }) {
  return (
    <div onClick={onClick}
      style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "18px 20px", cursor: onClick ? "pointer" : "default", transition: "all .15s" }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 4px 20px ${color}22`; }}}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.boxShadow = ""; }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>{icon}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>{title}</div>
        {onClick && <span style={{ marginLeft: "auto", fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>View →</span>}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {stats.map((s, i) => (
          <div key={i}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color || "#0F172A", lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3, fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {footer && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1F5F9", fontSize: 11.5, color: "#64748B" }}>{footer}</div>}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard({ user, isAdmin, complaints, loading, setPage, setCatFilter, setStaFilter, setSearch, onSelectComplaint }) {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    api.getDashboardSummary()
      .then(data => { if (!cancelled) setSummary(data); })
      .catch(() => { /* dashboard degrades gracefully with the cards it can still show */ })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const goto = (key) => { setPage(key); setCatFilter?.("All"); setStaFilter?.("All"); setSearch?.(""); };

  const c  = summary?.complaints;
  const t  = summary?.tasks;
  const fs = summary?.fileSharing;
  const ft = summary?.fileTracking;
  const kb = summary?.knowledge;
  const lp = summary?.lunchpass;
  const pr = summary?.print;

  // Headline KPI row — one number per module the user actually has, so this
  // reads as "the whole system at a glance" rather than "complaints only".
  const kpis = [];
  if (c)  kpis.push({ label: "Open Complaints",  value: c.open,          color: "#EF4444", icon: <Icons.Alert /> });
  if (t)  kpis.push({ label: "Tasks Pending",     value: t.pending + t.inProgress, color: "#F59E0B", icon: <Icons.Tasks /> });
  if (ft) kpis.push({ label: "Files in Tracking", value: ft.pending + ft.inProgress, color: "#0E7490", icon: <Icons.File /> });
  if (fs) kpis.push({ label: "Unread Shared Files", value: fs.unread,     color: "#8B5CF6", icon: <Icons.Share /> });
  if (kpis.length < 4 && c) kpis.push({ label: "Total Complaints", value: c.total, color: "#6366F1", icon: <Icons.List /> });
  if (kpis.length < 4 && lp) kpis.push({ label: "Active Lunch Passes", value: lp.active, color: "#059669", icon: <Icons.Utensils /> });

  return (
    <>
      {/* ── Headline KPIs ── */}
      {kpis.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          {kpis.slice(0, 4).map((k, i) => <StatCard key={i} label={k.label} value={k.value ?? "—"} color={k.color} icon={k.icon} />)}
        </div>
      )}

      {/* ── Complaints progress: trend + status donut (replaces the old static pipeline bar) ── */}
      {c && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "18px 20px", minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>Complaints — Last 14 Days</span>
              <span style={{ fontSize: 11.5, color: "#94A3B8" }}>{c.trend.reduce((s, d) => s + d.count, 0)} raised</span>
            </div>
            <TrendArea data={c.trend} color="#6366F1" />
          </div>
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", padding: "18px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <Donut segments={[
              { label: "Open", value: c.open, color: "#EF4444" },
              { label: "In Progress", value: c.inprog, color: "#F59E0B" },
              { label: "Closed", value: c.closed, color: "#10B981" },
            ]} />
            <div style={{ display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap", justifyContent: "center" }}>
              {[["Open", c.open, "#EF4444"], ["In Progress", c.inprog, "#F59E0B"], ["Closed", c.closed, "#10B981"]].map(([l, n, col]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, color: "#475569" }}>
                  <div style={{ width: 7, height: 7, borderRadius: 99, background: col }} />{l}: <b style={{ color: "#0F172A" }}>{n}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Complaint category cards ── */}
      {c && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
          {CATEGORIES.map(cat => {
            const row = c.byCat.find(b => b.category === cat);
            return (
              <div key={cat} onClick={() => goto(cat.toLowerCase())}
                style={{ background: "white", borderRadius: 12, padding: "18px 20px", border: `1px solid ${CAT_COLOR[cat]}30`, cursor: "pointer", transition: "all .15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = CAT_COLOR[cat]; e.currentTarget.style.boxShadow = `0 4px 20px ${CAT_COLOR[cat]}25`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${CAT_COLOR[cat]}30`; e.currentTarget.style.boxShadow = ""; }}>
                <div style={{ fontSize: 11, color: CAT_COLOR[cat], fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>{cat}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>{row?.total ?? 0}</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>{row?.active ?? 0} active · {row?.closed_count ?? 0} closed</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Every other module the user has access to ── */}
      {(t || fs || ft || kb || lp || pr) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
          {t && (
            <ModuleCard title="Tasks" icon={<Icons.Tasks />} color="#F59E0B" onClick={() => goto("tasks")}
              stats={[
                { label: "Pending", value: t.pending },
                { label: "In Progress", value: t.inProgress },
                { label: "Overdue", value: t.overdue, color: t.overdue > 0 ? "#EF4444" : undefined },
              ]}
              footer={`${t.completed} completed so far`} />
          )}
          {fs && (
            <ModuleCard title="File Sharing" icon={<Icons.Share />} color="#8B5CF6" onClick={() => goto("file-sharing")}
              stats={[
                { label: "Sent", value: fs.sent },
                { label: "Received", value: fs.received },
                { label: "Unread", value: fs.unread, color: fs.unread > 0 ? "#8B5CF6" : undefined },
              ]} />
          )}
          {ft && (
            <ModuleCard title="File Tracking" icon={<Icons.File />} color="#0E7490" onClick={() => goto("file-tracking")}
              stats={[
                { label: "Pending", value: ft.pending },
                { label: "In Progress", value: ft.inProgress },
                { label: "Overdue", value: ft.overdue, color: ft.overdue > 0 ? "#EF4444" : undefined },
              ]}
              footer={`${ft.completed} completed · ${ft.total} total files`} />
          )}
          {kb && (
            <ModuleCard title="Knowledge References" icon={<Icons.Book />} color="#2563EB" onClick={() => goto("knowledge")}
              stats={[{ label: "Documents", value: kb.total }]}
              footer={kb.recent.length ? `Latest: ${kb.recent[0].title}` : "No documents yet"} />
          )}
          {lp && (
            <ModuleCard title="Lunch Pass" icon={<Icons.Utensils />} color="#059669" onClick={() => goto("lunchpass")}
              stats={[
                { label: "Active", value: lp.active },
                { label: "Expiring Soon", value: lp.expiringSoon, color: lp.expiringSoon > 0 ? "#F59E0B" : undefined },
                { label: "Expired", value: lp.expired },
              ]} />
          )}
          {pr && (
            <ModuleCard title="Print Register" icon={<Icons.Print />} color="#475569" onClick={() => goto("print")}
              stats={[]} footer="Generate printable complaint reports and registers." />
          )}
        </div>
      )}

      {summaryLoading && !summary && (
        <div style={{ textAlign: "center", padding: 30, color: "#94A3B8", fontSize: 13 }}>Loading dashboard…</div>
      )}

      {/* ── Recent complaints ── */}
      {c && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", fontWeight: 700, color: "#0F172A", fontSize: 14 }}>
            Recent Complaints {isAdmin ? "" : "(My Complaints)"}
          </div>
          <ComplaintsTable complaints={complaints.slice(0, 8)} onSelect={onSelectComplaint} loading={loading} />
        </div>
      )}
    </>
  );
}
