import { useEffect, useState } from "react";
import { sseClient } from "./sseClient.js";

/**
 * Subscribes to /api/events (Server-Sent Events) while `active` is true,
 * and fires a native browser notification whenever a "new-complaint" event
 * arrives. Also shows an in-app toast via the provided callback, so the
 * alert is hard to miss even if the OS notification permission was never
 * granted.
 *
 * Browser notification permission must be requested via a user gesture in
 * most browsers — call `requestPermission()` from a button click the first
 * time the admin wants to enable alerts.
 */
export function useComplaintNotifications({ active, token, onNewComplaint }) {
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  // Notification.permission can change outside of our control — e.g. the
  // user resets it via Chrome's site settings/lock icon rather than through
  // our own button. Poll periodically so our React state stays in sync
  // instead of getting stuck showing a stale "granted" or "denied" value.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const interval = setInterval(() => {
      setPermission(prev => (Notification.permission !== prev ? Notification.permission : prev));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  function requestPermission() {
    if (typeof Notification === "undefined") return Promise.resolve("unsupported");

    // If the browser has the permission hard-blocked (user previously chose
    // "Block" via the address-bar/lock-icon UI, not just closed the popup),
    // requestPermission() resolves immediately with "denied" and shows no
    // prompt at all — this is standard browser behavior, not a bug in our
    // code. In that case the user must re-enable it from the browser's own
    // site settings; we can only detect and clearly report that state.
    return Notification.requestPermission().then((result) => {
      setPermission(result);
      return result;
    });
  }

  // Uses the shared SSE connection (sseClient) instead of opening its own
  // EventSource, so this hook and useTaskNotifications don't each hold a
  // separate long-lived connection open through IIS for the same tab.
  useEffect(() => {
    if (!active || !token) return;

    const unsubscribe = sseClient.subscribe(token, "new-complaint", (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      // Native OS-level notification, if permission was granted. Re-check
      // the live browser value here (not our possibly-stale state) since
      // this fires from an event listener that could outlive a permission
      // change made moments ago.
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const notif = new Notification(`New Complaint — ${data.ticket_no}`, {
          body: `${data.complainant_name}, ${data.raised_by_dept}\n${data.title}`,
          tag: `complaint-${data.id}`,
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      }

      onNewComplaint && onNewComplaint(data);
    });

    return () => { unsubscribe(); };
  }, [active, token]);

  return { permission, requestPermission };
}
