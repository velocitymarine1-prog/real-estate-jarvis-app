// router.js: hash routes (design §3.2). #/today, #/studio, #/idea/<id>, #/prompter/<id>, #/plan, #/you, and the first run's
// #/welcome, #/code, #/setup/<n>. The invite link's fragment (#invite=K7QM4XD2, never sent to GitHub) is read once at boot.
let handler = null;

export function parse(hash = location.hash) {
  let h = String(hash || "").replace(/^#/, "");
  const inv = /^invite=([^&]*)/.exec(h);
  if (inv) { try { return { name: "invite", code: decodeURIComponent(inv[1]), query: {}, arg: null }; } catch { return { name: "invite", code: inv[1], query: {}, arg: null }; } }
  if (!h.startsWith("/")) h = "/" + h;
  const q = h.indexOf("?");
  const pathPart = q >= 0 ? h.slice(0, q) : h, queryPart = q >= 0 ? h.slice(q + 1) : "";
  const parts = pathPart.split("/").filter(Boolean);
  let arg = null;
  try { arg = parts[1] ? decodeURIComponent(parts[1]) : null; } catch { arg = parts[1] || null; }
  return { name: parts[0] || "", arg, query: Object.fromEntries(new URLSearchParams(queryPart)), path: pathPart };
}

export function link(path, query) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString() : "";
  return "#" + path + (qs ? "?" + qs : "");
}

export function onRoute(fn) {
  handler = fn;
  window.addEventListener("hashchange", () => fn(parse()));
}

// go("/studio", { query, replace }): replace leaves no history entry (the first run's steps, a redirect)
export function go(path, { query = null, replace = false } = {}) {
  const hash = path.startsWith("#") ? path : link(path, query);
  if (replace) {
    history.replaceState(history.state, "", hash);
    if (handler) handler(parse());
  } else if (location.hash === hash) {
    if (handler) handler(parse());
  } else {
    location.hash = hash;
  }
}

// back(to): the page a script or the prompter was opened from (a home-screen app has no back button of its own, and history.back()
// from a link that opened the app would leave it); each tab keeps its scroll, so going back lands where she was
export function back(to = "/today") { go(to); }
