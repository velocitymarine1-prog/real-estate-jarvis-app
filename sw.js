// sw.js: offline, updates and the morning heads-up (design §3.17, §3.18).
// The app's files are cached by build: cache-first on GitHub Pages (a new build installs in the background and takes over the next time
// the app comes to the front, when the page asks with SKIP_WAITING), network-first on this Mac (BUILD "dev", so an edit shows at
// once while offline still works). The API is network-first, its last good answers kept for offline. A push (empty, no payload) fetches
// the morning headline with her token from IndexedDB within 5 s and always shows a notification, as Safari requires; a tap opens Today.
const BUILD = "36d47c4";                       // stamped by tools/deploy.sh with the source commit
const CACHE = "jarvis-" + BUILD;
const API_CACHE = "jarvis-api";
const DEV = BUILD === "dev";
// every file of the site (written by tools/deploy.sh); on this Mac, the shell only, and the rest is cached as it is used
const SHELL = [/*SHELL*/"./", "api.js", "app.css", "app.js", "config.js", "data/fair-housing.json", "fonts/bricolage-grotesque-latin.woff2", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "index.html", "manifest.webmanifest", "push.js", "router.js", "rules.js", "shared/compliance.js", "shared/ids.js", "shared/links.js", "shared/models.js", "shared/numbers.js", "shared/text.js", "shared/time.js", "store.js", "ui.js", "views/invite.js", "views/onboarding.js", "views/plan.js", "views/prompter.js", "views/script.js", "views/studio.js", "views/today.js", "views/welcome.js", "views/you.js"/*/SHELL*/];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // one by one, fresh from the network (not the HTTP cache): a missing file never blocks the install
    await Promise.all(SHELL.map(u => fetch(new Request(u, { cache: "reload" })).then(r => (r.ok ? c.put(u, r) : null)).catch(() => null)));
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("jarvis-") && k !== CACHE && k !== API_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
  if (e.data && e.data.type === "SIGNED_OUT") e.waitUntil(caches.delete(API_CACHE));
});

const isApi = url => url.origin !== self.location.origin && /\/api\/v1\//.test(url.pathname);

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (isApi(url)) {
    if (url.pathname.endsWith("/health") || url.searchParams.get("headline") === "1") return;   // always live
    e.respondWith(networkFirst(req, API_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;                                              // thumbnails and the like: the browser's own
  if (req.mode === "navigate") { e.respondWith(page(req)); return; }
  if (DEV || url.pathname.includes("/fixtures/")) { e.respondWith(networkFirst(req, CACHE)); return; }
  e.respondWith(cacheFirst(req));
});

async function page(req) {
  const c = await caches.open(CACHE);
  if (!DEV) {
    const hit = await c.match("index.html") || await c.match("./");
    if (hit) return hit;
  }
  try {
    const r = await fetch(req);
    if (r.ok) c.put("index.html", r.clone());
    return r;
  } catch {
    return (await c.match("index.html")) || (await c.match("./")) || new Response("You're offline, and Jarvis hasn't been opened here before.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}
async function networkFirst(req, name) {
  const c = await caches.open(name);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(req) || (name === CACHE ? await c.match(req, { ignoreSearch: true }) : null);
    if (hit) return hit;
    throw err;
  }
}

// ------------------------------------------------------------------ the morning heads-up
function kv(keys) {
  return new Promise(resolve => {
    let r;
    try { r = indexedDB.open("jarvis", 1); } catch { resolve({}); return; }
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => resolve({});
    r.onsuccess = () => {
      const db = r.result, out = {};
      let left = keys.length;
      const done = () => { if (--left === 0) { db.close(); resolve(out); } };
      try {
        const st = db.transaction("kv", "readonly").objectStore("kv");
        for (const k of keys) { const g = st.get(k); g.onsuccess = () => { out[k] = g.result; done(); }; g.onerror = done; }
      } catch { db.close(); resolve({}); }
    };
  });
}
async function headline() {
  const { token, api } = await kv(["token", "api"]);
  if (!token || !api || !/^https?:\/\//.test(api)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(api + "/briefing/today?headline=1", { headers: { Authorization: "Bearer " + token }, signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.headline === "string" && j.headline.trim() ? j.headline.trim() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let text = null;
    try { const d = e.data && e.data.text(); if (d) { try { const j = JSON.parse(d); text = j.headline || j.body || null; } catch { text = d; } } } catch { /* an empty push */ }
    if (!text) text = await headline();
    await self.registration.showNotification("Good morning ☀️", {
      body: text || "Your Lake Mary briefing is ready",
      icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "morning", renotify: false, data: { hash: "#/today" },
    });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || "#/today";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && "focus" in w) { w.postMessage({ type: "open", hash }); return w.focus(); }
    }
    return self.clients.openWindow(self.registration.scope + hash);
  })());
});
