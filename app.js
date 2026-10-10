// app.js: the shell. Boots the app, keeps her signed in, mounts one view at a time under the tab bar, shows the offline line, and
// lets a new build take over the next time the app comes to the front (design §3.2, §3.16, §3.18, §3.20).
import { APP_NAME, SHORT_NAME, BUILD, API, MOCK } from "./config.js";
import * as store from "./store.js";
import { api, health, event, onAuthLost } from "./api.js";
import { parse, go, onRoute } from "./router.js";
import { h, icon, replace, toast, closeSheet } from "./ui.js";
import { easternDate } from "./shared/time.js";

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

async function render(route) {
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
  let cleanup = null;
  try { cleanup = await mod.default.mount(root, r); }
  catch (e) { console.error(e); bump(e && e.message); root.append(h("p", { class: "muted", text: "Something went wrong showing this page." })); }
  if (seq !== renderSeq) { try { cleanup && cleanup(); } catch { /* */ } return; }
  current = { name: r.name, cleanup };
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

let swReg = null;
function takeWaitingBuild() {
  if (!swReg || !swReg.waiting || !navigator.serviceWorker.controller) return;
  const busy = document.body.dataset.route === "prompter" || (document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName));
  if (!busy) swReg.waiting.postMessage({ type: "SKIP_WAITING" });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  store.emit("front");
  checkHealth();
  dailyOpen();
  if (swReg) { swReg.update().catch(() => {}); takeWaitingBuild(); }
});

async function registerSW() {
  if (!("serviceWorker" in navigator) || new URLSearchParams(location.search).get("sw") === "0") return;
  try {
    swReg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      reloading = true; location.reload();
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
  if (signedIn()) { refreshMe().then(() => { dailyOpen(); }); }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

// a toast for the views that can't import ui.js's directly (the service worker's messages)
navigator.serviceWorker && navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener("message", e => {
  if (e.data && e.data.type === "toast") toast(e.data.text);
  if (e.data && e.data.type === "open" && e.data.hash) go(e.data.hash.replace(/^#/, ""));
});
