require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const { initDB } = require("./db");
const sse = require("./sse");
const { authenticate, adminOnly } = require("./auth");

// ── Ensure data directory exists ─────────────────────────────────────────────
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Ensure uploads directory exists (for complaint screenshot attachments) ──
const uploadsDir = path.join(__dirname, "../data/uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Ensure knowledge-docs directory exists (for reference documents) ────────
const knowledgeDocsDir = path.join(__dirname, "../data/knowledge-docs");
if (!fs.existsSync(knowledgeDocsDir)) fs.mkdirSync(knowledgeDocsDir, { recursive: true });

// ── Ensure lunch-pass-photos directory exists ────────────────────────────────
const lunchPassPhotosDir = path.join(__dirname, "../data/lunch-pass-photos");
if (!fs.existsSync(lunchPassPhotosDir)) fs.mkdirSync(lunchPassPhotosDir, { recursive: true });

// ── Ensure task-files directory exists (optional attachments on tasks/comments) ──
const taskFilesDir = path.join(__dirname, "../data/task-files");
if (!fs.existsSync(taskFilesDir)) fs.mkdirSync(taskFilesDir, { recursive: true });

// ── Express app ───────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// Serve uploaded attachment images so the frontend can display them
app.use("/uploads", express.static(uploadsDir));

// Serve knowledge reference documents for in-browser viewing/download
app.use("/knowledge-files", express.static(knowledgeDocsDir));

// Serve lunch pass photos
app.use("/lunch-pass-photos", express.static(lunchPassPhotosDir));

// Serve task/comment attachments (images, PDFs, Office docs) for download
app.use("/task-files", express.static(taskFilesDir));

const clientBuild = path.join(__dirname, "../client/dist");

async function start() {
  const db = await initDB();
  require("./auth").setDb(db);

  app.use("/api/auth",       require("./routes/auth")(db));
  app.use("/api/complaints", require("./routes/complaints")(db));
  app.use("/api/users",      require("./routes/users")(db));
  app.use("/api/knowledge",  require("./routes/knowledge")(db));
  app.use("/api/lunch-passes", require("./routes/lunchpass")(db));
  app.use("/api/tasks",      require("./routes/tasks")(db));
  app.use("/api/wopi",       require("./routes/wopi")(db));
  app.use("/api/staff",      require("./routes/staff")(db));
  const fileSharing = require("./routes/filesharing");
  app.use("/api/file-sharing", fileSharing(db));
  fileSharing.startCleanupJob(db);
  app.use("/api/file-tracking", require("./routes/filetracking")(db));
  app.use("/api/dashboard",  require("./routes/dashboard")(db));
  app.use("/api/software-repo", require("./routes/softwarerepo")(db));
  app.use("/api/settings",   require("./routes/settings")(db));

  app.get("/api/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  // ── Live notification stream (Server-Sent Events) ──────────────────────────
  // Any logged-in browser tab opens a long-lived connection here. Whenever a
  // new complaint is created, the complaints route calls sse.broadcast(...)
  // and every connected admin tab receives it. Whenever a task is assigned
  // or commented on, the tasks route broadcasts too — the client filters
  // out events that aren't relevant to it (e.g. a regular user ignores
  // "new-complaint", and only reacts to "new-task"/"task-comment" that
  // concern their own tasks).
  app.get("/api/events", authenticate, (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    // Send an initial comment to establish the stream immediately
    res.write(": connected\n\n");

    sse.addClient(res);

    // Keep the connection alive through proxies/idle timeouts with a periodic ping
    const keepAlive = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* connection likely closed */ }
    }, 25000);

    // Force a clean close every 4 minutes so no single connection sits open
    // through IIS for hours. EventSource reconnects automatically on close.
    const maxAge = setTimeout(() => {
      clearInterval(keepAlive);
      sse.removeClient(res);
      try { res.end(); } catch { /* already closed */ }
    }, 4 * 60 * 1000);

    req.on("close", () => {
      clearInterval(keepAlive);
      clearTimeout(maxAge);
      sse.removeClient(res);
    });
  });

  if (fs.existsSync(clientBuild)) {
    app.use(express.static(clientBuild));
    app.get("*", (_req, res) => res.sendFile(path.join(clientBuild, "index.html")));
  } else {
    app.get("/", (_req, res) => res.json({ message: "API running. Build the React client to serve the UI." }));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log("\n========================================");
    console.log(`  ITSM - NAD(A)  ->  http://localhost:${PORT}`);
    console.log("========================================");
    if (process.env.AD_URL) {
      console.log("  Active Directory login: ENABLED");
      console.log(`  AD Server: ${process.env.AD_URL}`);
      console.log(`  AD Domain: ${process.env.AD_DOMAIN}`);
    } else {
      console.log("  Active Directory login: NOT CONFIGURED");
      console.log("  (copy .env.example to .env and fill in your DC details)");
    }
    console.log("========================================\n");
  });
}

start().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
