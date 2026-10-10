// ui.js: the app's building blocks. Model text is untrusted (design §3.12), so h() only ever sets text (textContent) and attributes
// it is given by this code; nothing here or anywhere in the app writes HTML from data. Links from data go through safeUrl().
export const SVGNS = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ elements
const PROPS = new Set(["value", "checked", "disabled", "selected", "type", "placeholder", "maxLength", "rows", "spellcheck",
  "autocomplete", "inputMode", "min", "max", "step", "name", "id", "htmlFor", "tabIndex", "hidden", "readOnly", "autofocus", "playsInline",
  "muted", "loop", "autoplay", "controls", "src", "alt", "href", "target", "rel", "title", "download", "width", "height", "loading", "decoding",
  "referrerPolicy", "enterKeyHint", "required"]);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = Array.isArray(v) ? v.filter(Boolean).join(" ") : v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) { if (fn) el.addEventListener(ev, fn); }
    else if (k === "style") for (const [p, val] of Object.entries(v)) { if (val != null) el.style.setProperty(p, String(val)); }
    else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) { if (dv != null) el.dataset[dk] = String(dv); }
    else if (k === "href" || k === "src") { const u = k === "href" ? safeUrl(v, true) : safeSrc(v); if (u) el.setAttribute(k, u); }
    else if (PROPS.has(k)) el[k] = v;
    else if (/^on/i.test(k)) continue;                       // never an inline handler
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export function replace(el, ...kids) { clear(el); return add(el, kids); }

// a link from data is used only when it is http(s); in-app links (#/…) are allowed for our own code
export function safeUrl(u, allowHash = false) {
  if (typeof u !== "string" || !u) return null;
  if (allowHash && /^#\//.test(u)) return u;
  if (allowHash && /^(\.\/|blob:)/.test(u)) return u;
  if (allowHash && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("//") && !/^\s/.test(u)) return u;   // our own relative paths
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
}
function safeSrc(u) {
  if (typeof u !== "string" || !u) return null;
  if (/^(blob:|data:image\/)/.test(u)) return u;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("//")) return u;     // a path on this site
  return safeUrl(u);
}
// an outside link opens in the browser (or the platform's app), never inside ours
export function extLink(href, props, ...kids) {
  return h("a", { ...props, href, target: "_blank", rel: "noopener noreferrer" }, ...kids);
}

// ------------------------------------------------------------------ icons (inline SVG, drawn on a 24-px grid)
const I = {
  today: [["circle", { cx: 12, cy: 13, r: 4 }], ["path", { d: "M12 4v2M4.2 13H6M18 13h1.8M6.3 7.3l1.3 1.3M17.7 7.3l-1.3 1.3M3 20h18" }]],
  studio: [["rect", { x: 3, y: 9, width: 18, height: 11, rx: 2 }], ["path", { d: "M3 9 5.5 4.5h15L18 9M9 4.5 7 9M14 4.5 12 9" }]],
  plan: [["path", { d: "M10 6h10M10 12h10M10 18h10M3.5 6l1.3 1.3L7.3 4.8M3.5 12l1.3 1.3 2.5-2.5" }], ["circle", { cx: 5, cy: 18, r: 1.4 }]],
  you: [["circle", { cx: 12, cy: 8, r: 4 }], ["path", { d: "M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" }]],
  back: [["path", { d: "M15 5l-7 7 7 7" }]],
  next: [["path", { d: "M9 5l7 7-7 7" }]],
  close: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
  copy: [["rect", { x: 8.5, y: 8.5, width: 11.5, height: 11.5, rx: 2 }], ["path", { d: "M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" }]],
  check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
  up: [["path", { d: "M7 11v9H4v-9zM7 11l4-8c1.7 0 2.7 1.2 2.4 2.9L13 9h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" }]],
  down: [["g", { transform: "matrix(1 0 0 -1 0 24)" }, [["path", { d: "M7 11v9H4v-9zM7 11l4-8c1.7 0 2.7 1.2 2.4 2.9L13 9h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" }]]]],
  play: [["path", { d: "M8 5.5v13l10.5-6.5z", fill: "currentColor", stroke: "none" }]],
  share: [["path", { d: "M12 3.5v11M8 7.5l4-4 4 4" }], ["path", { d: "M8 10.5H6.5a1.5 1.5 0 0 0-1.5 1.5v7a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" }]],
  addhome: [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 3.5 }], ["path", { d: "M12 8.5v7M8.5 12h7" }]],
  flip: [["path", { d: "M3 7.5h3l2-3h8l2 3h3V19H3z" }], ["path", { d: "M9 13a3 3 0 0 1 5-2.2M15 13a3 3 0 0 1-5 2.2M14 9.5v1.6h-1.6M10 16.5v-1.6h1.6" }]],
  eye: [["path", { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
  eyeoff: [["path", { d: "M4 4l16 16M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17.6 17.6 0 0 1-2.9 3.6M6.4 7.6C3.9 9.4 2.5 12 2.5 12S6 18 12 18c1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2" }]],
  minus: [["path", { d: "M6 12h12" }]],
  plus: [["path", { d: "M12 6v12M6 12h12" }]],
  refresh: [["path", { d: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15" }]],
  ext: [["path", { d: "M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" }]],
  bell: [["path", { d: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" }]],
  sparkle: [["path", { d: "M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" }]],
  alert: [["path", { d: "M12 3.5 2.5 20h19z" }], ["path", { d: "M12 10v4.5M12 17.2v.3" }]],
  offline: [["path", { d: "M3 3l18 18M8.5 8.6A5.5 5.5 0 0 0 7 12.4 4 4 0 0 0 7.5 20H17M20.7 17.3A4 4 0 0 0 18 10.1a6 6 0 0 0-8-4.6" }]],
  more: [["circle", { cx: 5.5, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }], ["circle", { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }], ["circle", { cx: 18.5, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }]],
  trash: [["path", { d: "M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10.5v6M13.5 10.5v6" }]],
  sun: [["circle", { cx: 12, cy: 12, r: 4 }], ["path", { d: "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" }]],
  rain: [["path", { d: "M7 15.5a4 4 0 0 1-.6-7.9A5.5 5.5 0 0 1 17 6.5a4.5 4.5 0 0 1 .5 9" }], ["path", { d: "M9 18.5l-1 2M13 18.5l-1 2M17 18.5l-1 2" }]],
  info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 11v5.5M12 7.8v.4" }]],
  arrowUp: [["path", { d: "M12 19V5.5M6.5 11 12 5.5l5.5 5.5" }]],
  arrowDown: [["path", { d: "M12 5v13.5M6.5 13l5.5 5.5 5.5-5.5" }]],
  arrowFlat: [["path", { d: "M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" }]],
  link: [["path", { d: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" }]],
  calendar: [["rect", { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2.5 }], ["path", { d: "M3.5 10h17M8 3v4M16 3v4" }]],
  send: [["path", { d: "M4 12 20 4l-6 16-3-7z" }], ["path", { d: "M11 13l9-9" }]],
  pencil: [["path", { d: "M14.5 5.5l4 4L8 20H4v-4zM12.5 7.5l4 4" }]],
  download: [["path", { d: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" }]],
  mic: [["rect", { x: 9, y: 3.5, width: 6, height: 11, rx: 3 }], ["path", { d: "M6 11.5a6 6 0 0 0 12 0M12 17.5v3" }]],
  text: [["path", { d: "M4 7V5h16v2M12 5v14M9 19h6" }]],
  house: [["path", { d: "M4 11.5 12 4.5l8 7M6 10v9.5h12V10" }], ["path", { d: "M10 19.5v-5h4v5" }]],
  film: [["rect", { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }], ["path", { d: "M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" }]],
  chat: [["path", { d: "M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5z" }]],
  pause: [["path", { d: "M9 6v12M15 6v12" }]],
};

export function icon(name, size = 22, extra = {}) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", extra.weight || 1.9);
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
  if (extra.class) s.setAttribute("class", extra.class);
  const draw = (parent, list) => {
    for (const [tag, attrs, kids] of list) {
      const e = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (kids) draw(e, kids);
      parent.append(e);
    }
  };
  draw(s, I[name] || I.info);
  return s;
}
export function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}

// ------------------------------------------------------------------ controls
// a button; an icon-only button must carry a label (VoiceOver reads it; the driver checks it)
export function button(label, { kind = "", icon: ic = null, onClick = null, disabled = false, ariaLabel = null, cls = "", type = "button", iconOnly = false, title = null } = {}) {
  const b = h("button", { type, class: ["btn", kind, iconOnly ? "icon-only" : "", cls], disabled, "aria-label": ariaLabel || (iconOnly ? label : null), title });
  if (ic) b.append(icon(ic, iconOnly ? 22 : 19));
  if (!iconOnly && label) b.append(h("span", { text: label }));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
export function iconButton(name, label, onClick, { cls = "", pressed = null } = {}) {
  const b = h("button", { type: "button", class: ["icon-btn", cls], "aria-label": label, title: label });
  if (pressed != null) b.setAttribute("aria-pressed", pressed ? "true" : "false");
  b.append(icon(name, 22));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
export function chip(text, { kind = "", topic = null } = {}) {
  const c = h("span", { class: ["chip", kind, topic ? "topic" : ""] });
  if (topic) { c.style.setProperty("--k", `var(--t-${topic})`); c.append(h("i", { class: "dot", "aria-hidden": "true" })); }
  c.append(text);
  return c;
}
// a choice in a set (modes, areas, tone…): aria-pressed carries the state
export function choice(text, pressed, onClick, { cls = "" } = {}) {
  const b = h("button", { type: "button", class: ["choice", cls], "aria-pressed": pressed ? "true" : "false", text });
  b.addEventListener("click", onClick);
  return b;
}
export function setPressed(b, on) { b.setAttribute("aria-pressed", on ? "true" : "false"); }

// a textarea that grows with its text (every editable line of a script is one)
export function autogrow(ta) {
  const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
  ta.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

export function skeleton(lines = 3, cls = "") {
  const s = h("div", { class: ["skeleton", cls], "aria-hidden": "true" });
  for (let i = 0; i < lines; i++) s.append(h("i", { class: "sk-line" }));
  return s;
}

// a calm notice (writing not switched on, offline, busy…), with an optional action
export function notice(text, { kind = "", action = null, icon: ic = "info", sub = null } = {}) {
  const n = h("div", { class: ["notice", kind], role: kind === "error" ? "alert" : "status" },
    h("span", { class: "notice-ic" }, icon(ic, 20)),
    h("div", { class: "notice-body" }, h("p", { text }), sub ? h("p", { class: "sub", text: sub }) : null));
  if (action) n.append(action);
  return n;
}

// ------------------------------------------------------------------ toast and sheet
let toastTimer = 0;
export function toast(text, { action = null, ms = 2600 } = {}) {
  let t = document.getElementById("toast");
  if (!t) { t = h("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
  replace(t, h("span", { text }));
  if (action) t.append(h("button", { type: "button", class: "toast-btn", text: action.label, on: { click: () => { hide(); action.run(); } } }));
  t.classList.add("on");
  clearTimeout(toastTimer);
  const hide = () => t.classList.remove("on");
  toastTimer = setTimeout(hide, action ? Math.max(ms, 5000) : ms);
}

let openSheet = null;
export function sheet(title, content, { onClose = null, label = null } = {}) {
  closeSheet();
  const prevFocus = document.activeElement;
  const panel = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": label || title || "Details", tabIndex: -1 });
  const head = h("div", { class: "sheet-head" },
    h("span", { class: "sheet-grip", "aria-hidden": "true" }),
    title ? h("h2", { class: "sheet-title", text: title }) : h("span"),
    iconButton("close", "Close", () => closeSheet()));
  panel.append(head, h("div", { class: "sheet-body" }, content));
  const back = h("div", { class: "backdrop", on: { click: () => closeSheet() } });
  document.body.append(back, panel);
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => { back.classList.add("on"); panel.classList.add("on"); panel.focus({ preventScroll: true }); });
  const onKey = e => { if (e.key === "Escape") closeSheet(); };
  document.addEventListener("keydown", onKey);
  openSheet = { panel, back, onKey, onClose, prevFocus };
  return { panel, close: closeSheet };
}
export function closeSheet() {
  if (!openSheet) return;
  const { panel, back, onKey, onClose, prevFocus } = openSheet;
  openSheet = null;
  document.removeEventListener("keydown", onKey);
  document.body.classList.remove("sheet-open");
  panel.classList.remove("on"); back.classList.remove("on");
  const done = () => { panel.remove(); back.remove(); };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) done(); else setTimeout(done, 240);
  if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  if (onClose) onClose();
}

// ------------------------------------------------------------------ the clipboard
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* older Safari: the old way */ }
  try {
    const ta = h("textarea", { value: text, readOnly: true, class: "offscreen" });
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

// ------------------------------------------------------------------ words for numbers and times
export function views(n) {
  if (n == null || isNaN(n)) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M views";
  if (n >= 1e3) return Math.round(n / 1e3) + "K views";
  return n + (n === 1 ? " view" : " views");
}
export function daysAgo(d) {
  if (d == null || isNaN(d)) return "";
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  if (d < 14) return d + " days ago";
  if (d < 60) return Math.round(d / 7) + " weeks ago";
  return Math.round(d / 30) + " months ago";
}
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const hrs = Math.round(m / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
  return daysAgo(Math.round(hrs / 24));
}
export function secs(t) { const s = Math.max(0, Math.round(Number(t) || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

export const PILLARS = ["market", "local", "tips", "listing", "proof", "personal"];
export const PILLAR_LABEL = { market: "Market", local: "Local", tips: "Tips", listing: "Listings", proof: "Proof", personal: "Personal" };
export const FORMAT_LABEL = { "talking-head": "Talking head", "voiceover-broll": "Voiceover + b-roll", walkthrough: "Walk-through",
  "green-screen": "Green screen", "text-on-screen": "Text on screen", street: "Out and about", "duet-stitch": "Duet or stitch" };
export const EFFORT_LABEL = { "5min": "5 min", "15min": "15 min", "30min": "30 min", listing: "At a listing" };
export const PLATFORM_LABEL = { reels: "Reels", tiktok: "TikTok", shorts: "Shorts", facebook: "Facebook" };
export const APPEAR_LABEL = { camera: "On camera", voiceover: "Voiceover", text: "Text only" };
export const STATUS_LABEL = { new: "New", saved: "Saved", scripted: "Scripted", filmed: "Filmed", posted: "Posted", dismissed: "Removed" };

// the chips under an idea's title: format · length · effort · topic
export function ideaChips(idea, { topic = true } = {}) {
  const c = h("div", { class: "chips" });
  if (idea.format) c.append(chip(FORMAT_LABEL[idea.format] || idea.format));
  if (idea.lengthSec) c.append(chip(idea.lengthSec + " s"));
  if (idea.effort) c.append(chip(EFFORT_LABEL[idea.effort] || idea.effort, { kind: "oak" }));
  if (topic && idea.pillar) c.append(chip(PILLAR_LABEL[idea.pillar] || idea.pillar, { kind: "plain", topic: idea.pillar }));
  return c;
}

// a video card: the thumbnail is hidden when it fails (fixture ids are fake; a real one can vanish), YouTube's 120-px grey
// "no thumbnail" image counts as failing too
export function videoCard(v, { compact = false } = {}) {
  if (!v) return null;
  const href = safeUrl(v.url);
  let hsh = 0; for (const ch of String(v.id || v.title || "")) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const thumb = h("span", { class: ["vthumb", "tone" + (hsh % 4)], "aria-hidden": "true" }, h("span", { class: "vplay" }, icon("play", 14)));
  if (v.thumb) {
    const img = h("img", { src: v.thumb, alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove());
    img.addEventListener("load", () => { if (img.naturalWidth && img.naturalWidth < 200) img.remove(); else thumb.classList.add("has-img"); });
    thumb.prepend(img);
  }
  const meta = [views(v.views), v.ageDays != null ? daysAgo(v.ageDays) : ""].filter(Boolean).join(" · ");
  const body = h("span", { class: "vbody" },
    h("span", { class: "vtitle", text: v.title || "Video" }),
    v.channel ? h("span", { class: "vmeta", text: v.channel }) : null,
    meta ? h("span", { class: "vmeta", text: meta }) : null);
  const label = `${v.title || "Video"}${v.channel ? ", " + v.channel : ""}${meta ? ", " + meta : ""}. Opens YouTube.`;
  return href ? extLink(href, { class: ["video", compact ? "compact" : ""], "aria-label": label }, thumb, body)
    : h("div", { class: ["video", compact ? "compact" : ""] }, thumb, body);
}

// a section with its eyebrow
export function section(title, ...kids) {
  const id = "s-" + title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  return h("section", { class: "section", "aria-labelledby": id }, h("h2", { class: "eyebrow", id, text: title }), ...kids);
}

// iPhone Safari outside the home-screen app (the install card, the welcome's step, push's "home screen first")
export function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && !/Chrome\/|Firefox\//.test(ua) && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
}
export function isIOSSafari() {
  const ua = navigator.userAgent || "";
  return isIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV/.test(ua);
}
export function deviceLabel() {
  const ua = navigator.userAgent || "";
  const dev = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Browser";
  const where = isStandalone() ? "Home Screen" : /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? "Chrome" : /Edg/.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Browser";
  return `${dev} · ${where}`;
}
export function reducedMotion() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
