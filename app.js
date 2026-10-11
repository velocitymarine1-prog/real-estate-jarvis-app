// app.js: the shell. Boots the app, keeps her signed in, mounts one view at a time under the tab bar, shows the offline line, and
// lets a new build take over the next time the app comes to the front (design §3.2, §3.16, §3.18, §3.20).
import { APP_NAME, SHORT_NAME, BUILD, API, MOCK } from "./config.js";
import * as store from "./store.js";
import { api, health, event, onAuthLost } from "./api.js";
import { parse, go, onRoute } from "./router.js";
import { h, icon, replace, toast, closeSheet } from "./ui.js";
import { easternDate } from "./shared/time.js";
import * as push from "./push.js";

// ------------------------------------------------------------------ errors are counted on <body> (check-live.sh and the driver read them)
let errors = 0;
const errorLog = [];
function bump(what) { errors++; errorLog.push(String(what).slice(0, 300)); if (document.body) document.body.dataset.errors = String(errors); }
window.addEventListener("error", e => bump(e.message || "error"));
window.addEventListener("unhandledrejection", e => bump((e.reason && (e.reason.stack || e.reason.message)) || "rejection"));
document.addEventListener("securitypolicyviolation", e => bump("CSP " + e.violatedDirective + " " + e.blockedURI));

// ------------------------------------------------------------------ the views
const VIEWS = {
  welcome: { load: () => import("./views/welcome.js"), chrome: "full", open: true },
  code: { load: () => import("./views/invite.js"), chrome: "none", open: true },
  setup: { load: () => import("./views/onboarding.js"), chrome: "none" },
  today: { load: () => import("./views/today.js"), chrome: "tabs", tab: "today", title: "Today" },
  studio: { load: () => import("./views/studio.js"), chrome: "tabs", tab: "studio", title: "Studio" },
  idea: { load: () => import("./views/script.js"), chrome: "sticky", title: "Script" },
  prompter: { load: () => import("./views/prompter.js"), chrome: "full", title: "Prompter" },
  plan: { load: () => import("./views/plan.js"), chrome: "tabs", tab: "plan", title: "Plan" },
  you: { load: () => import("./views/you.js"), chrome: "tabs", tab: "you", title: "You" },
};

const view = document.getElementById("view");
const scrolls = {};
let current = null;          // { name, cleanup }
let renderSeq = 0;

function signedIn() { return !!store.token(); }
function onboarded() { const u = store.live.me && store.live.me.user; return !!(u && (u.onboardedAt || u.onboarded)); }

// where a route may go: not signed in → the gift (with an invite) or the code; signed in but not set up → the five questions
function guard(r) {
  if (r.name === "invite") {
    if (r.code) sessionStorage.setItem("jarvis:invite", r.code);
    return signedIn() ? { name: "today", query: {} } : { name: "welcome", query: {} };
  }
  if (!signedIn()) {
    if (r.name === "welcome" || r.name === "code") return r;
    return { name: sessionStorage.getItem("jarvis:invite") ? "welcome" : "code", query: {} };
  }
  if (!onboarded()) return r.name === "setup" ? r : { name: "setup", arg: "1", query: {} };
  if (r.name === "welcome" || r.name === "code" || r.name === "setup" || !VIEWS[r.name]) return { name: "today", query: r.name === "setup" ? r.query : {} };
  return r;
}

let guarding = false;
async function render(route) {
  // the page on screen may ask first (the prompter, with a take she hasn't saved): if she stays, the address goes back
  if (current && current.canLeave && !guarding) {
    const here = current.hash;
    guarding = true;
    let ok = true;
    try { ok = await current.canLeave(); } catch { ok = true; } finally { guarding = false; }
    if (!ok) { if (here && location.hash !== here) history.replaceState(history.state, "", here); return; }
    current.canLeave = null;
  }
  const seq = ++renderSeq;
  let r = guard(route);
  if (r !== route) {
    const hash = "#/" + r.name + (r.arg ? "/" + encodeURIComponent(r.arg) : "") + (r.query && Object.keys(r.query).length ? "?" + new URLSearchParams(r.query) : "");
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
    r = parse(hash);
  }
  const spec = VIEWS[r.name];
  closeSheet();
  if (current) {
    if (VIEWS[current.name] && VIEWS[current.name].tab) scrolls[current.name] = window.scrollY;
    try { current.cleanup && current.cleanup(); } catch (e) { console.error(e); }
    current = null;
  }
  document.body.classList.toggle("no-tabs", spec.chrome === "none");
  document.body.classList.toggle("sticky-bar", spec.chrome === "sticky");
  document.body.classList.toggle("full", spec.chrome === "full");
  document.body.dataset.route = r.name;
  for (const a of document.querySelectorAll(".tabbar a")) {
    if (a.dataset.tab === (spec.tab || (r.name === "idea" ? r.query.from : ""))) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = spec.title ? `${spec.title} · ${SHORT_NAME}` : APP_NAME;
  let mod;
  try { mod = await spec.load(); }
  catch (e) {
    if (seq !== renderSeq) return;
    replace(view, h("div", { class: "empty" }, icon("offline", 36), h("p", { text: "Couldn't open this page. Check your connection and try again." }),
      h("button", { type: "button", class: "btn", text: "Try again", on: { click: () => location.reload() } })));
    return;
  }
  if (seq !== renderSeq) return;
  replace(view);
  const root = h("div", { class: "view-root view-" + r.name });
  view.append(root);
  let cleanup = null, canLeave = null;
  try {
    const m = await mod.default.mount(root, r);
    if (typeof m === "function") cleanup = m; else if (m) { cleanup = m.cleanup || null; canLeave = m.canLeave || null; }
  }
  catch (e) { console.error(e); bump(e && e.message); root.append(h("p", { class: "muted", text: "Something went wrong showing this page." })); }
  if (seq !== renderSeq) { try { cleanup && cleanup(); } catch { /* */ } return; }
  current = { name: r.name, cleanup, canLeave, hash: location.hash };
  window.scrollTo(0, spec.tab && scrolls[r.name] ? scrolls[r.name] : 0);
  if (route.name !== r.name || !current) view.focus({ preventScroll: true });
  store.emit("routed", r);
}

// ------------------------------------------------------------------ the offline line
function fmtClock(ms) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms)).replace(" AM", " am").replace(" PM", " pm"); }
  catch { return ""; }
}
function netbar() {
  const bar = document.getElementById("netbar");
  const off = !store.live.online, unreachable = store.live.lastNetError;
  if (!off && !unreachable) { bar.hidden = true; document.body.classList.remove("offline"); return; }
  const at = store.get("lastSync");
  const when = at ? ` · showing what loaded at ${fmtClock(at)}` : "";
  replace(bar, icon("offline", 18), h("span", { text: (off ? "You're offline" : "Can't reach Jarvis right now") + when }));
  bar.hidden = false;
  document.body.classList.toggle("offline", off);
}
window.addEventListener("online", () => { store.live.online = true; store.emit("online", true); netbar(); });
window.addEventListener("offline", () => { store.live.online = false; store.emit("online", false); netbar(); });
store.on("online", netbar);
store.on("net", netbar);

// ------------------------------------------------------------------ coming to the front: refresh, and take a waiting build
let lastHealth = 0;
async function checkHealth(force = false) {
  if (!force && Date.now() - lastHealth < 10 * 60 * 1000) return;
  lastHealth = Date.now();
  try { await health(); } catch { /* the cached answer stands */ }
}
async function refreshMe() {
  if (!signedIn()) return;
  if (store.live.me && store.live.me._dirtyProfile) return;     // her change made offline goes up first (sendUnsaved)
  try {
    const r = await api("GET", "/me");
    if (r && r.user) store.setMe(r);
  } catch { /* the cached profile stands */ }
}
function dailyOpen() {
  if (!signedIn() || !onboarded()) return;
  const today = easternDate();
  if (store.get("openedOn") !== today) { store.set("openedOn", today); event("open"); }
}

// edits made offline (marked on the phone by the script page) go up when the phone is back: at launch, on reconnect, at the front
let sending = false;
async function sendUnsaved() {
  if (sending || !signedIn() || !navigator.onLine) return;
  sending = true;
  try {
    const me = store.live.me;
    if (me && me._dirtyProfile && me.user) {
      try {
        const res = await api("PUT", "/me", { name: me.user.name || undefined, profile: me.user.profile || {} });
        if (res && res.user) store.setMe(res);
      } catch (e) {
        if (e.kind === "bad_field") store.setMe({ ...me, _dirtyProfile: false });      // You names the field when she opens it
        else return;
      }
    }
    for (const r of store.dirtyRows()) {
      if (r.id === store.live.editing || !r.script) continue;        // the open script page sends its own
      try {
        const res = await api("PATCH", `/ideas/${encodeURIComponent(r.id)}`, { script: r.script });
        if (res && res.idea) store.saveIdea(res.idea, { clean: true });
      } catch (e) {
        if (e.status === 404) store.dropIdea(r.id);
        else if (e.kind === "too_big") continue;                      // she shortens it on the script page
        else break;                                                    // offline again, or the Worker is busy: next time
      }
    }
  } finally { sending = false; }
}
window.addEventListener("online", () => { setTimeout(sendUnsaved, 300); });

// the morning heads-up: the subscription is posted again once a day while it's on (a push service can drop one quietly; the
// Worker keeps one row per endpoint), so You's switch never says On for a heads-up that stopped
function refreshPush() {
  if (!signedIn() || !push.state().on) return;
  const today = easternDate();
  if (store.get("pushRefreshedOn") === today) return;
  push.refresh().then(() => store.set("pushRefreshedOn", today)).catch(() => {});
}

// a new build: it installs in the background, and takes over the next time the app comes to the front (or at once if the app is in
// the back already). The page reloads on any takeover it asked for, so it never runs one build's code with the next one's files
let swReg = null, askedSkip = false;
function takeWaitingBuild() {
  if (!swReg || !swReg.waiting || !navigator.serviceWorker.controller) return;
  const busy = document.body.dataset.route === "prompter" || (document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName));
  if (busy) return;
  askedSkip = true;
  swReg.waiting.postMessage({ type: "SKIP_WAITING" });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") { if (swReg && swReg.waiting) takeWaitingBuild(); return; }
  store.emit("front");
  checkHealth();
  dailyOpen();
  sendUnsaved();
  if (swReg) { swReg.update().catch(() => {}); takeWaitingBuild(); }
});

async function registerSW() {
  if (!("serviceWorker" in navigator) || new URLSearchParams(location.search).get("sw") === "0") return;
  try {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!askedSkip || reloading) return;          // the first install claiming the page is the same build: nothing to reload
      reloading = true; location.reload();
    });
    swReg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
    swReg.addEventListener("updatefound", () => {
      const w = swReg.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed" && document.visibilityState === "hidden") takeWaitingBuild(); });
    });
  } catch (e) { console.warn("service worker", e && e.message); }
}

// ------------------------------------------------------------------ boot
function tabIcons() {
  for (const s of document.querySelectorAll(".tabbar .ti")) s.replaceWith(icon(s.dataset.icon, 26));
}

onAuthLost(async () => {
  await store.signOutHere();
  sessionStorage.setItem("jarvis:signedOut", "1");
  go("/code", { replace: true });
});

async function boot() {
  tabIcons();
  netbar();
  window.__jarvis = { store, api, go, BUILD, API, MOCK, errors: () => errors, errorLog };
  onRoute(render);
  if (MOCK) { try { await (await import("./mock.js")).prime(); } catch (e) { console.error("mock", e); } }
  // the invite in the address (from Isaac's card): keep it for the welcome and the code screen, out of the address bar
  const first = parse();
  await render(first.name ? first : { name: "today", query: {}, arg: null });
  document.body.dataset.booted = "1";
  registerSW();
  checkHealth(true);
  if (signedIn()) { refreshMe().then(() => { dailyOpen(); }); sendUnsaved(); refreshPush(); }
  window.__jarvis.sendUnsaved = sendUnsaved;
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

// a toast for the views that can't import ui.js's directly (the service worker's messages)
navigator.serviceWorker && navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener("message", e => {
  if (e.data && e.data.type === "toast") toast(e.data.text);
  if (e.data && e.data.type === "open" && e.data.hash) go(e.data.hash.replace(/^#/, ""));
});
