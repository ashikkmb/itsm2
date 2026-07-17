const { wrap } = require("./sqlite-wrapper");
const bcrypt = require("bcryptjs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/helpdesk.db");

async function initDB() {
  const db = wrap(DB_PATH);

  await db.pragma("journal_mode = WAL");
  await db.pragma("foreign_keys = ON");

  // ── Create Tables ──────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL UNIQUE,
      password    TEXT,
      auth_source TEXT    NOT NULL DEFAULT 'local' CHECK(auth_source IN ('local','ad')),
      ad_username TEXT,
      role        TEXT    NOT NULL DEFAULT 'user',
      department  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_no   TEXT    NOT NULL UNIQUE,
      user_id     INTEGER,
      raised_by_name TEXT DEFAULT '',
      raised_by_dept TEXT DEFAULT '',
      complainant_name TEXT DEFAULT '',
      attachment_path TEXT DEFAULT '',
      category    TEXT    NOT NULL CHECK(category IN ('Hardware','Software','INAMS')),
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL,
      priority    TEXT    NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High','Critical')),
      status      TEXT    NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In Progress','Closed')),
      remarks     TEXT    DEFAULT '',
      closed_by   INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL,
      user_id      INTEGER,
      actor_name   TEXT DEFAULT '',
      action       TEXT    NOT NULL,
      detail       TEXT    DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      description  TEXT    DEFAULT '',
      file_path    TEXT    NOT NULL,
      file_name    TEXT    NOT NULL,
      file_type    TEXT    NOT NULL,
      file_size    INTEGER NOT NULL DEFAULT 0,
      uploaded_by  INTEGER,
      uploaded_by_name TEXT DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- IT staff directory: just named records for task assignment, deliberately
    -- separate from the users/login table. Staff being assigned work doesn't
    -- require them to have an account in this system.
    CREATE TABLE IF NOT EXISTS it_staff (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      department  TEXT    DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- assigned_to is polymorphic: when assignee_type = 'user' it points at
    -- users(id) (a local or AD login account, including self-assigned
    -- personal tasks); when assignee_type = 'staff' it points at
    -- it_staff(id) (a named IT staff member with no login). No single FK
    -- can target two different tables, so assigned_to is left unconstrained
    -- and assigned_to_name carries a permanent display snapshot either way.
    CREATE TABLE IF NOT EXISTS tasks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      title             TEXT    NOT NULL,
      description       TEXT    DEFAULT '',
      assignee_type     TEXT    NOT NULL DEFAULT 'staff' CHECK(assignee_type IN ('user','staff')),
      assigned_to       INTEGER,
      assigned_to_name  TEXT    DEFAULT '',
      assigned_by       INTEGER,
      assigned_by_name  TEXT    DEFAULT '',
      priority          TEXT    NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High','Critical')),
      status            TEXT    NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Completed')),
      due_date          TEXT    NOT NULL,
      completed_at      TEXT,
      attachment_path   TEXT,
      attachment_name   TEXT,
      attachment_size   INTEGER,
      attachment_type   TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id           INTEGER NOT NULL,
      author_id         INTEGER,
      author_name       TEXT    DEFAULT '',
      comment           TEXT    DEFAULT '',
      attachment_path   TEXT,
      attachment_name   TEXT,
      attachment_size   INTEGER,
      attachment_type   TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- File Sharing Portal: a file is visible only to its sender and its
    -- recipient (never other users, never listed for admins specially).
    -- file_path stores just the on-disk filename — these files are NOT
    -- served statically like task attachments; every download goes through
    -- an authenticated route that checks the requester is the sender or
    -- recipient, since this is private person-to-person data.
    CREATE TABLE IF NOT EXISTS shared_files (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id      INTEGER,
      sender_name    TEXT    DEFAULT '',
      recipient_id   INTEGER,
      recipient_name TEXT    DEFAULT '',
      file_name      TEXT    NOT NULL,
      file_path      TEXT    NOT NULL,
      file_size      INTEGER,
      file_type      TEXT,
      message        TEXT    DEFAULT '',
      downloaded_at  TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT    NOT NULL,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- ── Task & File Tracking System ─────────────────────────────────────────
    -- A separate, government-eOffice-style file movement tracker. Deliberately
    -- independent of the existing tasks/task_comments tables (different
    -- purpose: this tracks a FILE moving between office roles/sections with a
    -- permanent movement history, not a personal to-do/assignment).

    -- Editable status list (admin-manageable in a later phase); seeded below.
    CREATE TABLE IF NOT EXISTS file_tracking_statuses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1
    );

    -- The file/task itself. current_holder/status/due_date are a live
    -- snapshot of the latest movement — the permanent history of how it got
    -- there lives in file_tracking_updates and is never deleted.
    CREATE TABLE IF NOT EXISTS file_tracking_tasks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      file_no          TEXT    NOT NULL,
      reference_no     TEXT    DEFAULT '',
      subject          TEXT    NOT NULL,
      description      TEXT    DEFAULT '',
      department       TEXT    DEFAULT '',
      priority         TEXT    NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')),
      status           TEXT    NOT NULL DEFAULT 'Pending',
      current_holder   TEXT    NOT NULL DEFAULT '',
      created_by       INTEGER,
      created_by_name  TEXT    DEFAULT '',
      created_date     TEXT    NOT NULL DEFAULT (datetime('now')),
      due_date         TEXT,
      last_updated     TEXT    NOT NULL DEFAULT (datetime('now')),
      -- File records are private per creator, so the file number only needs
      -- to be unique within one person's own files, not office-wide.
      UNIQUE(created_by, file_no),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Permanent movement/status history — one row per "Save Update" action,
    -- plus one auto-created "created" row when the file is first registered.
    -- Nothing here is ever deleted or edited, by design.
    CREATE TABLE IF NOT EXISTS file_tracking_updates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id          INTEGER NOT NULL,
      entry_type       TEXT    NOT NULL DEFAULT 'update' CHECK(entry_type IN ('created','update','imported')),
      remarks          TEXT    DEFAULT '',
      previous_holder  TEXT    DEFAULT '',
      current_holder   TEXT    NOT NULL,
      previous_status  TEXT    DEFAULT '',
      status           TEXT    NOT NULL,
      due_date         TEXT,
      updated_by       INTEGER,
      updated_by_name  TEXT    DEFAULT '',
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES file_tracking_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Attachments belong to a specific movement entry (so the timeline shows
    -- exactly which update a document was attached to), but also carry
    -- task_id directly for simpler "all attachments for this file" queries.
    CREATE TABLE IF NOT EXISTS file_tracking_attachments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id          INTEGER NOT NULL,
      update_id        INTEGER,
      original_name    TEXT    NOT NULL,
      stored_name      TEXT    NOT NULL,
      file_size        INTEGER,
      file_type        TEXT,
      uploaded_by      INTEGER,
      uploaded_by_name TEXT    DEFAULT '',
      uploaded_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES file_tracking_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (update_id) REFERENCES file_tracking_updates(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Pinning is personal — each user has their own up-to-3 pinned files,
    -- independent of everyone else's, hence a join table rather than a flag
    -- on the task itself.
    CREATE TABLE IF NOT EXISTS file_tracking_pins (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      task_id    INTEGER NOT NULL,
      pinned_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES file_tracking_tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lunch_passes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      pass_no      TEXT    DEFAULT NULL,
      name         TEXT    NOT NULL,
      id_no        TEXT    DEFAULT '',
      designation  TEXT    DEFAULT '',
      mobile       TEXT    DEFAULT '',
      section      TEXT    DEFAULT '',
      gate         TEXT    NOT NULL CHECK(gate IN ('West Gate','East Gate')),
      photo_path   TEXT    DEFAULT '',
      valid_from   TEXT    NOT NULL,
      valid_to     TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Expired','Deactivated')),
      created_by   INTEGER,
      created_by_name TEXT DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Simple key/value store for site-wide settings. Currently holds
    -- 'default_modules' (JSON array of module keys granted to newly created
    -- non-admin users); more settings can land here later without a schema
    -- change.
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Per-user module access grants (Settings -> Role Management). Admins
    -- bypass this entirely and always have full access; this table only
    -- governs non-admin accounts. Absence of a row = no access.
    CREATE TABLE IF NOT EXISTS user_modules (
      user_id     INTEGER NOT NULL,
      module_key  TEXT    NOT NULL,
      granted_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, module_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Software Repository: admin-only storage for installers, drivers, and
    -- other tools IT hands out. Any file type is allowed (unlike Knowledge
    -- References, which is document-only), so it's kept as its own table
    -- and its own upload directory rather than folded into knowledge_docs.
    CREATE TABLE IF NOT EXISTS software_repo (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      title            TEXT    NOT NULL,
      description      TEXT    DEFAULT '',
      file_name        TEXT    NOT NULL,
      file_path        TEXT    NOT NULL,
      file_type        TEXT    NOT NULL,
      file_size        INTEGER NOT NULL DEFAULT 0,
      uploaded_by      INTEGER,
      uploaded_by_name TEXT    DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // ── Migration: add complainant_name column if upgrading from older schema ──
  const cols = await db.all("PRAGMA table_info(complaints)");
  const hasComplainantName = cols.some(c => c.name === "complainant_name");
  if (!hasComplainantName) {
    await db.exec("ALTER TABLE complaints ADD COLUMN complainant_name TEXT DEFAULT ''");
    console.log("Migration: added complainant_name column to complaints table.");
  }
  if (!cols.some(c => c.name === "raised_by_name")) {
    await db.exec("ALTER TABLE complaints ADD COLUMN raised_by_name TEXT DEFAULT ''");
    console.log("Migration: added raised_by_name column to complaints table.");
  }
  if (!cols.some(c => c.name === "raised_by_dept")) {
    await db.exec("ALTER TABLE complaints ADD COLUMN raised_by_dept TEXT DEFAULT ''");
    console.log("Migration: added raised_by_dept column to complaints table.");
  }
  if (!cols.some(c => c.name === "attachment_path")) {
    await db.exec("ALTER TABLE complaints ADD COLUMN attachment_path TEXT DEFAULT ''");
    console.log("Migration: added attachment_path column to complaints table.");
  }

  // Backfill raised_by_name/dept for any existing complaints that don't have it yet,
  // using the current linked user's info (covers complaints created before this migration)
  await db.exec(`
    UPDATE complaints
    SET raised_by_name = (SELECT name FROM users WHERE users.id = complaints.user_id),
        raised_by_dept  = (SELECT department FROM users WHERE users.id = complaints.user_id)
    WHERE (raised_by_name = '' OR raised_by_name IS NULL) AND user_id IS NOT NULL
  `);

  // ── Migration: add actor_name to activity_log ───────────────────────────────
  const logCols = await db.all("PRAGMA table_info(activity_log)");
  if (!logCols.some(c => c.name === "actor_name")) {
    await db.exec("ALTER TABLE activity_log ADD COLUMN actor_name TEXT DEFAULT ''");
    await db.exec(`
      UPDATE activity_log
      SET actor_name = (SELECT name FROM users WHERE users.id = activity_log.user_id)
      WHERE (actor_name = '' OR actor_name IS NULL) AND user_id IS NOT NULL
    `);
    console.log("Migration: added actor_name column to activity_log table.");
  }

  // ── Migration: add AD support columns to users table ────────────────────────
  const userCols = await db.all("PRAGMA table_info(users)");
  if (!userCols.some(c => c.name === "auth_source")) {
    await db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'");
    console.log("Migration: added auth_source column to users table.");
  }
  if (!userCols.some(c => c.name === "ad_username")) {
    await db.exec("ALTER TABLE users ADD COLUMN ad_username TEXT");
    console.log("Migration: added ad_username column to users table.");
  }

  // ── Migration: add photo repositioning columns to lunch_passes ─────────────
  // Stores the drag-to-align offset (as % object-position coordinates) so the
  // uploaded photo can be cropped/aligned to fit the fixed photo box on the
  // printed pass, independent of the print/table thumbnail rendering.
  const lunchPassCols = await db.all("PRAGMA table_info(lunch_passes)");
  if (!lunchPassCols.some(c => c.name === "photo_position_x")) {
    await db.exec("ALTER TABLE lunch_passes ADD COLUMN photo_position_x REAL NOT NULL DEFAULT 50");
    console.log("Migration: added photo_position_x column to lunch_passes table.");
  }
  if (!lunchPassCols.some(c => c.name === "photo_position_y")) {
    await db.exec("ALTER TABLE lunch_passes ADD COLUMN photo_position_y REAL NOT NULL DEFAULT 50");
    console.log("Migration: added photo_position_y column to lunch_passes table.");
  }

  // ── Migration: relax pass_no on lunch_passes (now hand-written after printing,
  // no longer entered/auto-generated in the app) — rebuilds the table since
  // SQLite can't drop a NOT NULL/UNIQUE constraint with a plain ALTER TABLE.
  const lunchPassTableDef = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='lunch_passes'");
  if (lunchPassTableDef && /pass_no\s+TEXT\s+NOT NULL UNIQUE/i.test(lunchPassTableDef.sql)) {
    await db.exec(`
      CREATE TABLE lunch_passes_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pass_no      TEXT    DEFAULT NULL,
        name         TEXT    NOT NULL,
        id_no        TEXT    DEFAULT '',
        designation  TEXT    DEFAULT '',
        mobile       TEXT    DEFAULT '',
        section      TEXT    DEFAULT '',
        gate         TEXT    NOT NULL CHECK(gate IN ('West Gate','East Gate')),
        photo_path   TEXT    DEFAULT '',
        photo_position_x REAL NOT NULL DEFAULT 50,
        photo_position_y REAL NOT NULL DEFAULT 50,
        valid_from   TEXT    NOT NULL,
        valid_to     TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Expired','Deactivated')),
        created_by   INTEGER,
        created_by_name TEXT DEFAULT '',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO lunch_passes_new (id, pass_no, name, id_no, designation, mobile, section, gate, photo_path, photo_position_x, photo_position_y, valid_from, valid_to, status, created_by, created_by_name, created_at, updated_at)
      SELECT id, pass_no, name, id_no, designation, mobile, section, gate, photo_path, photo_position_x, photo_position_y, valid_from, valid_to, status, created_by, created_by_name, created_at, updated_at
      FROM lunch_passes;
      DROP TABLE lunch_passes;
      ALTER TABLE lunch_passes_new RENAME TO lunch_passes;
    `);
    console.log("Migration: relaxed pass_no constraint on lunch_passes (now optional, hand-written after printing).");
  }

  // ── Migration: rename 'Main Gate' to 'East Gate' on lunch_passes (gate was
  // mislabeled — the two actual gates are West Gate and East Gate). Rebuilds
  // the table since SQLite can't alter a CHECK constraint in place, and
  // converts any existing rows saved with the old 'Main Gate' value.
  const lunchPassTableDef2 = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='lunch_passes'");
  if (lunchPassTableDef2 && /Main Gate/i.test(lunchPassTableDef2.sql)) {
    await db.exec(`
      CREATE TABLE lunch_passes_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pass_no      TEXT    DEFAULT NULL,
        name         TEXT    NOT NULL,
        id_no        TEXT    DEFAULT '',
        designation  TEXT    DEFAULT '',
        mobile       TEXT    DEFAULT '',
        section      TEXT    DEFAULT '',
        gate         TEXT    NOT NULL CHECK(gate IN ('West Gate','East Gate')),
        photo_path   TEXT    DEFAULT '',
        photo_position_x REAL NOT NULL DEFAULT 50,
        photo_position_y REAL NOT NULL DEFAULT 50,
        valid_from   TEXT    NOT NULL,
        valid_to     TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Expired','Deactivated')),
        created_by   INTEGER,
        created_by_name TEXT DEFAULT '',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO lunch_passes_new (id, pass_no, name, id_no, designation, mobile, section, gate, photo_path, photo_position_x, photo_position_y, valid_from, valid_to, status, created_by, created_by_name, created_at, updated_at)
      SELECT id, pass_no, name, id_no, designation, mobile, section,
             CASE WHEN gate = 'Main Gate' THEN 'East Gate' ELSE gate END,
             photo_path, photo_position_x, photo_position_y, valid_from, valid_to, status, created_by, created_by_name, created_at, updated_at
      FROM lunch_passes;
      DROP TABLE lunch_passes;
      ALTER TABLE lunch_passes_new RENAME TO lunch_passes;
    `);
    console.log("Migration: renamed 'Main Gate' to 'East Gate' on lunch_passes (including any existing rows).");
  }

  // ── Migration: repoint tasks.assigned_to from users(id) to it_staff(id) ────
  // Earlier version of the Tasks feature assigned work directly to login
  // accounts. IT staff being assigned tasks don't need — and often don't
  // have — accounts in this system, so assignment now points at the
  // separate it_staff directory instead. Rebuilds the table (SQLite can't
  // alter a FOREIGN KEY target in place) and backfills it_staff from any
  // names already recorded on existing tasks, so old assignments survive.
  const tasksExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'");
  if (tasksExists) {
    const taskFks = await db.all("PRAGMA foreign_key_list(tasks)");
    const staleFK = taskFks.some(fk => fk.from === "assigned_to" && fk.table === "users");
    if (staleFK) {
    const existingNames = await db.all("SELECT DISTINCT assigned_to_name AS name FROM tasks WHERE assigned_to_name IS NOT NULL AND assigned_to_name != ''");
    for (const { name } of existingNames) {
      await db.run("INSERT OR IGNORE INTO it_staff (name) VALUES (?)", [name]);
    }
    await db.exec(`
      CREATE TABLE tasks_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        title             TEXT    NOT NULL,
        description       TEXT    DEFAULT '',
        assigned_to       INTEGER,
        assigned_to_name  TEXT    DEFAULT '',
        assigned_by       INTEGER,
        assigned_by_name  TEXT    DEFAULT '',
        priority          TEXT    NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High','Critical')),
        status            TEXT    NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Completed')),
        due_date          TEXT    NOT NULL,
        completed_at      TEXT,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (assigned_to) REFERENCES it_staff(id) ON DELETE SET NULL,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO tasks_new (id, title, description, assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, status, due_date, completed_at, created_at, updated_at)
      SELECT t.id, t.title, t.description,
             s.id, t.assigned_to_name,
             t.assigned_by, t.assigned_by_name,
             t.priority, t.status, t.due_date, t.completed_at, t.created_at, t.updated_at
      FROM tasks t
      LEFT JOIN it_staff s ON s.name = t.assigned_to_name;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
    `);
      console.log("Migration: repointed tasks.assigned_to from users(id) to it_staff(id).");
    }
  }

  // ── Migration: make tasks.assigned_to polymorphic (user account OR IT
  // staff name), adding assignee_type. Any task that predates this feature
  // was staff-only, so every existing row is tagged assignee_type = 'staff'.
  const taskCols2 = await db.all("PRAGMA table_info(tasks)");
  if (taskCols2.length && !taskCols2.some(c => c.name === "assignee_type")) {
    await db.exec(`
      CREATE TABLE tasks_new2 (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        title             TEXT    NOT NULL,
        description       TEXT    DEFAULT '',
        assignee_type     TEXT    NOT NULL DEFAULT 'staff' CHECK(assignee_type IN ('user','staff')),
        assigned_to       INTEGER,
        assigned_to_name  TEXT    DEFAULT '',
        assigned_by       INTEGER,
        assigned_by_name  TEXT    DEFAULT '',
        priority          TEXT    NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High','Critical')),
        status            TEXT    NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Completed')),
        due_date          TEXT    NOT NULL,
        completed_at      TEXT,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO tasks_new2 (id, title, description, assignee_type, assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, status, due_date, completed_at, created_at, updated_at)
      SELECT id, title, description, 'staff', assigned_to, assigned_to_name, assigned_by, assigned_by_name, priority, status, due_date, completed_at, created_at, updated_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new2 RENAME TO tasks;
    `);
    console.log("Migration: added assignee_type to tasks (assigned_to can now be a user account or an IT staff name).");
  }

  // ── Migration: optional file attachments on tasks (at creation) and on
  // each task comment. Plain ADD COLUMN is safe here — all new columns are
  // nullable, so no table rebuild is needed.
  const taskCols3 = await db.all("PRAGMA table_info(tasks)");
  if (taskCols3.length && !taskCols3.some(c => c.name === "attachment_path")) {
    await db.exec(`
      ALTER TABLE tasks ADD COLUMN attachment_path TEXT;
      ALTER TABLE tasks ADD COLUMN attachment_name TEXT;
      ALTER TABLE tasks ADD COLUMN attachment_size INTEGER;
      ALTER TABLE tasks ADD COLUMN attachment_type TEXT;
    `);
    console.log("Migration: added optional attachment columns to tasks.");
  }
  const commentCols = await db.all("PRAGMA table_info(task_comments)");
  if (commentCols.length && !commentCols.some(c => c.name === "attachment_path")) {
    await db.exec(`
      ALTER TABLE task_comments ADD COLUMN attachment_path TEXT;
      ALTER TABLE task_comments ADD COLUMN attachment_name TEXT;
      ALTER TABLE task_comments ADD COLUMN attachment_size INTEGER;
      ALTER TABLE task_comments ADD COLUMN attachment_type TEXT;
    `);
    console.log("Migration: added optional attachment columns to task_comments.");
  }

  // ── Migration: WOPI (Open in Word) support — a version counter plus a
  // permanent "last edited by/at" snapshot on the attachment itself (same
  // snapshot pattern as assigned_to_name/assigned_by_name above), and a
  // small table tracking the one active edit-lock per attachment while
  // someone has it open in Word.
  const taskCols4 = await db.all("PRAGMA table_info(tasks)");
  if (taskCols4.length && !taskCols4.some(c => c.name === "attachment_version")) {
    await db.exec(`
      ALTER TABLE tasks ADD COLUMN attachment_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tasks ADD COLUMN attachment_edited_by INTEGER;
      ALTER TABLE tasks ADD COLUMN attachment_edited_by_name TEXT;
      ALTER TABLE tasks ADD COLUMN attachment_edited_at TEXT;
    `);
    console.log("Migration: added WOPI edit-tracking columns to tasks.");
  }
  const commentCols2 = await db.all("PRAGMA table_info(task_comments)");
  if (commentCols2.length && !commentCols2.some(c => c.name === "attachment_version")) {
    await db.exec(`
      ALTER TABLE task_comments ADD COLUMN attachment_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE task_comments ADD COLUMN attachment_edited_by INTEGER;
      ALTER TABLE task_comments ADD COLUMN attachment_edited_by_name TEXT;
      ALTER TABLE task_comments ADD COLUMN attachment_edited_at TEXT;
    `);
    console.log("Migration: added WOPI edit-tracking columns to task_comments.");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS wopi_locks (
      file_id     TEXT    PRIMARY KEY,
      lock_id     TEXT    NOT NULL,
      locked_by   INTEGER,
      expires_at  TEXT    NOT NULL
    );
  `);

  // ── Migration: file_no uniqueness moves from office-wide to per-creator ────
  // (File Tracking is now private per user, so two different people
  // reasonably might pick the same file number without ever seeing each
  // other's records.) Loosening a UNIQUE constraint can never conflict with
  // existing data, so this is always safe to run.
  const ftTableDef = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='file_tracking_tasks'");
  if (ftTableDef && !/UNIQUE\s*\(\s*created_by\s*,\s*file_no\s*\)/i.test(ftTableDef.sql)) {
    await db.exec(`
      CREATE TABLE file_tracking_tasks_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        file_no          TEXT    NOT NULL,
        reference_no     TEXT    DEFAULT '',
        subject          TEXT    NOT NULL,
        description      TEXT    DEFAULT '',
        department       TEXT    DEFAULT '',
        priority         TEXT    NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')),
        status           TEXT    NOT NULL DEFAULT 'Pending',
        current_holder   TEXT    NOT NULL DEFAULT '',
        created_by       INTEGER,
        created_by_name  TEXT    DEFAULT '',
        created_date     TEXT    NOT NULL DEFAULT (datetime('now')),
        due_date         TEXT,
        last_updated     TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(created_by, file_no),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO file_tracking_tasks_new SELECT * FROM file_tracking_tasks;
      DROP TABLE file_tracking_tasks;
      ALTER TABLE file_tracking_tasks_new RENAME TO file_tracking_tasks;
    `);
    console.log("Migration: file_tracking_tasks.file_no uniqueness is now scoped per creator instead of office-wide.");
  }

  // ── Seed default File Tracking statuses if table is empty ─────────────────
  const statusCount = await db.get("SELECT COUNT(*) as cnt FROM file_tracking_statuses");
  if (statusCount.cnt === 0) {
    const defaultStatuses = [
      "Pending", "In Progress", "Awaiting Approval", "Awaiting Procurement",
      "On Hold", "Completed", "Closed", "Cancelled",
    ];
    for (let i = 0; i < defaultStatuses.length; i++) {
      await db.run("INSERT INTO file_tracking_statuses (name, sort_order) VALUES (?, ?)", [defaultStatuses[i], i]);
    }
  }

  // ── Seed default_modules setting (Settings -> Role Management) ────────────
  const DEFAULT_NEW_USER_MODULES = ["complaints", "tasks", "file-sharing", "file-tracking"];
  const defaultModulesRow = await db.get("SELECT value FROM app_settings WHERE key = 'default_modules'");
  if (!defaultModulesRow) {
    await db.run(
      "INSERT INTO app_settings (key, value) VALUES ('default_modules', ?)",
      [JSON.stringify(DEFAULT_NEW_USER_MODULES)]
    );
    console.log("Seeded default_modules setting.");
  }

  // ── Seed default users if table is empty ──────────────────────────────────
  const userCount = await db.get("SELECT COUNT(*) as cnt FROM users");
  if (userCount.cnt === 0) {
    const seed = [
      ["IT Admin",       "itadmin",  "admin123",  "admin", "IT"],
      ["Alice Johnson",  "alice@org.local",  "pass123",   "user",  "Finance"],
      ["Bob Smith",      "bob@org.local",    "pass123",   "user",  "HR"],
      ["Carol White",    "carol@org.local",  "pass123",   "user",  "Operations"],
      ["David Kumar",    "david@org.local",  "pass123",   "user",  "Procurement"],
    ];

    for (const [name, email, plain, role, dept] of seed) {
      const hashed = bcrypt.hashSync(plain, 10);
      await db.run(
        "INSERT INTO users (name, email, password, role, department) VALUES (?, ?, ?, ?, ?)",
        [name, email, hashed, role, dept]
      );
    }

    const comps = [
      ["TKT-0001", 2, "Hardware", "Monitor flickering",
        "The monitor on my desk flickers every few minutes, making it difficult to work.", "High", "Open", ""],
      ["TKT-0002", 3, "Software", "MS Office activation error",
        "Getting activation error 0x80070005 when launching Word.", "Medium", "In Progress", ""],
      ["TKT-0003", 4, "INAMS", "Cannot access INAMS portal",
        "Login page throws 403 Forbidden. Worked fine last week.", "High", "Closed",
        "User credentials were expired. Reset done and access restored."],
      ["TKT-0004", 2, "Software", "VPN disconnecting frequently",
        "VPN drops every 15-20 minutes requiring manual reconnect.", "High", "Open", ""],
      ["TKT-0005", 3, "Hardware", "Keyboard keys sticking",
        "Several keys on keyboard are sticking, particularly spacebar and Enter.", "Low", "In Progress", ""],
    ];

    const userMap = { 2: ["Alice Johnson", "Finance"], 3: ["Bob Smith", "HR"], 4: ["Carol White", "Operations"] };
    for (const c of comps) {
      const [, uid] = c;
      const [rname, rdept] = userMap[uid] || ["", ""];
      await db.run(
        `INSERT INTO complaints (ticket_no, user_id, raised_by_name, raised_by_dept, category, title, description, priority, status, remarks, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [c[0], c[1], rname, rdept, c[2], c[3], c[4], c[5], c[6], c[7]]
      );
    }

    console.log("Database seeded with default users and sample complaints.");
  }

  // Backfill: any non-admin user with zero module grants yet (freshly seeded
  // demo users, or accounts that existed before this feature) gets the
  // default module set, matching the access they effectively already had.
  // Users an admin has already customized are left alone — this only fires
  // for accounts with no rows at all yet.
  const usersNeedingBackfill = await db.all(`
    SELECT u.id FROM users u
    WHERE u.role != 'admin'
      AND NOT EXISTS (SELECT 1 FROM user_modules m WHERE m.user_id = u.id)
  `);
  if (usersNeedingBackfill.length) {
    for (const u of usersNeedingBackfill) {
      for (const key of DEFAULT_NEW_USER_MODULES) {
        await db.run("INSERT OR IGNORE INTO user_modules (user_id, module_key) VALUES (?, ?)", [u.id, key]);
      }
    }
    console.log(`Migration: ensured default module access for ${usersNeedingBackfill.length} user(s).`);
  }

  return db;
}

module.exports = { initDB, DB_PATH };
