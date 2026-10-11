// api.js: the one wrapper every call goes through (design §3.22, contract §5).
// Answers come back as data; failures as an ApiError whose `kind` the views act on and whose `reason` is a sentence she can read:
//   auth (401: this phone was signed out) · not_connected (no Anthropic key yet) · busy (503, or our own timeout) · declined (422)
//   bad_link (400) · offline (no network) · network (the Worker didn't answer) · aborted (she pressed Cancel) · gone (404 on a job:
//   the idea or the request isn't there anymore) · other
// Writing goes through write() (contract §8.3): with the Mac's writer the Worker answers a job, which write() follows to the end.
import { API, MOCK } from "./config.js";
import * as store from "./store.js";
import { TZ, easternDate, addDays } from "./shared/time.js";

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
  constructor(kind, reason, status = 0, error = "", field = "") {
    super(reason || kind);
    this.kind = kind; this.reason = reason || SENTENCES[kind] || SENTENCES.other; this.status = status; this.error = error; this.field = field;
  }
}

let mockModule = null;
async function mock() { if (!mockModule) mockModule = await import("./mock.js"); return mockModule; }

// errors from a JSON answer: the Worker's { error, reason }
export function errorFor(status, data) {
  const error = (data && data.error) || "", reason = (data && data.reason) || "", field = (data && data.field) || "";
  if (status === 401) return new ApiError("auth", SENTENCES.auth, status, error);
  if (status === 413 || error === "too_big") return new ApiError("too_big", reason || "That's too long to save.", status, error, field);
  if (error === "bad_profile" || error === "bad_field") return new ApiError("bad_field", reason || "Something there needs a look.", status, error, field);
  if (error === "not_connected") return new ApiError("not_connected", SENTENCES.not_connected, status, error);
  if (status === 422 || error === "declined") return new ApiError("declined", reason || SENTENCES.declined, status, error);
  if (error === "bad_link") return new ApiError("bad_link", reason || SENTENCES.bad_link, status, error);
  if (status === 503 || error === "busy") return new ApiError("busy", reason || SENTENCES.busy, status, error);
  if (status === 429) return new ApiError("busy", reason || "Slow down a moment, then try again.", status, error);
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

// ------------------------------------------------------------------ writing through a job (design §11.2, contract §8.2, §8.3)
const JOB_FAST_MS = 2000, JOB_SLOW_MS = 5000, JOB_AWAY_MS = 10000, JOB_FAST_FOR = 120000;

// writer mode: the request is saved on the Worker as a job and the Mac's writer writes it. write() posts like api() does; an answer
// with a job is kept on the phone (meta says what it's for: { kind: ideas | script | first, ideaId, label, mode, … }) and followed
// to the end, so the caller gets exactly what the inline route answers. An answer without one (writing inline, the mock) is returned
// as it is.
export async function write(method, path, body, { signal, onState, meta = {} } = {}) {
  const r = await api(method, path, body, { signal, timeout: 90000 });
  if (!r || !r.job || typeof r.job.id !== "string") return r;
  store.addJob({ ...meta, id: r.job.id, at: Date.now() });
  if (r.writer) store.setWriter(r.writer);
  tell(onState, { state: r.job.state || "queued", writer: r.writer || store.writer(), job: r.job });
  return followJob(r.job.id, { signal, onState, delay: JOB_FAST_MS });
}

// followJob(id, { signal, onState, delay }): a job until it lands → its result. Asks every 2 s for two minutes, then every 5 s, and
// every 10 s while the writer is away (offline, or resting after a usage limit); a network blip only waits and asks again, since the
// job is safe on the Worker. onState({ state, writer, job }) after every answer. A failed or expired job throws its ApiError and
// leaves the list; the signal (Cancel, leaving) only stops this phone waiting: the job goes on, and stays on the list.
export async function followJob(id, { signal, onState, delay = 0 } = {}) {
  const since = Date.now();
  let wait = delay;
  for (;;) {
    if (wait) await pause(wait, signal);
    if (signal && signal.aborted) throw new ApiError("aborted", "", 0);
    let r;
    try { r = await api("GET", `/jobs/${encodeURIComponent(id)}`, undefined, { signal, timeout: 20000 }); }
    catch (e) {
      if (e.kind === "aborted" || e.kind === "auth") throw e;
      if (e.status === 404) { store.dropJob(id); throw new ApiError("gone", "That request isn't here anymore. Try again.", 404, "not_found"); }
      wait = JOB_SLOW_MS;
      continue;
    }
    const j = (r && r.job) || {};
    if (r && r.writer) store.setWriter(r.writer);
    if (j.state === "done") { store.dropJob(id); return j.result || {}; }
    if (j.state === "failed" || j.state === "expired") { store.dropJob(id); throw jobError(j); }
    tell(onState, { state: j.state || "queued", writer: (r && r.writer) || store.writer(), job: j });
    wait = writerAway(r && r.writer) ? JOB_AWAY_MS : Date.now() - since < JOB_FAST_FOR ? JOB_FAST_MS : JOB_SLOW_MS;
  }
}

// a failed or expired job's error, in the inline route's words (contract §8.2)
function jobError(j) {
  const error = j.error || "busy", reason = j.reason || "";
  if (j.state === "expired" || error === "expired") return new ApiError("busy", reason || "That waited too long for Jarvis's writer. Try again.", 503, "expired");
  if (error === "not_found") return new ApiError("gone", reason || "That idea isn't here anymore.", 404, error);
  return errorFor(error === "declined" ? 422 : error === "busy" ? 503 : 0, { error, reason });
}

function tell(fn, s) { if (fn) { try { fn(s); } catch (e) { console.error(e); } } }
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new ApiError("aborted", "", 0)); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(t); reject(new ApiError("aborted", "", 0)); };
    if (signal) signal.addEventListener("abort", stop, { once: true });
  });
}

const restingUntil = w => (w && w.resting ? Date.parse(w.resting) : NaN);
export function writerAway(w) { const r = restingUntil(w); return !!w && (w.online === false || (Number.isFinite(r) && r > Date.now())); }

// writerNote(w, { before }): what she reads while the Mac's writer is away, or null while it's working. Resting (Claude's usage
// limit) names the time it's back on her clock (Eastern, as the rest of the app); before: the Studio's note before she has asked.
export function writerNote(w, { before = false } = {}) {
  if (!w || typeof w !== "object") return null;
  const until = restingUntil(w);
  if (Number.isFinite(until) && until > Date.now()) {
    const when = backAt(until);
    return before ? `Writing is resting until ${when}. You can still ask: it's saved and written then.` : `Writing is resting until ${when}. Your request is saved.`;
  }
  if (w.online === false) {
    return before ? "Jarvis's writer is offline right now. You can still ask: your request is saved and written when it's back."
      : "Jarvis's writer is offline right now. Your request is saved and will be written when it's back.";
  }
  return null;
}
const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" });
// "3:00 pm", "3:00 pm tomorrow", "Tuesday at 3:00 pm"
function backAt(ms) {
  const d = new Date(ms), clock = CLOCK.format(d).replace(" AM", " am").replace(" PM", " pm");
  const day = easternDate(d), today = easternDate();
  if (day === today) return clock;
  if (day === addDays(today, 1)) return clock + " tomorrow";
  return `${WEEKDAY.format(d)} at ${clock}`;
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
