// api.js: the one wrapper every call goes through (design §3.22, contract §5).
// Answers come back as data; failures as an ApiError whose `kind` the views act on and whose `reason` is a sentence she can read:
//   auth (401: this phone was signed out) · not_connected (no Anthropic key yet) · busy (503, or our own timeout) · declined (422)
//   bad_link (400) · offline (no network) · network (the Worker didn't answer) · aborted (she pressed Cancel) · other
import { API, MOCK } from "./config.js";
import * as store from "./store.js";

export const SENTENCES = {
  not_connected: "Writing isn't switched on yet. Isaac is setting it up.",
  busy: "Couldn't write that just now. Try again in a minute.",
  declined: "I can't write that one. Try a different angle.",
  bad_link: "I can't read that link. Paste the caption or describe the video.",
  offline: "You're offline.",
  network: "Couldn't reach Jarvis just now. Try again in a minute.",
  auth: "This phone was signed out. Type your code to come back.",
  other: "Something went wrong on our side. Try again.",
};

export class ApiError extends Error {
  constructor(kind, reason, status = 0, error = "") {
    super(reason || kind);
    this.kind = kind; this.reason = reason || SENTENCES[kind] || SENTENCES.other; this.status = status; this.error = error;
  }
}

let mockModule = null;
async function mock() { if (!mockModule) mockModule = await import("./mock.js"); return mockModule; }

// errors from a JSON answer: the Worker's { error, reason }
export function errorFor(status, data) {
  const error = (data && data.error) || "", reason = (data && data.reason) || "";
  if (status === 401) return new ApiError("auth", SENTENCES.auth, status, error);
  if (error === "not_connected") return new ApiError("not_connected", SENTENCES.not_connected, status, error);
  if (status === 422 || error === "declined") return new ApiError("declined", reason || SENTENCES.declined, status, error);
  if (error === "bad_link") return new ApiError("bad_link", reason || SENTENCES.bad_link, status, error);
  if (status === 503 || error === "busy") return new ApiError("busy", reason || SENTENCES.busy, status, error);
  if (status === 429) return new ApiError("busy", reason || "That's a lot at once. Give it a minute and try again.", status, error);
  if (status >= 500) return new ApiError("other", reason || SENTENCES.other, status, error);
  return new ApiError("other", reason || SENTENCES.other, status, error);
}

let authLost = null;
export function onAuthLost(fn) { authLost = fn; }

export async function api(method, path, body, { signal, timeout = 20000, auth = true } = {}) {
  if (MOCK) {
    try { const data = await (await mock()).handle(method, path, body, { signal }); markOnline(); if (method === "GET") store.set("lastSync", Date.now()); return data; }
    catch (e) { if (e && e.kind === "auth" && auth && authLost) authLost(); throw e; }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const tok = store.token();
  if (auth && tok) headers.Authorization = "Bearer " + tok;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: "no-store" });
  } catch {
    clearTimeout(timer);
    if (signal && signal.aborted) throw new ApiError("aborted", "", 0);
    if (!navigator.onLine) { markOffline(); throw new ApiError("offline", SENTENCES.offline, 0); }
    store.live.lastNetError = true; store.emit("net", false);
    if (ctrl.signal.aborted) throw new ApiError("busy", SENTENCES.busy, 0, "timeout");
    throw new ApiError("network", SENTENCES.network, 0);
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  clearTimeout(timer);
  markOnline();
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.ok) { if (method === "GET") store.set("lastSync", Date.now()); return data; }
  const err = errorFor(res.status, data);
  if (err.kind === "auth" && auth && authLost) authLost();
  throw err;
}

function markOnline() { if (store.live.lastNetError) { store.live.lastNetError = false; store.emit("net", true); } }
function markOffline() { store.live.online = false; store.emit("online", false); }

// fire and forget: the usefulness counters (open, script, prompter, record, posted)
export function event(kind) { api("POST", "/events", { kind }).catch(() => {}); }

export async function health() {
  const h = await api("GET", "/health", undefined, { auth: false, timeout: 10000 });
  if (h && typeof h === "object") store.setHealth(h);
  return h;
}
