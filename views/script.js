// script.js: the script page, #/idea/<id> (design §3.4). Title, chips and the version switch; the hook, the beats as a timeline, the
// call to action, the caption and hashtags with Copy, the audio, the shot list she ticks, the check (§3.13) with one-tap fixes and its
// standing note, references with the three searches, the tweak chips, and a sticky bar: Prompter, Copy script, the status.
// Every line is editable; edits are saved (PATCH, debounced) and the check runs again as she types, in the browser, with the same
// module the Worker uses (shared/compliance.js and data/fair-housing.json).
import * as store from "../store.js";
import { api, write, followJob, writerNote, event, SENTENCES } from "../api.js";
import { go, link } from "../router.js";
import {
  h, icon, replace, button, iconButton, chip, choice, notice, sheet, closeSheet, toast, skeleton, ideaChips, autogrow, copyText,
  videoCard, extLink, safeUrl, secs, STATUS_LABEL, setPressed,
} from "../ui.js";
import { searchLinks } from "../shared/links.js";
import { TWEAKS, TWEAK_LABELS } from "../shared/models.js";
import { checker } from "../rules.js";

const PLAN_STATUSES = ["saved", "scripted", "filmed", "posted"];
// scripts being written, by idea: one wait each, however often the page is opened (leaving and coming back finds it here; after a
// reload, the phone's list of jobs, contract §8.3). A version that lands is kept on the phone even if the page has gone.
const writing = new Map();          // idea id → { promise, base, note, listeners }
function startWriting(ideaId, base, start) {
  const w = { base, note: null, listeners: new Set() };
  const onState = s => {
    const note = writerNote(s.writer);
    if (note !== w.note) { w.note = note; for (const fn of w.listeners) fn(); }
  };
  w.promise = start(onState)
    .then(r => { if (r && r.idea) store.saveIdea(r.idea, { clean: true }); return r; })
    .finally(() => { if (writing.get(ideaId) === w) writing.delete(ideaId); });
  writing.set(ideaId, w);
  return w;
}
const STANDING = "This catches common problems. It isn't legal advice, and your broker's rules come first.";
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

export default {
  async mount(root, route) {
    const id = route.arg;
    const from = ["today", "studio", "plan"].includes(route.query.from) ? route.query.from : "studio";
    const st = { row: store.ideaOrBriefing(id), work: null, findings: [], C: null, R: null, writing: null, error: null, refs: null, refsErr: false,
      dirty: false, savingP: null, tooBig: false, saveNote: "", gone: false, unreachable: false };
    store.live.editing = id;                       // app.js leaves this idea's unsaved edits to this page
    let alive = true;
    const timers = {};
    const els = {};

    const current = row => (row && row.current >= 0 && row.versions && row.versions[row.current] ? row.versions[row.current].script : row && row.script) || null;

    // ---------------------------------------------------------------- the whole page
    function drawAll() {
      if (!alive) return;
      const y = window.scrollY;
      const row = st.row;
      if (!row) {
        replace(root, backLink(),
          st.gone ? h("div", { class: "empty" }, icon("info", 34), h("p", { text: "This idea isn't here anymore. It may have been removed on another phone." }),
            h("a", { class: "btn lake", href: "#/" + from, text: "Back" }))
          : st.unreachable ? h("div", { class: "empty" }, icon("offline", 34), h("p", { text: "Couldn't open this idea just now. Check your connection and try again." }),
            button("Try again", { kind: "lake", icon: "refresh", onClick: () => location.reload() }))
          : h("div", { class: "stack", "aria-busy": "true" }, skeleton(3), skeleton(6)));
        if (els.bar) replace(els.bar);
        return;
      }
      const idea = row.idea || {};
      const s = st.work;
      replace(root,
        backLink(),
        h("header", { class: "script-head" },
          h("h1", { class: "sr-only", text: (s && s.title) || idea.title || "Script" }),
          versions(),
          s ? field(() => s.title || idea.title, v => { s.title = v; }, { cls: "title", label: "Title" }) : h("h1", { class: "edit title", text: idea.title || "An idea" }),
          ideaChips({ ...idea, lengthSec: (s && s.lengthSec) || idea.lengthSec }),
          els.save = h("p", { class: "save-state", "aria-live": "polite", text: st.saveNote }),
          s && s.notes && s.notes.length ? h("ul", { class: "script-notes" }, s.notes.map(n => h("li", { text: n }))) : null),
        st.writing ? (els.writing = h("div", { class: "part writing-part" }, writingNotice(), s ? null : skeleton(6))) : null,
        st.error ? h("div", { class: "part" }, notice(st.error.reason, { kind: st.error.kind === "declined" ? "warn" : "error", icon: "info",
          action: ["busy", "network", "other"].includes(st.error.kind) ? button("Try again", { kind: "lake", icon: "refresh", onClick: () => (st.error.retry || writeScript)() }) : null })) : null,
        s ? scriptParts(s) : noScript(),
      );
      drawBar();
      if (y) window.scrollTo(0, y);
    }
    // what's being written, or (the Mac's writer away) why it waits; changed in place, so the page under it stays as it is
    function writingNotice() { return notice(st.writing, { icon: st.writingAway ? "info" : "sparkle", kind: "calm" }); }
    function updateWriting() {
      if (!alive) return;
      if (els.writing && els.writing.isConnected) replace(els.writing, writingNotice(), st.work ? null : skeleton(6));
      else drawAll();
    }
    function backLink() {
      const label = from === "today" ? "Today" : from === "plan" ? "Plan" : "Studio";
      const a = h("a", { class: "back", href: "#/" + from }, icon("back", 20), h("span", { text: label }));
      a.addEventListener("click", () => flush());
      return a;
    }

    // a line she can edit: a textarea that grows with its text; typing re-runs the check, and the line is saved after a pause
    function field(get, set, { cls = "", label = "", rows = 1, onInput = null } = {}) {
      const ta = h("textarea", { class: ["edit", cls], rows, value: get() == null ? "" : String(get()), "aria-label": label, spellcheck: true, readOnly: !!st.writing });
      autogrow(ta);
      ta.addEventListener("input", () => { set(ta.value); if (onInput) onInput(ta.value); changed(); });
      ta.addEventListener("blur", () => flush());
      return ta;
    }
    function kv(label, get, set, cls = "small") {
      return h("div", { class: "k" }, h("span", { text: label }), field(get, set, { cls, label }));
    }

    // ---------------------------------------------------------------- no script yet: the idea, and Write script
    function noScript() {
      const idea = st.row.idea || {};
      const parts = [h("div", { class: "part card stack" },
        idea.hook ? h("q", { class: "say-quote", text: idea.hook }) : null,
        idea.why ? h("p", { class: "muted", text: "Why now: " + idea.why }) : null)];
      if (!st.writing) {
        const why = store.aiOff() ? SENTENCES.not_connected : !store.live.online ? "You're offline. Writing needs a connection." : null;
        if (why) parts.push(h("div", { class: "part" }, notice(why, { kind: "calm", icon: store.aiOff() ? "info" : "offline",
          sub: "You can still save this idea, or read the hook in the prompter." })));
        const b = button("Write script", { kind: "primary", cls: "block big", icon: "sparkle", onClick: writeScript, disabled: !!why });
        b.setAttribute("data-act", "write-script");
        parts.push(h("div", { class: "part" }, b));
      }
      return parts;
    }

    // ---------------------------------------------------------------- the script
    function scriptParts(s) {
      s.hook = s.hook || { say: "", onScreen: "", shot: "" };
      s.beats = s.beats || []; s.cta = s.cta || { say: "", onScreen: "" }; s.hashtags = s.hashtags || []; s.audio = s.audio || { suggestion: "", note: "" };
      s.shotList = s.shotList || [];
      const out = [];
      out.push(part("Hook · first 3 seconds", h("div", { class: "beats" }, h("div", { class: "beat" },
        h("span", { class: "t", text: "0:00" }),
        h("div", { class: "lines" },
          field(() => s.hook.say, v => { s.hook.say = v; }, { cls: "say", label: "Hook: what you say" }),
          kv("On screen", () => s.hook.onScreen, v => { s.hook.onScreen = v; }),
          kv("Shot", () => s.hook.shot, v => { s.hook.shot = v; }))))));
      out.push(part("Beats", h("div", { class: "beats" }, s.beats.map((b, i) => h("div", { class: "beat" },
        h("span", { class: "t", text: secs(b.t) }),
        h("div", { class: "lines" },
          field(() => b.say, v => { b.say = v; }, { cls: "say", label: `Beat at ${secs(b.t)}: what you say` }),
          kv("On screen", () => b.onScreen, v => { b.onScreen = v; }),
          kv("Shot", () => b.shot, v => { b.shot = v; })))))));
      out.push(part("Call to action", h("div", { class: "beats" }, h("div", { class: "beat" },
        h("span", { class: "t", text: s.lengthSec ? secs(Math.max(0, s.lengthSec - 4)) : "End" }),
        h("div", { class: "lines" },
          field(() => s.cta.say, v => { s.cta.say = v; }, { cls: "say", label: "Call to action: what you say" }),
          kv("On screen", () => s.cta.onScreen, v => { s.cta.onScreen = v; }))))));
      out.push(part("Caption", field(() => s.caption, v => { s.caption = v; }, { cls: "caption-box", rows: 4, label: "Caption" }),
        button("Copy", { kind: "ghost", icon: "copy", ariaLabel: "Copy the caption", onClick: () => copy(s.caption || "", "Caption copied") })));
      out.push(part("Hashtags", field(() => (s.hashtags || []).join(" "), v => { s.hashtags = tags(v); }, { cls: "small", label: "Hashtags" }),
        button("Copy all", { kind: "ghost", icon: "copy", ariaLabel: "Copy all the hashtags", onClick: () => copy((s.hashtags || []).join(" "), "Hashtags copied") })));
      out.push(part("Audio", h("div", { class: "stack" },
        field(() => s.audio.suggestion, v => { s.audio.suggestion = v; }, { cls: "say", label: "Audio suggestion" }),
        s.audio.note != null ? field(() => s.audio.note, v => { s.audio.note = v; }, { cls: "small", label: "Audio note" }) : null,
        h("p", { class: "small muted", text: "On a business account, use your own audio or a sound marked for business use (TikTok's Commercial Music Library, Instagram's royalty-free sounds)." }))));
      if (s.shotList.length) out.push(part("Shot list", shotList(s)));
      out.push(els.check = h("section", { class: "part", "aria-labelledby": "h-check" }));
      drawCheck();
      const used = (st.row.facts || []).filter(f => (s.factsUsed || []).includes(f.id));
      if (used.length) out.push(part("Based on", h("ul", { class: "facts-used" }, used.map(f => h("li", {}, h("b", { text: f.source ? f.source + ": " : "" }), f.text)))));
      out.push(els.refs = h("section", { class: "part", "aria-labelledby": "h-refs" }));
      drawRefs();
      out.push(tweaks());
      return out;
    }
    function part(title, body, action = null) {
      const hid = "h-" + title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
      return h("section", { class: "part", "aria-labelledby": hid },
        h("h2", { class: "eyebrow", id: hid }, h("span", { text: title }), action),
        h("div", { class: "card" }, body));
    }
    function tags(v) {
      return String(v || "").split(/[\s,]+/).map(t => t.trim()).filter(Boolean).map(t => (t.startsWith("#") ? t : "#" + t)).slice(0, 10);
    }
    function shotList(s) {
      const v = st.row.versions && st.row.versions[st.row.current];
      const ticks = (v && Array.isArray(v.shots) ? v.shots : Array.isArray(st.row.shots) ? st.row.shots : []).slice();
      return h("ul", { class: "shots" }, s.shotList.map((txt, i) => {
        const cb = h("input", { type: "checkbox", checked: !!ticks[i], "aria-label": txt });
        const li = h("li", {}, h("label", { class: ["shot", ticks[i] ? "done" : ""] }, cb, h("span", { text: txt })));
        cb.addEventListener("change", async () => {
          ticks[i] = cb.checked;
          li.firstChild.classList.toggle("done", cb.checked);
          const all = s.shotList.map((_, k) => !!ticks[k]);
          try { const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, { shots: all }); if (r && r.idea) { st.row = { ...st.row, shots: r.idea.shots, versions: st.row._dirty ? st.row.versions : r.idea.versions }; store.saveIdea({ ...r.idea }); } }
          catch (e) { toast(e.kind === "offline" ? "You're offline: the tick will be lost. Try again when you're back." : e.reason); }
        });
        return li;
      }));
    }

    // ---------------------------------------------------------------- the check (§3.13)
    function ctx() {
      const p = store.profile();
      const v = st.row.versions && st.row.versions[st.row.current];
      return { rules: st.R, brokerage: p.brokerage || "", supplied: st.row.supplied || [], facts: st.row.facts || [], userText: st.row._userText || "",
        remixCaption: (st.row.remixOf && st.row.remixOf.caption) || "", lang: v && /spanish|espa/i.test(v.label || "") ? "es" : "en" };
    }
    function runCheck() {
      if (st.C && st.C.checkScript && st.R && st.work) {
        try { st.findings = st.C.checkScript(st.work, ctx()) || []; return; } catch (e) { console.warn("check", e); }
      }
      st.findings = st.row.check || [];
    }
    function drawCheck() {
      if (!els.check) return;
      runCheck();
      const f = st.findings.slice().sort((a, b) => (a.severity === "amber" ? 0 : 1) - (b.severity === "amber" ? 0 : 1));
      const body = h("div", { class: "card" });
      if (!f.length) body.append(h("p", { class: "ready", "data-check": "ready" }, h("span", { class: "ic", "aria-hidden": "true" }, icon("check", 16, { weight: 3 })), "Ready to post"));
      else body.append(h("ul", { class: "check-list" }, f.map(x => {
        const li = h("li", { class: ["finding", x.severity === "amber" ? "amber" : "note"], "data-rule": x.rule },
          h("span", { class: "ic", "aria-hidden": "true", text: x.severity === "amber" ? "!" : "i" }),
          h("span", { class: "txt", text: x.text }));
        if (x.fix && x.fix.label) {
          const b = button(x.fix.label, { kind: "ghost", cls: "fix wrap", onClick: () => applyFix(x) });
          b.setAttribute("data-act", "fix"); b.setAttribute("data-rule", x.rule);
          if ((x.fix.kind === "tweak" && (store.aiOff() || !store.live.online)) || st.writing) b.disabled = true;
          li.append(b);
        }
        if (x.why) li.append(h("details", { class: "why" }, h("summary", { text: "Why" }), h("p", { text: x.why })));
        return li;
      })));
      body.append(h("p", { class: "standing", text: STANDING }));
      replace(els.check, h("h2", { class: "eyebrow", id: "h-check" }, h("span", { text: "Check" }),
        f.length ? h("span", { class: "chip amber", text: `${f.filter(x => x.severity === "amber").length || f.length} to look at` }) : null), body);
    }
    async function applyFix(f) {
      if (f.fix.kind === "tweak") { await tweak(f.fix.tweak || "rewrite", f.fix.note || undefined); return; }
      if (!st.C || !st.C.applyFix) { toast("Edit the line above to fix it."); return; }
      try {
        st.work = st.C.applyFix(st.work, f);
        st.dirty = true;
        drawAll();
        toast("Fixed");
        await flush();
      } catch (e) { console.warn(e); toast("Couldn't fix that one by itself. Edit the line above."); }
    }

    // ---------------------------------------------------------------- references
    async function loadRefs() {
      const q = (st.row && st.row.idea && (st.row.idea.referenceQuery || st.row.idea.title)) || "";
      if (!q || st.refs) return;
      try { st.refs = await api("GET", "/references?q=" + encodeURIComponent(q), undefined, { timeout: 20000 }); st.refsErr = false; }
      catch { st.refsErr = true; }
      drawRefs();
    }
    function drawRefs() {
      if (!els.refs) return;
      const q = (st.row.idea && (st.row.idea.referenceQuery || st.row.idea.title)) || "";
      const L = (st.refs && st.refs.links) || searchLinks(q);
      const vids = (st.refs && st.refs.videos) || [];
      const card = h("div", { class: "card stack" });
      if (vids.length) card.append(h("div", { class: "videos grid" }, vids.slice(0, 6).map(v => videoCard(v))));
      else if (!st.refs && !st.refsErr) card.append(h("div", { class: "videos grid", "aria-busy": "true" }, [0, 1].map(() => h("span", { class: "sk-block", style: { height: "150px" } }))));
      card.append(h("p", { class: "small muted", text: `Search “${q}” on:` }),
        h("div", { class: "search-btns" },
          extLink(L.tiktok, { class: "btn ghost", "aria-label": "Search TikTok for " + q, "data-act": "search-tiktok" }, "TikTok"),
          extLink(L.instagram, { class: "btn ghost", "aria-label": "Search Instagram for " + q, "data-act": "search-instagram" }, "Instagram"),
          extLink(L.youtube, { class: "btn ghost", "aria-label": "Search YouTube for " + q, "data-act": "search-youtube" }, "YouTube")));
      replace(els.refs, h("h2", { class: "eyebrow", id: "h-refs", text: "References" }), card);
    }

    // ---------------------------------------------------------------- versions and tweaks
    function versions() {
      const v = (st.row && st.row.versions) || [];
      if (v.length < 2) return null;
      const box = h("div", { class: "versions", role: "group", "aria-label": "Versions" },
        h("span", { class: "vlabel", text: `v${st.row.current + 1} of ${v.length}` }));
      v.forEach((ver, i) => box.append(choice(ver.label || `Version ${i + 1}`, i === st.row.current, () => switchVersion(i), { cls: "small-choice" })));
      return h("div", { class: "scroller" }, box);
    }
    async function switchVersion(i) {
      if (i === st.row.current || st.writing) return;
      await flush();
      try {
        const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, { current: i });
        if (r && r.idea) setRow(r.idea, true);
      } catch (e) { toast(e.reason); }
    }
    function tweaks() {
      const off = store.aiOff() || !store.live.online || !!st.writing;
      const list = TWEAKS.filter(t => t !== "rewrite");
      const box = h("div", { class: "tweaks" }, list.map(t => {
        const b = h("button", { type: "button", class: "choice", text: TWEAK_LABELS[t] || t, disabled: off, "data-tweak": t });
        b.addEventListener("click", () => (t === "note" ? noteSheet() : tweak(t)));
        return b;
      }));
      return h("section", { class: "part", "aria-labelledby": "h-tweak" },
        h("h2", { class: "eyebrow", id: "h-tweak", text: "Make another version" }),
        box,
        store.aiOff() ? h("p", { class: "small muted", text: SENTENCES.not_connected }) : h("p", { class: "small muted", text: "Each one is a new version; up to five are kept, and you can switch back." }));
    }
    function noteSheet() {
      const inp = h("input", { class: "input", type: "text", maxLength: 200, placeholder: "e.g. mention the farmers market", "aria-label": "Your note", enterKeyHint: "go" });
      const goBtn = button("Rewrite it", { kind: "primary", cls: "block", onClick: () => { const n = inp.value.trim(); if (!n) { toast("Type a note first."); return; } closeSheet(); tweak("note", n); } });
      inp.addEventListener("keydown", e => { if (e.key === "Enter") goBtn.click(); });
      sheet("Your own note", h("div", { class: "stack" }, h("p", { class: "muted", text: "One line on what to change. Jarvis rewrites the script with it." }), inp, goBtn));
      setTimeout(() => inp.focus(), 260);
    }
    const tweakLine = label => `Jarvis is writing the “${label}” version… usually 15–30 seconds`;
    const SCRIPT_LINE = "Writing the script… usually 15–30 seconds";
    async function tweak(t, note) {
      if (st.writing) return;
      await flush();
      const label = TWEAK_LABELS[t] || t;
      const w = writing.get(id) || startWriting(id, tweakLine(label), onState =>
        write("POST", `/ideas/${encodeURIComponent(id)}/script`, note ? { tweak: t, note } : { tweak: t }, { onState, meta: { kind: "script", ideaId: id, label, tweak: t } }));
      const waited = waitOn(w, { done: () => toast(`New version: ${label}`), retry: () => tweak(t, note) });
      window.scrollTo({ top: 0, behavior: "smooth" });
      await waited;
    }
    function writeScript() {
      if (st.writing) return;
      const w = writing.get(id) || startWriting(id, SCRIPT_LINE, onState =>
        write("POST", `/ideas/${encodeURIComponent(id)}/script`, {}, { onState, meta: { kind: "script", ideaId: id } }));
      return waitOn(w, { done: () => event("script"), retry: writeScript });
    }
    // the page waits on a script being written (asked for here, before she left and came back, or before a reload)
    async function waitOn(w, { done, retry }) {
      const show = () => {
        const text = w.note || w.base;
        if (text === st.writing) return;
        st.writing = text; st.writingAway = !!w.note; updateWriting();
      };
      st.writing = w.note || w.base; st.writingAway = !!w.note; st.error = null;
      w.listeners.add(show);
      drawAll();
      try {
        const r = await w.promise;
        st.writing = null;
        if (!alive) return;
        if (r && r.idea) { setRow(r.idea, true); if (done) done(); } else drawAll();
      } catch (e) {
        st.writing = null;
        if (!alive) return;
        st.error = e.kind === "aborted" ? null : Object.assign(e, { retry });
        drawAll();
      } finally { w.listeners.delete(show); }
    }
    // a script for this idea still being written: in this phone's memory, or a job on its list
    function resumeWriting() {
      if (st.writing) return true;
      const w = writing.get(id);
      if (w) { waitOn(w, { retry: writeScript }); return true; }
      const open = store.jobs().find(j => j.kind === "script" && j.ideaId === id);
      if (!open) return false;
      const retry = !open.tweak ? writeScript : open.tweak === "note" ? noteSheet : () => tweak(open.tweak);
      waitOn(startWriting(id, open.label ? tweakLine(open.label) : SCRIPT_LINE, onState => followJob(open.id, { onState })), { retry });
      return true;
    }

    // ---------------------------------------------------------------- saving
    function changed() {
      st.dirty = true; st.tooBig = false;
      clearTimeout(timers.check); timers.check = setTimeout(drawCheck, 220);
      clearTimeout(timers.save); timers.save = setTimeout(flush, 1400);
      setSave("Editing…");
    }
    function setSave(t) { st.saveNote = t; if (els.save) els.save.textContent = t; }
    // flush(): the edits so far to the server. A save already on its way is waited for, then what changed since goes after it, so
    // whatever follows (the prompter, a version switch, a tweak, the status) sees every edit. A save that fails keeps the edit on the
    // phone, marked, for app.js to send again when the phone is back online.
    function flush() {
      clearTimeout(timers.save);
      if (st.savingP) return st.savingP.then(() => flush());
      if (!st.dirty || !st.work) return Promise.resolve();
      st.dirty = false;
      setSave("Saving…");
      const sent = clone(st.work);
      st.savingP = (async () => {
        try {
          const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, { script: sent });
          if (r && r.idea) { store.saveIdea(r.idea, { clean: true }); st.row = { ...store.idea(id), _userText: st.row._userText }; }
          setSave(st.dirty ? "Editing…" : "All changes saved");
        } catch (e) {
          st.dirty = true;
          if (e.kind === "too_big") { st.tooBig = true; setSave("Not saved: that script is too long to save. Shorten it, and it saves."); }
          else setSave(e.kind === "offline" ? "Not saved yet: you're offline. It saves when you're back." : "Not saved yet. " + (e.reason || ""));
          // the edit stays on this phone, marked: the prompter and Copy have it, and it's sent again when the phone is back online
          store.markDirty(id, clone(st.work), st.row);
          st.row = { ...(store.idea(id) || st.row), _userText: st.row._userText };
        }
      })().finally(() => {
        st.savingP = null;
        if (alive && st.dirty && store.live.online && !st.tooBig) { clearTimeout(timers.save); timers.save = setTimeout(flush, 3000); }
      });
      return st.savingP;
    }
    function setRow(row, redraw) {
      st.row = { ...row, _userText: (st.row && st.row._userText) || row._userText };
      store.saveIdea(row, { clean: true });         // a new version or a switch replaces the script on purpose
      st.work = clone(current(row));
      if (redraw) drawAll();
    }

    // ---------------------------------------------------------------- the sticky bar
    function drawBar() {
      if (!alive) return;
      if (!els.bar) els.bar = h("div", { class: "sticky" });
      if (!els.bar.isConnected) document.body.append(els.bar);
      const row = st.row;
      if (!row) { replace(els.bar); return; }
      const hasScript = !!st.work;
      const prompter = button("Prompter", { kind: "primary", icon: "film", disabled: !hasScript && !(row.idea && row.idea.hook), onClick: async () => { await flush(); go("/prompter/" + id, { query: { from } }); } });
      prompter.setAttribute("data-act", "prompter");
      const copyBtn = button("Copy", { kind: "ghost", icon: "copy", ariaLabel: "Copy the whole script", disabled: !hasScript, onClick: () => copy(asText(st.work, row.idea), "Script copied") });
      copyBtn.setAttribute("data-act", "copy-script");
      const status = statusButton(row);
      if (st.writing) status.disabled = true;
      replace(els.bar, h("div", { class: "in" }, prompter, copyBtn, status));
    }
    function statusButton(row) {
      const s = row.status;
      const inPlan = PLAN_STATUSES.includes(s);
      const b = button(inPlan ? STATUS_LABEL[s] : "Save", { kind: inPlan ? "" : "lake", icon: inPlan ? "next" : null, onClick: () => (inPlan ? statusSheet() : setStatus("saved")) });
      b.setAttribute("data-act", "status"); b.setAttribute("data-status", s);
      b.setAttribute("aria-label", inPlan ? `Status: ${STATUS_LABEL[s]}. Change it` : "Save to your Plan");
      if (inPlan) { b.classList.add("status-btn"); b.append(b.firstChild); }
      return b;
    }
    function statusSheet() {
      const row = st.row;
      const list = h("div", { class: "choices", role: "group", "aria-label": "Move to" });
      for (const s of PLAN_STATUSES) {
        const c = choice(STATUS_LABEL[s], row.status === s, () => { closeSheet(); s === "posted" ? postedSheet() : setStatus(s); });
        c.setAttribute("data-status", s);
        if (s === "scripted" && !st.work) c.disabled = true;
        list.append(c);
      }
      sheet("Where is it?", h("div", { class: "stack" },
        h("p", { class: "muted", text: "Move it along as you go: scripted, filmed, then posted. Plan counts what's posted against your weekly goal." }),
        list,
        button("Remove from Plan", { kind: "quiet", cls: "danger", icon: "trash", onClick: () => { closeSheet(); setStatus("dismissed"); } })));
    }
    function postedSheet() {
      const inp = h("input", { class: "input", type: "url", inputMode: "url", placeholder: "https://www.instagram.com/reel/…", "aria-label": "Link to the post (optional)", autocomplete: "off" });
      inp.setAttribute("autocapitalize", "off");
      sheet("Posted it?", h("div", { class: "stack" },
        h("p", { class: "muted", text: "Paste the post's link if you like. In three days Plan will ask how it did, and Jarvis learns from the answer." }),
        inp,
        button("Mark posted", { kind: "primary", cls: "block", onClick: () => { const u = inp.value.trim(); closeSheet(); setStatus("posted", safeUrl(u) || null); } })));
    }
    async function setStatus(s, postUrl) {
      await flush();
      const was = st.row.status;
      const body = { status: s };
      if (s === "posted" && postUrl) body.postUrl = postUrl;
      try {
        const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, body);
        if (r && r.idea) { st.row = { ...r.idea, _userText: st.row._userText }; store.saveIdea(r.idea); }
        if (s === "posted") event("posted");
        toast(s === "dismissed" ? "Removed from your Plan" : s === "saved" || s === "scripted" ? "Saved to your Plan" : `Marked ${STATUS_LABEL[s].toLowerCase()}`,
          s === "dismissed" ? { action: { label: "Undo", run: () => undoStatus(was) } } : {});
        drawBar();
      } catch (e) { toast(e.reason); }
    }

    // Undo works after she has left the page too: the row is put back whatever is on the screen
    async function undoStatus(was) {
      try {
        const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, { status: was || "saved" });
        if (r && r.idea) { store.saveIdea(r.idea); if (alive) { st.row = { ...r.idea, _userText: st.row._userText }; drawBar(); } }
        toast(`Back in ${STATUS_LABEL[(r && r.idea && r.idea.status) || was] || "your Plan"}`);
      } catch (e) { toast(e.reason); }
    }
    async function copy(text, done) { (await copyText(text)) ? toast(done) : toast("Couldn't copy. Press and hold the text to copy it."); }

    // ---------------------------------------------------------------- start
    // the controls only (the check, the tweak chips, the bar): never the lines, so the keyboard and dictation stay where she is
    function controls() {
      if (!alive || !st.row) return;
      if (!st.work) { drawAll(); return; }          // no script yet: nothing she types in
      drawCheck();
      const off = store.aiOff() || !store.live.online || !!st.writing;
      for (const b of root.querySelectorAll("[data-tweak]")) b.disabled = off;
      drawBar();
    }

    drawAll();
    resumeWriting();
    const { C, R } = await checker();
    if (!alive) return () => {};
    st.C = C; st.R = R;
    if (st.row) { st.work = clone(current(st.row)); if (st.row._dirty) st.dirty = true; drawAll(); }
    try {
      const r = await api("GET", `/ideas/${encodeURIComponent(id)}`);
      if (r && r.idea && alive) {
        store.saveIdea(r.idea);                        // a row with edits not yet sent keeps them (store.saveIdeas)
        st.row = { ...store.idea(id), _userText: st.row && st.row._userText };
        if (st.row._dirty) st.dirty = true;
        if (!st.dirty) { st.work = clone(current(st.row)); drawAll(); } else controls();
      }
    } catch (e) {
      if (e.status === 404) { st.gone = true; st.row = null; store.dropIdea(id); drawAll(); }
      else if (!st.row) { st.unreachable = true; drawAll(); }
    }
    if (alive && st.dirty && store.live.online) flush();      // an edit made offline goes up now
    if (st.row && !st.work && route.query.write === "1" && !store.aiOff() && store.live.online) {
      history.replaceState(history.state, "", link("/idea/" + id, { from }));
      writeScript();
    }
    if (st.row) loadRefs();
    const offs = [store.on("online", on => { if (on && st.dirty) flush(); controls(); }), store.on("health", controls)];
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false; offs.forEach(f => f()); document.removeEventListener("visibilitychange", onHide);
      if (store.live.editing === id) store.live.editing = null;
      clearTimeout(timers.check); flush();
      if (els.bar) els.bar.remove();
    };
  },
};

// the whole script as plain text (Copy script): what to say, what's on screen, the shots, the caption and the tags
export function asText(s, idea = {}) {
  if (!s) return "";
  const L = [];
  const on = x => (x ? `   On screen: ${x}` : null), shot = x => (x ? `   Shot: ${x}` : null);
  L.push(s.title || idea.title || "", "");
  L.push("HOOK (0:00)", s.hook && s.hook.say, on(s.hook && s.hook.onScreen), shot(s.hook && s.hook.shot), "");
  for (const b of s.beats || []) L.push(`${secs(b.t)}  ${b.say || ""}`, on(b.onScreen), shot(b.shot), "");
  if (s.cta) L.push("CALL TO ACTION", s.cta.say, on(s.cta.onScreen), "");
  if (s.caption) L.push("CAPTION", s.caption, "");
  if ((s.hashtags || []).length) L.push(s.hashtags.join(" "));
  return L.filter(x => x !== null && x !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
