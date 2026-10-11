// push.js: the morning heads-up (design §3.17). She turns it on with a tap (iOS asks for that), the app subscribes with the VAPID
// public key (userVisibleOnly) and posts the subscription and her time; off unsubscribes and tells the Worker. On iPhone it works only
// from the home-screen app (iOS 16.4 and later), so Safari says so instead of offering a switch that can't work.
import { VAPID_PUBLIC, MOCK } from "./config.js";
import { api } from "./api.js";
import * as store from "./store.js";
import { isIOS, isStandalone } from "./ui.js";

function keyBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("no service worker")), 8000))]);

// "ok" · "home" (iPhone Safari: add to the home screen first) · "denied" (she said no; Settings can undo it) · "none" (no push here)
export function support() {
  if (isIOS() && !isStandalone()) return "home";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return MOCK ? "ok" : "none";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}
export function state() { return { on: false, time: "07:00", ...(store.get("push") || {}) }; }

export async function enable(time = "07:00") {
  if (MOCK) {                                   // the driver's Chrome has no push service: pretend the subscription, keep the call
    await api("POST", "/push", { subscription: { endpoint: "https://push.example/mock", keys: { p256dh: "mock", auth: "mock" } }, time });
    store.set("push", { on: true, time }); return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw Object.assign(new Error(perm), { reason: perm === "denied" ? "Notifications are off for Jarvis. Turn them on in Settings › Notifications › Jarvis." : "Notifications weren't allowed this time." });
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  await api("POST", "/push", { subscription: sub.toJSON(), time });
  store.set("push", { on: true, time, endpoint: sub.endpoint });
}

export async function disable() {
  const t = state().time;
  if (!MOCK && "serviceWorker" in navigator) {
    try {
      const reg = await ready();
      const sub = await reg.pushManager.getSubscription();
      if (sub) { try { await api("DELETE", "/push", { endpoint: sub.endpoint }); } catch { /* the cron drops a dead one */ } await sub.unsubscribe(); }
    } catch { /* nothing subscribed here */ }
  } else if (MOCK) { try { await api("DELETE", "/push", { endpoint: "https://push.example/mock" }); } catch { /* */ } }
  store.set("push", { on: false, time: t });
}

// a new time re-posts the same subscription
export async function setTime(time) {
  const s = state();
  store.set("push", { ...s, time });
  if (!s.on) return;
  if (MOCK) { await api("POST", "/push", { subscription: { endpoint: "https://push.example/mock", keys: { p256dh: "mock", auth: "mock" } }, time }); return; }
  const reg = await ready();
  const sub = await reg.pushManager.getSubscription();
  if (sub) await api("POST", "/push", { subscription: sub.toJSON(), time });
}

// refresh(): while the heads-up is on, post the subscription again (once a day, from app.js at launch). A push service can drop a
// subscription quietly; if it's gone, a new one is made (permission is already granted, so no prompt); if permission was taken back
// in Settings, the switch goes off so You doesn't say On for a heads-up that can't come
export async function refresh() {
  const s = state();
  if (!s.on) return;
  if (MOCK) { await api("POST", "/push", { subscription: { endpoint: "https://push.example/mock", keys: { p256dh: "mock", auth: "mock" } }, time: s.time }); return; }
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
  if (Notification.permission !== "granted") { store.set("push", { ...s, on: false }); return; }
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  await api("POST", "/push", { subscription: sub.toJSON(), time: s.time });
  store.set("push", { ...s, endpoint: sub.endpoint });
}
