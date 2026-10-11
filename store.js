// store.js: what the app keeps on her phone (design §3.16, §3.18), and the little live state the views share.
//   localStorage "jarvis:*": the token, her user and profile, the last seven briefings, her ideas, Studio's last results, the
//   prompter's speed and size, the first move. IndexedDB "jarvis" (store "kv"): the token and the API's address again, because the
//   service worker can't read localStorage and needs both to fetch the morning headline for the push.
const P = "jarvis:";

export function get(key, fallback = null) {
  try { const v = localStorage.getItem(P + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
// a full phone: WebKit counts two bytes a character and an idea is 3 to 13 thousand characters, so a write can fail. Then the oldest
// briefings and the oldest unsaved ideas make room (never one with edits not yet on the server), and the write is tried again.
const isQuota = e => !!e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014 || /quota/i.test(e.message || ""));
const byAge = r => r.updatedAt || r.createdAt || "";
const PRUNERS = {
  briefings: (v, level) => {
    const ds = Object.keys(v || {}).sort().reverse(), keep = level === 0 ? 3 : 1;
    if (ds.length <= keep) return null;
    const out = {}; for (const d of ds.slice(0, keep)) out[d] = v[d]; return out;
  },
  ideas: (v, level) => {
    const rows = Object.values(v || {});
    const spare = rows.filter(r => !r._dirty && (r.status === "dismissed" || r.status === "new")).sort((a, b) => byAge(a).localeCompare(byAge(b)));
    if (!spare.length) return null;
    const drop = new Set(spare.slice(0, level === 0 ? Math.ceil(spare.length / 2) : spare.length).map(r => r.id));
    const out = {}; for (const r of rows) if (!drop.has(r.id)) out[r.id] = r; return out;
  },
};
export function set(key, value) {
  let v = value;
  for (let level = 0; level < 3; level++) {
    try { localStorage.setItem(P + key, JSON.stringify(v)); return true; }
    catch (e) {
      if (!isQuota(e)) return false;
      let freed = false;
      for (const k of Object.keys(PRUNERS)) {
        if (k === key) continue;
        const cur = get(k), smaller = cur && PRUNERS[k](cur, level);
        if (smaller) { try { localStorage.setItem(P + k, JSON.stringify(smaller)); freed = true; } catch { /* still full */ } }
      }
      if (PRUNERS[key]) { const smaller = PRUNERS[key](v, level); if (smaller) { v = smaller; freed = true; } }
      if (!freed) { for (const k of ["studio", "health", "lastSync"]) if (k !== key) del(k); if (level === 2) return false; }
      emit("pruned", { key, level });
    }
  }
  return false;
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
// saveIdeas(rows, { replace, clean }): the server's rows over the phone's. A row with edits not yet on the server (_dirty) keeps its
// script and versions (the edit is sent again by app.js); replace keeps such rows even when the list leaves them out. clean: these
// rows are the server's answer to that edit, so the mark goes.
export function saveIdeas(rows, { replace = false, clean = false } = {}) {
  const old = ideas();
  const all = replace ? {} : { ...old };
  if (replace) for (const [id, r] of Object.entries(old)) if (r._dirty) all[id] = r;
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    const prev = old[r.id];
    let next = { ...r };
    delete next._dirty;
    if (prev && prev._userText) next._userText = prev._userText;
    if (prev && prev._dirty && !clean) next = { ...next, script: prev.script, versions: prev.versions, current: prev.current, _dirty: prev._dirty };
    all[r.id] = next;
  }
  set("ideas", all); emit("ideas", all);
  return all;
}
export function saveIdea(row, opts) { if (row && row.id) saveIdeas([row], opts); return row; }
// an idea from a briefing kept on the phone (Today's move most mornings): its whole script is here even before her ideas list has it,
// so the script page and the prompter can open it without the Worker
export function briefingIdea(id) {
  const all = get("briefings", {});
  for (const d of Object.keys(all).sort().reverse()) {
    const b = all[d] && all[d].briefing;
    const it = b && Array.isArray(b.ideas) ? b.ideas.find(i => i && i.id === id) : null;
    if (!it) continue;
    const at = b.createdAt || new Date().toISOString();
    const shots = it.script && Array.isArray(it.script.shotList) ? it.script.shotList.map(() => false) : [];
    const versions = it.script ? [{ label: "Original", at, script: it.script, shots }] : [];
    return { id: it.id, source: "briefing", status: "new", idea: it.idea || {}, script: it.script || null, versions, current: versions.length - 1,
      check: it.check || [], facts: it.facts || [], supplied: it.supplied || [], remixOf: null, briefingDate: b.date || d, shots, rating: 0,
      planDate: null, postUrl: null, postedAt: null, outcome: null, createdAt: at, updatedAt: at, _fromBriefing: true };
  }
  return null;
}
export function ideaOrBriefing(id) { return idea(id) || briefingIdea(id); }

// an edit that didn't reach the server: kept on the phone, marked, and sent again (app.js) when the phone is back online
export function markDirty(id, script, base = null) {
  const all = ideas();
  if (!all[id] && base) all[id] = { ...base };
  const r = all[id];
  if (!r) return;
  r.script = script;
  if (Array.isArray(r.versions) && r.current >= 0 && r.versions[r.current]) r.versions[r.current] = { ...r.versions[r.current], script };
  r._dirty = { at: Date.now() };
  set("ideas", all);
}
export function dirtyRows() { return Object.values(ideas()).filter(r => r._dirty); }
export function isDirty(id) { const r = idea(id); return !!(r && r._dirty); }
export function dropIdea(id) { const all = ideas(); delete all[id]; set("ideas", all); emit("ideas", all); }
export function noteUserText(id, text) { const all = ideas(); if (all[id] && text) { all[id]._userText = text; set("ideas", all); } }
