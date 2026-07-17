import { useEffect, useRef, useCallback } from "react";

/**
 * Calls onIdle() after `timeoutMs` of no user activity (mouse, keyboard,
 * scroll, touch). Calls onWarning() a bit earlier so the user can see a
 * "you're about to be logged out" notice. Resets on any activity.
 *
 * @param {boolean} active     - only runs the timer while true (e.g. while logged in)
 * @param {number}  timeoutMs  - total idle time before onIdle() fires
 * @param {number}  warnMs     - how long before timeout to fire onWarning() (0 to disable)
 * @param {Function} onIdle    - called once when the user has been idle too long
 * @param {Function} onWarning - called once when entering the warning window
 */
export function useIdleTimeout({ active, timeoutMs, warnMs = 0, onIdle, onWarning }) {
  const idleTimer   = useRef(null);
  const warnTimer   = useRef(null);
  const warnedRef   = useRef(false);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (warnTimer.current) clearTimeout(warnTimer.current);
  }, []);

  const resetTimer = useCallback(() => {
    clearTimers();
    warnedRef.current = false;
    if (!active) return;

    if (warnMs > 0 && warnMs < timeoutMs) {
      warnTimer.current = setTimeout(() => {
        warnedRef.current = true;
        onWarning && onWarning();
      }, timeoutMs - warnMs);
    }

    idleTimer.current = setTimeout(() => {
      onIdle && onIdle();
    }, timeoutMs);
  }, [active, timeoutMs, warnMs, onIdle, onWarning, clearTimers]);

  useEffect(() => {
    if (!active) {
      clearTimers();
      return;
    }

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "wheel"];
    const handleActivity = () => resetTimer();

    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));
    resetTimer();

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, timeoutMs, warnMs]);

  return { resetTimer };
}
