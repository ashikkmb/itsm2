// Single shared SSE connection for the whole app. Every hook that wants
// live updates subscribes here instead of each opening its own EventSource.
// This matters because IIS is in front of this app as a reverse proxy —
// every open EventSource is a long-lived connection held in IIS's proxy
// pool, so halving the connection count (one shared stream instead of one
// per feature) meaningfully reduces pressure there.

let source = null;
let currentToken = null;
const listeners = {}; // eventName -> Set of callbacks
let totalSubscribers = 0;

function open(token) {
  currentToken = token;
  const url = `/api/events?token=${encodeURIComponent(token)}`;
  source = new EventSource(url);
  source.onerror = () => {}; // EventSource retries on its own

  for (const eventName of Object.keys(listeners)) {
    for (const cb of listeners[eventName]) {
      source.addEventListener(eventName, cb);
    }
  }
}

function close() {
  if (source) { source.close(); source = null; }
  currentToken = null;
}

function subscribe(token, eventName, callback) {
  if (!token) return () => {};
  if (!source || currentToken !== token) {
    close();
    open(token);
  }
  if (!listeners[eventName]) listeners[eventName] = new Set();
  listeners[eventName].add(callback);
  source.addEventListener(eventName, callback);
  totalSubscribers++;

  return () => {
    listeners[eventName].delete(callback);
    if (source) source.removeEventListener(eventName, callback);
    totalSubscribers--;
    if (totalSubscribers <= 0) close();
  };
}

export const sseClient = { subscribe };
