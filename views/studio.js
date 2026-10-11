// studio.js: anything in, ideas out (design §3.4). Four modes (Ideas, From a listing, Remix a video, Plan my week), one-tap seeds
// from today's brief, the options row (platform, length, how she appears; defaults from her profile), and idea cards with Write
// script, Save and thumbs. States (§3.20): writing (skeletons and Cancel), busy (Try again, her text kept), declined, an unreadable
// link, writing not switched on yet, offline.
import * as store from "../store.js";
import { api, SENTENCES } from "../api.js";
import { go, link } from "../router.js";
import {
  h, icon, replace, button, iconButton, choice, chip, notice, sheet, closeSheet, toast, skeleton, ideaChips, setPressed,
  PILLAR_LABEL, PLATFORM_LABEL, APPEAR_LABEL,
} from "../ui.js";
import { easternDate, shortDate, weekdayShort } from "../shared/time.js";

const MODES = [["topic", "Ideas"], ["listing", "From a listing"], ["remix", "Remix a video"], ["week", "Plan my week"]];
// ideas being written: kept here, not on the page, so leaving the Studio doesn't throw away ideas already paid for. Coming back while
// they're on their way shows the writing state; once they land they're the Studio's results (also saved for the next visit)
let inflight = null;
const LENGTHS = [15, 30, 45, 60, 90];
const LISTING_MAX = 4000, TOPIC_MAX = 500;

export default {
  async mount(root, route) {
    const prof = store.profile();
    const saved = store.get("studio") || {};
    const st = {
      mode: saved.mode || "topic",
      text: { topic: "", listing: "", remix: "", ...(saved.text || {}) },
      options: { platform: "reels", lengthSec: 30, appear: "camera", ...(prof.defaults || {}), ...(saved.options || {}) },
      seed: null,
      results: saved.results || null,          // { ids, mode, label }
      busy: false, error: null,
    };
    let alive = true;
    const persist = () => store.set("studio", { mode: st.mode, text: st.text, options: st.options, results: st.results });

    // a seed from Today (?seed=kind:id&date=…&go=1), or Plan's Plan my week (?mode=week&go=1)
    const q = route.query || {};
    if (q.seed) {
      const [kind, ...rest] = q.seed.split(":");
      const id = rest.join(":");
      st.seed = { kind, id, date: q.date || easternDate(), title: seedTitle(kind, id, q.date) };
    }
    if (q.mode && MODES.some(m => m[0] === q.mode)) { st.mode = q.mode; st.seed = null; }

    const els = {};
    function draw() {
      if (!alive) return;
      replace(root,
        h("h1", { class: "page-title", text: "Studio" }),
        composer(),
        modes(),
        seeds(),
        h("div", { class: "row" }, button("Read your own words in the prompter", { kind: "quiet", icon: "film", cls: "own-words", onClick: ownWords })),
        els.status = h("div", { class: "studio-status", "aria-live": "polite" }, statusNote()),
        els.results = h("div", { class: "results" }, results()));
    }

    // ---------------------------------------------------------------- the composer
    function composer() {
      const box = h("div", { class: "card composer" });
      if (st.seed) {
        box.append(h("div", { class: "seed-chip" },
          icon("sparkle", 18),
          h("span", {}, h("b", { text: "From today's brief: " }), st.seed.title || "today's briefing"),
          iconButton("close", "Clear the seed", () => { st.seed = null; draw(); }, { cls: "plain" })));
      } else if (st.mode === "week") {
        const goal = Number(prof.weeklyGoal) || 3;
        box.append(h("p", { class: "lede", text: `One idea for each of your ${goal} posts this week, spread across topics, each with a day to film and a tip for filming them together.` }));
      } else {
        const ph = st.mode === "topic" ? "What do you want to make a video about?" : st.mode === "listing" ? "Paste the listing's details or remarks" : "Paste a TikTok or YouTube link (for Instagram, paste its caption)";
        const max = st.mode === "listing" ? LISTING_MAX : st.mode === "topic" ? TOPIC_MAX : 2000;
        const ta = h("textarea", { class: "textarea", rows: st.mode === "listing" ? 6 : 3, placeholder: ph, value: st.text[st.mode] || "", "aria-label": ph, spellcheck: st.mode !== "remix", enterKeyHint: "go" });
        if (st.mode === "remix") { ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off"); ta.inputMode = "url"; }
        const count = h("p", { class: "count-line", text: "" });
        const showCount = () => {
          const n = ta.value.length;
          count.textContent = st.mode === "listing" || n > max * 0.8 ? `${n.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}${n > max ? " · the rest will be cut" : ""}` : "";
        };
        ta.addEventListener("input", () => { st.text[st.mode] = ta.value; persist(); showCount(); updateGo(); });
        ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } });
        showCount();
        els.ta = ta;
        box.append(ta, count);
        if (st.mode === "remix") box.append(h("p", { class: "small muted", text: "Instagram links can't be read without Meta's approval, so paste the caption instead. You'll get the format, never the words." }));
      }
      const opts = h("div", { class: "opts" },
        optBtn(PLATFORM_LABEL[st.options.platform] || "Reels", "Platform"),
        optBtn(st.options.lengthSec + " s", "Length"),
        optBtn(APPEAR_LABEL[st.options.appear] || "On camera", "How you appear"));
      els.go = button(goLabel(), { kind: "primary", onClick: run, cls: "go big" });
      els.go.setAttribute("data-act", "go");
      box.append(opts, els.go);
      updateGo();
      return box;
    }
    function optBtn(text, what) {
      const b = h("button", { type: "button", class: "opt", "aria-label": `${what}: ${text}. Change` }, h("span", { text }), icon("next", 14));
      b.addEventListener("click", optionsSheet);
      return b;
    }
    function goLabel() {
      if (st.seed) return "Get ideas";
      if (st.mode === "topic") return (st.text.topic || "").trim() ? "Get ideas" : "Surprise me";
      if (st.mode === "listing") return "Get 3 ideas";
      if (st.mode === "remix") return "Remix it";
      return "Plan my week";
    }
    function blocked() {
      if (store.aiOff()) return SENTENCES.not_connected;
      if (!store.live.online) return "You're offline";
      return null;
    }
    function updateGo() {
      if (!els.go) return;
      const why = blocked();
      const needs = !st.seed && ((st.mode === "listing" && !(st.text.listing || "").trim()) || (st.mode === "remix" && !(st.text.remix || "").trim()));
      els.go.disabled = !!why || needs || st.busy;
      els.go.querySelector("span").textContent = why === "You're offline" ? "You're offline" : goLabel();
    }

    function optionsSheet() {
      const body = h("div", { class: "stack" });
      const group = (title, list, key, fmt) => {
        const row = h("div", { class: "choices", role: "group", "aria-label": title });
        for (const v of list) row.append(choice(fmt(v), st.options[key] === v, () => {
          st.options[key] = v; persist();
          for (const b of row.children) setPressed(b, b === btns.get(v));
          draw();
        }));
        const btns = new Map(list.map((v, i) => [v, row.children[i]]));
        return h("div", { class: "field" }, h("span", { class: "label", text: title }), row);
      };
      body.append(
        group("Platform", ["reels", "tiktok", "shorts", "facebook"], "platform", v => PLATFORM_LABEL[v]),
        group("Length", LENGTHS, "lengthSec", v => v + " s"),
        group("How you appear", ["camera", "voiceover", "text"], "appear", v => APPEAR_LABEL[v]),
        h("p", { class: "small muted", text: "Your usual choices live in You. These apply to the ideas you ask for here." }),
        button("Done", { kind: "lake", cls: "block", onClick: closeSheet }));
      sheet("Options", body);
    }

    function modes() {
      return h("div", { class: "scroller modes", role: "group", "aria-label": "What kind of ideas" },
        MODES.map(([m, label]) => choice(label, !st.seed && st.mode === m, () => {
          if (st.busy) return;
          st.mode = m; st.seed = null; st.error = null; persist(); draw();
          if (els.ta && m !== "week") els.ta.focus({ preventScroll: true });
        })));
    }

    // one-tap seeds from today's brief: Today's move, the top story, the top trend, a question
    function seeds() {
      const lb = store.latestBriefing(), b = lb && lb.briefing;
      if (!b) return null;
      const list = [];
      if (b.move) list.push(["move", b.move.ideaId, "Today's move"]);
      if ((b.local || [])[0]) list.push(["local", b.local[0].id, "Top story"]);
      if ((b.trends || [])[0]) list.push(["trend", "0", "Top trend"]);
      if ((b.asking || [])[0]) list.push(["asking", b.asking[0].id, "A question"]);
      if (!list.length) return null;
      return h("div", { class: "section seeds" },
        h("h2", { class: "eyebrow", text: "From today's brief" }),
        h("div", { class: "scroller" }, list.map(([kind, id, label]) => {
          const c = choice(label, !!(st.seed && st.seed.kind === kind && st.seed.id === id), () => {
            if (st.busy || blocked()) return;
            st.seed = { kind, id, date: b.date, title: seedTitle(kind, id, b.date) };
            draw(); run();
          });
          c.disabled = !!blocked();
          return c;
        })));
    }

    // ---------------------------------------------------------------- the notices above the results
    function statusNote() {
      if (store.aiOff()) return notice(SENTENCES.not_connected, { kind: "calm", sub: "Your saved ideas and scripts still open, Today still comes each morning, and the prompter reads any text." });
      if (!store.live.online) return notice("You're offline. Writing needs a connection; your saved ideas still open.", { kind: "calm", icon: "offline" });
      if (!st.error) return null;
      const e = st.error;
      const retry = ["busy", "network", "other"].includes(e.kind) ? button("Try again", { kind: "lake", icon: "refresh", onClick: run }) : null;
      return notice(e.reason, { kind: e.kind === "declined" || e.kind === "bad_link" ? "warn" : "error", icon: "info", action: retry });
    }

    // ---------------------------------------------------------------- results
    function results() {
      if (st.busy) {
        return h("div", { "aria-busy": "true" },
          h("div", { class: "results-head" },
            h("p", { class: "writing-line" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
              st.mode === "week" && !st.seed ? "Jarvis is planning your week… usually 15–30 seconds" : "Jarvis is writing your ideas… usually 10–20 seconds"),
            button("Cancel", { kind: "ghost", onClick: cancel })),
          h("div", { class: "stack" }, [0, 1, 2].map(() => h("div", { class: "card idea" }, skeleton(4)))));
      }
      const r = st.results;
      if (!r || !r.ids || !r.ids.length) {
        return h("div", { class: "empty" }, icon("sparkle", 34),
          h("p", { text: "Type a topic, paste a listing or a video link, or tap a seed from today's brief. Jarvis writes ideas that fit you and this week." }));
      }
      const rows = r.ids.map(id => store.idea(id)).filter(Boolean);
      if (!rows.length) return null;
      const head = h("div", { class: "results-head" }, h("h2", { class: "eyebrow", text: r.label || "Your ideas" }));
      if (r.mode === "week") {
        const all = button("Add all to Plan", { kind: "lake", icon: "plan", onClick: addAll });
        all.setAttribute("data-act", "add-all");
        head.append(all);
      } else head.append(button("Clear", { kind: "quiet", onClick: () => { st.results = null; persist(); draw(); } }));
      return h("div", {}, head, h("div", { class: "stack" }, rows.map(ideaCard)));
    }

    function ideaCard(row) {
      const i = row.idea || {};
      const card = h("article", { class: "card idea", "data-id": row.id });
      if (i.day) card.append(h("p", { class: "day" }, icon("calendar", 17), `${weekdayShort(i.day)}, ${shortDate(i.day, { year: false })}`));
      card.append(h("h3", { text: i.title || "An idea" }));
      if (i.hook) card.append(h("q", { text: i.hook }));
      card.append(ideaChips(i));
      if (i.why) card.append(h("p", { class: "why", text: "Why now: " + i.why }));
      if (i.batchTip) card.append(h("p", { class: "tip" }, h("b", { text: "Batch it: " }), i.batchTip));
      const inPlan = ["saved", "scripted", "filmed", "posted"].includes(row.status);
      const write = h("a", { class: "btn primary", href: link("/idea/" + row.id, { from: "studio", write: row.script ? null : "1" }), "data-act": "write" },
        h("span", { text: row.script ? "Open script" : "Write script" }));
      if (!row.script && blocked()) { write.setAttribute("aria-disabled", "true"); write.classList.add("is-disabled"); write.addEventListener("click", e => { e.preventDefault(); toast(blocked()); }); }
      const save = button(inPlan ? "Saved" : "Save", { kind: inPlan ? "ghost" : "", icon: inPlan ? "check" : null, onClick: () => toggleSave(row) });
      save.setAttribute("aria-pressed", inPlan ? "true" : "false");
      save.setAttribute("data-act", "save");
      const up = iconButton("up", "More like this", () => rate(row, row.rating === 1 ? 0 : 1), { pressed: row.rating === 1 });
      const down = iconButton("down", "Less like this", () => rate(row, row.rating === -1 ? 0 : -1), { pressed: row.rating === -1 });
      card.append(h("div", { class: "acts" }, write, save, h("span", { class: "thumbs" }, up, down)));
      return card;
    }

    // ---------------------------------------------------------------- actions
    async function run() {
      if (st.busy || inflight) return;
      const why = blocked();
      if (why) { toast(why); return; }
      const body = { options: { ...st.options } };
      let label = "Your ideas";
      if (st.seed) {
        body.mode = "seed"; body.seed = { kind: st.seed.kind, id: st.seed.id, date: st.seed.date };
        label = "Ideas from today's brief";
      } else if (st.mode === "topic") {
        body.mode = "topic";
        const t = (st.text.topic || "").trim().slice(0, TOPIC_MAX);
        if (t) { body.text = t; label = `Ideas for “${t.length > 48 ? t.slice(0, 47) + "…" : t}”`; } else label = "Ideas Jarvis picked for you";
      } else if (st.mode === "listing") {
        body.mode = "listing"; body.text = (st.text.listing || "").trim().slice(0, LISTING_MAX);
        if (!body.text) { toast("Paste the listing's details first."); return; }
        if ((st.text.listing || "").length > LISTING_MAX) toast("That listing was long, so only its first 4,000 characters went in.");
        label = "Ideas for this listing";
      } else if (st.mode === "remix") {
        body.mode = "remix";
        const t = (st.text.remix || "").trim();
        if (!t) { toast("Paste a link or a caption first."); return; }
        if (/^https?:\/\/\S+$/i.test(t)) body.url = t; else body.text = t.slice(0, 2000);
        label = "Your version of that video";
      } else {
        body.mode = "week"; label = "Your week";
      }
      const job = { ctrl: new AbortController(), mode: body.mode, label, error: null, results: null };
      job.promise = (async () => {
        try {
          const r = await api("POST", "/ideas", body, { signal: job.ctrl.signal, timeout: 90000 });
          const rows = (r && r.ideas) || [];
          store.saveIdeas(rows);
          if (body.text && (body.mode === "topic" || body.mode === "listing")) for (const x of rows) store.noteUserText(x.id, body.text);
          job.results = { ids: rows.map(x => x.id), mode: body.mode, label };
          store.set("studio", { ...(store.get("studio") || {}), results: job.results });
        } catch (e) {
          if (e.kind !== "aborted") job.error = e;
        } finally { if (inflight === job) inflight = null; }
      })();
      inflight = job;
      st.busy = true; st.error = null;
      redrawStatus();
      await follow(job);
    }
    // the page waits for ideas being written (started here, or before she left and came back)
    async function follow(job) {
      await job.promise;
      st.busy = false;
      if (job.results) st.results = job.results;
      st.error = job.error;
      if (alive) { draw(); if (job.results && !job.error) els.results.scrollIntoView({ block: "start", behavior: "smooth" }); }
    }
    function redrawStatus() {
      if (!alive) return;
      updateGo();
      replace(els.status, statusNote());
      replace(els.results, results());
    }
    // the notices and buttons only, never the composer she may be typing in (the keyboard and dictation stay put)
    function controls() {
      if (!alive) return;
      updateGo();
      replace(els.status, statusNote());
      for (const c of root.querySelectorAll(".seeds .choice")) c.disabled = !!blocked();
      if (!st.busy) replace(els.results, results());
    }
    function cancel() { if (inflight) inflight.ctrl.abort(); }

    async function toggleSave(row) {
      const inPlan = ["saved", "scripted", "filmed", "posted"].includes(row.status);
      try {
        const r = await api("PATCH", `/ideas/${encodeURIComponent(row.id)}`, { status: inPlan ? "new" : "saved" });
        if (r && r.idea) store.saveIdea(r.idea);
        toast(inPlan ? "Taken out of your Plan" : "Saved to your Plan");
        draw();
      } catch (e) { toast(e.reason); }
    }
    async function rate(row, rating) {
      try {
        const r = await api("PATCH", `/ideas/${encodeURIComponent(row.id)}`, { rating });
        if (r && r.idea) store.saveIdea(r.idea);
        if (rating) toast(rating > 0 ? "More like this, noted" : "Less like this, noted");
        draw();
      } catch (e) { toast(e.reason); }
    }
    async function addAll() {
      const ids = (st.results && st.results.ids) || [];
      let n = 0;
      for (const id of ids) {
        const row = store.idea(id);
        if (!row) continue;
        try {
          const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, { status: "saved", planDate: row.idea && row.idea.day ? row.idea.day : null });
          if (r && r.idea) { store.saveIdea(r.idea); n++; }
        } catch (e) { toast(e.reason); break; }
      }
      if (n) { toast(`Added ${n} idea${n === 1 ? "" : "s"} to your Plan`); draw(); }
    }
    function ownWords() {
      const ta = h("textarea", { class: "textarea", rows: 8, placeholder: "Paste or type what you want to say", "aria-label": "Your words" });
      const prev = JSON.parse(sessionStorage.getItem("jarvis:prompterText") || "null");
      if (prev && prev.own) ta.value = prev.text || "";
      sheet("Your own words", h("div", { class: "stack" }, ta,
        h("p", { class: "small muted", text: "The prompter scrolls them over your camera, the same as a script." }),
        button("Open the prompter", { kind: "primary", cls: "block", icon: "film", onClick: () => {
          const text = ta.value.trim();
          if (!text) { toast("Type or paste something first."); return; }
          sessionStorage.setItem("jarvis:prompterText", JSON.stringify({ text, title: "Your words", own: true }));
          closeSheet(); go("/prompter/text", { query: { from: "studio" } });
        } })));
      setTimeout(() => ta.focus(), 260);
    }

    draw();
    const offs = [store.on("online", controls), store.on("health", controls)];
    if (inflight) { st.busy = true; redrawStatus(); follow(inflight); }
    else if (q.go === "1") { history.replaceState(history.state, "", "#/studio"); if (!blocked()) run(); }
    return () => { alive = false; offs.forEach(f => f()); };
  },
};

// the seed's words, for the chip that says where the ideas come from
function seedTitle(kind, id, date) {
  const lb = store.latestBriefing();
  const b = (lb && lb.briefing && (!date || lb.briefing.date === date) ? lb.briefing : (date && store.briefingFor(date))) || (lb && lb.briefing);
  if (!b) return "";
  try {
    if (kind === "move") { const i = (b.ideas || []).find(x => x.id === id); return i ? i.idea.title : "Today's move"; }
    if (kind === "local") { const s = (b.local || []).find(x => x.id === id); return s ? s.title : ""; }
    if (kind === "industry") { const s = (b.industry || []).find(x => x.id === id); return s ? s.title : ""; }
    if (kind === "pulse") { const t = (b.pulse || []).find(x => x.key === id); return t ? `${t.label}: ${t.display} (${t.period})` : ""; }
    if (kind === "trend") { const t = (b.trends || [])[Number(id)]; return t ? `the “${t.name.replace(/^"|"$/g, "")}” format` : ""; }
    if (kind === "asking") { const a = (b.asking || []).find(x => x.id === id); return a ? `“${a.question}”` : ""; }
    if (kind === "calendar") { const c = (b.calendar || [])[Number(id)]; return c ? `${c.label} (${shortDate(c.date, { year: false })})` : ""; }
  } catch { /* */ }
  return "";
}
