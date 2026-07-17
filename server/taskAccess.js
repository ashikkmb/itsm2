// ── Shared task-visibility rules ─────────────────────────────────────────────
// Pulled out of routes/tasks.js so the WOPI file-editing routes (routes/wopi.js)
// can enforce the exact same "who can see/act on this task" logic instead of
// duplicating it. Behavior is unchanged from what previously lived inline in
// routes/tasks.js.

// A non-admin can only see/act on tasks assigned to their own user account
// (whether they created it themselves or an admin assigned it to them).
// IT-staff-type tasks and other people's tasks are invisible to them.
function ownsTask(task, user) {
  return task.assignee_type === "user" && task.assigned_to === user.id;
}
function createdTask(task, user) {
  return task.assigned_by === user.id;
}

// A "private" task is a personal to-do a user created for themselves —
// assignee_type 'user' where the creator and the assignee are the same
// person. Nobody else, not even an admin, can see or touch it. A task an
// admin genuinely assigned to a user (assigned_by is the admin, not the
// user themselves) is NOT private — it stays visible to that user and to
// every admin, same as before.
function isPrivateTask(task) {
  return task.assignee_type === "user" && task.assigned_to === task.assigned_by;
}

// Single source of truth for "can this person see/act on this task at all".
// For WOPI, this same result also gates edit access (UserCanWrite) — the two
// parties on a task (whoever created it, whoever it's assigned to) can both
// view AND edit a Word attachment; there's no separate "view only" tier.
function canAccessTask(task, user) {
  if (ownsTask(task, user) || createdTask(task, user)) return true;
  if (user.role !== "admin") return false;
  return !isPrivateTask(task);
}

// assigned_to is polymorphic (a users.id or an it_staff.id depending on
// assignee_type), so it's resolved with two separate LEFT JOINs rather than
// a single FK — either can legitimately be null/dangling if the account or
// staff record was later removed, in which case the permanent
// assigned_to_name snapshot from creation time is shown instead.
const getTaskQuery = `
  SELECT
    t.id, t.title, t.description, t.assignee_type, t.assigned_to, t.assigned_by,
    t.priority, t.status, t.due_date, t.completed_at, t.created_at, t.updated_at,
    t.attachment_path, t.attachment_name, t.attachment_size, t.attachment_type,
    t.attachment_version, t.attachment_edited_by_name, t.attachment_edited_at,
    CASE
      WHEN t.assignee_type = 'user'  THEN COALESCE(u.name, t.assigned_to_name, 'Deleted User')
      ELSE COALESCE(s.name, t.assigned_to_name, 'Removed Staff')
    END AS assigned_to_name,
    CASE WHEN t.assignee_type = 'user' THEN COALESCE(u.department, '') ELSE COALESCE(s.department, '') END AS assigned_to_dept,
    CASE WHEN t.assignee_type = 'staff' THEN COALESCE(s.active, 1) ELSE 1 END AS assigned_to_active,
    COALESCE(b.name, t.assigned_by_name, 'Deleted User') AS assigned_by_name,
    (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count
  FROM tasks t
  LEFT JOIN users u    ON t.assignee_type = 'user'  AND t.assigned_to = u.id
  LEFT JOIN it_staff s ON t.assignee_type = 'staff' AND t.assigned_to = s.id
  LEFT JOIN users b    ON t.assigned_by = b.id
`;

const getCommentsQuery = `
  SELECT c.id, c.comment, c.created_at, c.author_id,
         c.attachment_path, c.attachment_name, c.attachment_size, c.attachment_type,
         c.attachment_version, c.attachment_edited_by_name, c.attachment_edited_at,
         COALESCE(u.name, c.author_name, 'Removed User') AS author_name
  FROM task_comments c
  LEFT JOIN users u ON c.author_id = u.id
`;

module.exports = { ownsTask, createdTask, isPrivateTask, canAccessTask, getTaskQuery, getCommentsQuery };
