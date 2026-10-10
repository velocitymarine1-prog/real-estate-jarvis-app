// store.js: what the app keeps on her phone (design §3.16, §3.18), and the little live state the views share.
//   localStorage "jarvis:*": the token, her user and profile, the last seven briefings, her ideas, Studio's last results, the
//   prompter's speed and size, the first move. IndexedDB "jarvis" (store "kv"): the token and the API's address again, because the
//   service worker can't read localStorage and needs both to fetch the morning headline for the push.
const P = "jarvis:";

export function get(key, fallback = null) {
  try { const v = localStorage.getItem(P + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function set(key, value) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); return true; } catch { return false; }
}
export function del(key) { try { localStorage.removeItem(P + key); } catch { /* private mode */ } }

// ------------------------------------------------------------------ the live state and its events
const listeners = new Map();
export const live = { me: get("me"), health: get("health"), online: navigator.onLine, lastNetError: false };
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); }
export function emit(ev, data) { for (const fn of [...(listeners.get(ev) || [])]) { try { fn(data); } catch (e) { console.error(e); } } }

// ------------------------------------------------------------------ IndexedDB, for the service worker
function idb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) { reject(new Error("no indexedDB")); return; }
    const r = indexedDB.open("jarvis", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbWrite(entries, clear = false) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite"), st = tx.objectStore("kv");
      if (clear) st.clear();
      for (const [k, v] of Object.entries(entries)) st.put(v, k);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* the push headline falls back to its plain line */ }
}

// ------------------------------------------------------------------ sign-in
export function token() { return get("token"); }
export async function setToken(t, api) { set("token", t); await idbWrite({ token: t, api }); }
export async function signOutHere() {
  const keep = new Set(["jarvis:prompter", "jarvis:mockdb"]);
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(P) && !keep.has(k)) localStorage.removeItem(k); } catch { /* */ }
  try { sessionStorage.clear(); } catch { /* */ }
  live.me = null;
  try { if ("caches" in self) await caches.delete("jarvis-api"); } catch { /* */ }
  await idbWrite({}, true);
}

// ------------------------------------------------------------------ her user and profile
export function setMe(me) { live.me = me; set("me", me); emit("me", me); }
export function profile() { return (live.me && live.me.user && live.me.user.profile) || {}; }
export function firstName() { const p = profile(); return (p.firstName || (live.me && live.me.user && live.me.user.name) || "").trim(); }
export function setHealth(h) { live.health = { ...h, at: Date.now() }; set("health", live.health); emit("health", live.health); }
// writing is off only when the Worker said so (no key yet); unknown counts as on, so an offline phone still tries
export function aiOff() { return !!(live.health && live.health.ai === false); }

// ------------------------------------------------------------------ briefings: the last seven days
export function saveBriefing(answer) {
  if (!answer || !answer.briefing) { set("briefingAnswer", answer ? { ...answer, fetchedAt: Date.now() } : null); return; }
  const all = get("briefings", {});
  const b = answer.briefing;
  all[b.date] = { briefing: b, fetchedAt: Date.now() };
  const dates = Object.keys(all).sort().reverse();
  for (const d of dates.slice(7)) delete all[d];
  set("briefings", all);
  set("briefingAnswer", { date: answer.date, stale: !!answer.stale, briefingDate: b.date, fetchedAt: Date.now() });
}
export function briefingFor(date) { const all = get("briefings", {}); return all[date] ? all[date].briefing : null; }
export function latestBriefing() {
  const all = get("briefings", {}), ans = get("briefingAnswer");
  const dates = Object.keys(all).sort().reverse();
  if (!dates.length) return ans ? { briefing: null, stale: false, date: ans.date, fetchedAt: ans.fetchedAt } : null;
  const d = ans && ans.briefingDate && all[ans.briefingDate] ? ans.briefingDate : dates[0];
  return { briefing: all[d].briefing, stale: ans ? !!ans.stale : false, date: ans ? ans.date : d, fetchedAt: all[d].fetchedAt };
}

// ------------------------------------------------------------------ her ideas (IdeaRow by id); the server holds the truth
export function ideas() { return get("ideas", {}); }
export function idea(id) { return ideas()[id] || null; }
export function saveIdeas(rows, { replace = false } = {}) {
  const old = ideas();
  const all = replace ? {} : { ...old };
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    const prev = old[r.id];
    all[r.id] = prev && prev._userText ? { ...r, _userText: prev._userText } : r;
  }
  set("ideas", all); emit("ideas", all);
  return all;
}
export function saveIdea(row) { if (row && row.id) saveIdeas([row]); return row; }
export function dropIdea(id) { const all = ideas(); delete all[id]; set("ideas", all); emit("ideas", all); }
export function noteUserText(id, text) { const all = ideas(); if (all[id] && text) { all[id]._userText = text; set("ideas", all); } }
