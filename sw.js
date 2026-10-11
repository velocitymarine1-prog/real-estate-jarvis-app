// sw.js: offline, updates and the morning heads-up (design §3.17, §3.18).
// The app's files are cached by build: cache-first on GitHub Pages (a new build installs in the background and takes over the next time
// the app comes to the front, when the page asks with SKIP_WAITING), network-first on this Mac (BUILD "dev", so an edit shows at
// once while offline still works). The install is all or nothing: if one file fails, this build doesn't install, the build she has
// keeps working (and its cache), and the browser tries again later. The API is never cached here: the app keeps its own copies on the
// phone (localStorage), so an answer the page sees is always the server's own, and a failure is a failure it can show. A push (empty,
// no payload) first asks the Worker, with her token from IndexedDB, whether a script or ideas the Mac's writer finished while she was
// away are what it's about (GET /jobs/ready, contract §8.3): then "Your script is ready", and a tap opens it. Otherwise it fetches the
// morning headline, and a tap opens Today. Both within about 5 s, and a notification is always shown, as Safari requires.
const BUILD = "1a320fd";                       // stamped by tools/deploy.sh with the source commit
const CACHE = "jarvis-" + BUILD;
const DEV = BUILD === "dev";
// every file of the site (written by tools/deploy.sh); on this Mac, the shell only, and the rest is cached as it is used
const SHELL = [/*SHELL*/"./", "api.js", "app.css", "app.js", "config.js", "data/fair-housing.json", "fonts/bricolage-grotesque-latin.woff2", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "index.html", "manifest.webmanifest", "push.js", "router.js", "rules.js", "shared/compliance.js", "shared/ids.js", "shared/links.js", "shared/models.js", "shared/numbers.js", "shared/text.js", "shared/time.js", "store.js", "ui.js", "views/invite.js", "views/onboarding.js", "views/plan.js", "views/prompter.js", "views/script.js", "views/studio.js", "views/today.js", "views/welcome.js", "views/you.js"/*/SHELL*/];

self.addEventListener("install", e => {
  // every file, fresh from the network (not the HTTP cache), all or nothing: a failed file fails this install, so the old build and
  // its cache stay in charge and nothing she has opened before stops working offline
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // older builds, and the API answers earlier builds kept ("jarvis-api")
    for (const k of await caches.keys()) if (k.startsWith("jarvis-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // the API (never cached here), thumbnails and the like: straight to the network
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
// ask(path, ms): the Worker's JSON answer with her token, or null (no token, a failure, or past ms)
async function ask(path, ms) {
  const { token, api } = await kv(["token", "api"]);
  if (!token || !api || !/^https?:\/\//.test(api) || ms <= 0) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(api + path, { headers: { Authorization: "Bearer " + token }, signal: ctrl.signal, cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function headline(ms) {
  const j = await ask("/briefing/today?headline=1", ms);
  return j && typeof j.headline === "string" && j.headline.trim() ? j.headline.trim() : null;
}
// a job the writer finished in the last five minutes, its push not yet shown: { id, route, ideaId, title, doneAt }, or null
async function readyJob(ms) {
  const j = await ask("/jobs/ready", ms);
  return j && j.job && typeof j.job.id === "string" ? j.job : null;
}
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    const until = Date.now() + 5000;
    let text = null;
    try { const d = e.data && e.data.text(); if (d) { try { const j = JSON.parse(d); text = j.headline || j.body || null; } catch { text = d; } } } catch { /* an empty push */ }
    if (!text) {
      const job = await readyJob(until - Date.now());
      if (job) {
        const isScript = /^script\./.test(String(job.route || "")) && job.ideaId;
        await self.registration.showNotification(isScript ? "Your script is ready" : "Your ideas are ready", {
          body: (typeof job.title === "string" && job.title.trim()) || (isScript ? "Open it to read it over." : "They're waiting in your Studio."),
          icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "job-" + job.id, renotify: false,
          data: { hash: isScript ? "#/idea/" + encodeURIComponent(job.ideaId) : "#/studio" },
        });
        return;
      }
      text = await headline(Math.max(1500, until - Date.now()));
    }
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
