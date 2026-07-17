import { useEffect, useRef } from "react";
import { api } from "./api.js";
import { sseClient } from "./sseClient.js";

const THIRTY_MIN = 30 * 60 * 1000;

/**
 * Two complementary notification paths for Tasks:
 *
 * 1. Instant: subscribes to the shared /api/events SSE stream and fires a
 *    one-off alert the moment a task is assigned to this account (or, for
 *    an admin, any task at all — including IT-staff assignments, which
 *    don't belong to any login account) or commented on.
 *
 * 2. Recurring: polls GET /api/tasks/due (role-aware server-side: an admin
 *    gets every due/overdue task, everyone else only their own) once
 *    immediately, then every 30 minutes for as long as the app stays open.
 */
export function useTaskNotifications({ active, token, userId, isAdmin, onDueTasks }) {
  const intervalRef = useRef(null);

  function notify(title, body, tag) {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notif = new Notification(title, { body, tag });
      notif.onclick = () => { window.focus(); notif.close(); };
    }
  }

  async function checkDueTasks() {
    try {
      const due = await api.getDueTasks();
      if (due.length) {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        const overdue = due.filter(t => t.due_date < today);
        notify(
          `${due.length} Task${due.length > 1 ? "s" : ""} Due`,
          overdue.length
            ? `${overdue.length} overdue — including "${due[0].title}"`
            : `Due today: "${due[0].title}"${due.length > 1 ? ` and ${due.length - 1} more` : ""}`,
          "tasks-due"
        );
      }
      onDueTasks && onDueTasks(due);
    } catch {
      // Non-fatal — just skip this cycle, the next 30-minute poll will retry.
    }
  }

  // ── Recurring 30-minute due-task reminder ───────────────────────────────
  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    checkDueTasks(); // check immediately on login/mount
    intervalRef.current = setInterval(checkDueTasks, THIRTY_MIN);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [active]);

  // ── Instant push for new assignments and comments ───────────────────────
  // Uses the shared SSE connection (sseClient) instead of opening its own
  // EventSource, so this hook and useComplaintNotifications don't each hold
  // a separate long-lived connection open through IIS for the same tab.
  useEffect(() => {
    if (!active || !token) return;

    const unsubTask = sseClient.subscribe(token, "new-task", (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      const concernsMe = data.assignee_type === "user" && data.assigned_to === userId;
      if (!concernsMe && !isAdmin) return; // not for this account, and not an admin overseeing everything

      notify(
        "New Task Assigned",
        `${data.title} — due ${data.due_date} (${data.priority}) — to ${data.assigned_to_name}`,
        `task-${data.id}`
      );
    });

    const unsubComment = sseClient.subscribe(token, "task-comment", (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.author_id === userId) return; // don't notify me about my own comment
      const concernsMe = (data.assigned_to === userId) || (data.assigned_by === userId);
      if (!concernsMe && !isAdmin) return;

      notify(
        "New Comment on Task",
        `${data.author_name} commented on "${data.task_title}"`,
        `task-comment-${data.task_id}`
      );
    });

    return () => { unsubTask(); unsubComment(); };
  }, [active, token, userId, isAdmin]);
}
