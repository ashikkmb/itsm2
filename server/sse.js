// ── Lightweight Server-Sent Events (SSE) broadcaster ───────────────────────────
// Keeps a list of connected admin browser tabs and pushes a message to all of
// them whenever something notification-worthy happens (e.g. a new complaint).
// No external dependencies, no WebSocket library needed — SSE is just a
// long-lived HTTP response that stays open and streams text events over time.

const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // Connection likely already closed; it will be cleaned up by the
      // route's "close" handler. Ignore write errors here.
    }
  }
}

// Watch this over a few hours — if it climbs steadily instead of staying
// roughly flat with actual logins, connections are leaking.
setInterval(() => {
  console.log(`[SSE] active connections: ${clients.size}`);
}, 5 * 60 * 1000);

module.exports = { addClient, removeClient, broadcast };
