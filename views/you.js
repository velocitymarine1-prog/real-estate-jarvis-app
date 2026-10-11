// you.js: her profile and settings (design §3.7). Everything here shapes every idea and script she's given: her name, her brokerage's
// licensed name (the check looks for it), the team name (checked against Florida Rule 61J2-10.026), areas, who she helps, tone, how she
// likes to film, platforms, her call to action, the weekly goal, her usual video, her own captions; then the morning heads-up, install
// help, Send Isaac a note, the sources and how it works, and sign out. Changes save as she goes.
import * as store from "../store.js";
import { api, SENTENCES } from "../api.js";
import { go } from "../router.js";
import { BUILD, API, MOCK, SHORT_NAME } from "../config.js";
import {
  h, icon, replace, button, iconButton, choice, setPressed, notice, sheet, closeSheet, toast, autogrow, isIOS, isIOSSafari, isStandalone,
  PLATFORM_LABEL, APPEAR_LABEL, PROFILE_LIMITS, fieldSentence, profileField,
} from "../ui.js";
import { AREAS, HELPS, TONES, CTAS, LENGTHS } from "../shared/models.js";
import * as push from "../push.js";
import { checker } from "../rules.js";

export const CAMERA_CHOICES = [["love", "I love it", "Talking to camera is easy for me"], ["getting", "Getting comfortable", "Short takes, a little coaching"], ["voiceover", "I'd rather do voiceover", "My voice over b-roll and text"]];

export default {
  async mount(root) {
    const me = store.live.me || { user: {} };
    const p = structuredClone({ firstName: "", brokerage: "", team: "", areas: ["Lake Mary"], helps: [], tone: [], camera: "getting", platforms: ["reels"],
      cta: "DM me", weeklyGoal: 3, voice: [], notifyTime: "07:00", tz: "America/New_York", defaults: { platform: "reels", lengthSec: 30, appear: "camera" },
      ...(me.user && me.user.profile) });
    if (!p.firstName && me.user && me.user.name) p.firstName = me.user.name;
    if (!p.areas.includes("Lake Mary")) p.areas.unshift("Lake Mary");
    p.defaults = { platform: "reels", lengthSec: 30, appear: "camera", ...(p.defaults || {}) };
    const st = { saveTimer: 0, error: null, saving: false };
    const els = {};
    let alive = true;
    const { C, R } = await checker();

    // ---------------------------------------------------------------- saving as she goes
    function changed() {
      clearTimeout(st.saveTimer);
      st.saveTimer = setTimeout(save, 900);
      if (els.save) els.save.textContent = "Saving…";
    }
    async function save() {
      clearTimeout(st.saveTimer);
      if (st.saving) { st.saveTimer = setTimeout(save, 500); return; }
      st.saving = true;
      try {
        const L = PROFILE_LIMITS;
        const send = { ...p, firstName: (p.firstName || "").slice(0, L.firstName), brokerage: (p.brokerage || "").slice(0, L.brokerage),
          team: (p.team || "").slice(0, L.team), cta: (p.cta || "").slice(0, L.cta), voice: (p.voice || []).map(v => String(v).slice(0, L.voice)).slice(0, 5) };
        const r = await api("PUT", "/me", { name: send.firstName.trim() || undefined, profile: send });
        if (r && r.user) store.setMe(r);
        st.error = null;
        for (const el of root.querySelectorAll("[aria-invalid=true]")) el.removeAttribute("aria-invalid");
        if (els.save) els.save.textContent = "All changes saved";
      } catch (e) {
        st.error = e;
        // offline or unreachable: the change stays on the phone, marked, and app.js sends it when the phone is back
        if (["offline", "network", "busy"].includes(e.kind)) {
          const cur = store.live.me || { user: {} };
          store.setMe({ ...cur, user: { ...cur.user, name: (p.firstName || "").trim() || (cur.user && cur.user.name) || "", profile: { ...p } }, _dirtyProfile: true });
        }
        if (els.save) els.save.textContent = e.kind === "offline" ? "Not saved yet: you're offline. It saves when you're back." : e.kind === "bad_field" ? fieldSentence(e) : (e.reason || "Not saved yet");
        const bad = e.kind === "bad_field" && root.querySelector("#f-" + profileField(e));
        if (bad) bad.setAttribute("aria-invalid", "true");
      } finally { st.saving = false; }
    }

    // ---------------------------------------------------------------- pieces
    const text = (label, key, { hint = null, placeholder = "", required = false, onInput = null, max = 80 } = {}) => {
      const id = "f-" + key;
      const inp = h("input", { class: "input", id, type: "text", value: p[key] || "", placeholder, maxLength: PROFILE_LIMITS[key] || max, autocomplete: "off", required });
      inp.addEventListener("input", () => { p[key] = inp.value; if (onInput) onInput(inp.value); changed(); });
      return h("div", { class: "field" }, h("label", { htmlFor: id, text: label }), inp, hint ? h("p", { class: "hint", text: hint }) : null);
    };
    const cap = v => v.charAt(0).toUpperCase() + v.slice(1);
    const multi = (label, key, list, { fixed = [], fmt = cap } = {}) => {
      const row = h("div", { class: "choices", role: "group", "aria-label": label });
      for (const v of list) {
        const on = (p[key] || []).includes(v);
        const b = choice(fmt(v), on, () => {
          if (fixed.includes(v)) return;
          const set = new Set(p[key] || []);
          set.has(v) ? set.delete(v) : set.add(v);
          p[key] = list.filter(x => set.has(x));
          setPressed(b, set.has(v)); changed();
        });
        if (fixed.includes(v)) { b.setAttribute("aria-disabled", "true"); b.title = "Always on"; }
        row.append(b);
      }
      return h("div", { class: "field" }, h("span", { class: "label", text: label }), row);
    };
    const single = (label, list, get, set, fmt = v => v) => {
      const row = h("div", { class: "choices", role: "group", "aria-label": label });
      const btns = list.map(v => {
        const b = choice(fmt(v), get() === v, () => { set(v); btns.forEach((x, i) => setPressed(x, list[i] === v)); changed(); });
        return b;
      });
      row.append(...btns);
      return h("div", { class: "field" }, h("span", { class: "label", text: label }), row);
    };

    function teamNote() {
      if (!els.team) return;
      let f = null;
      if (C && C.checkTeamName && (p.team || "").trim()) { try { f = C.checkTeamName(p.team, p.brokerage, R || undefined); } catch { f = null; } }
      replace(els.team, f ? h("div", { class: "finding-inline", role: "status", "data-rule": f.rule }, h("b", { text: f.text }), f.why ? h("span", { text: f.why }) : null) : null);
    }

    function cta() {
      const custom = !CTAS.includes(p.cta);
      const inp = h("input", { class: "input", type: "text", value: custom ? p.cta : "", placeholder: "Or your own, e.g. “Text me ‘TOUR’”", maxLength: PROFILE_LIMITS.cta, "aria-label": "Your own call to action" });
      const row = h("div", { class: "choices", role: "group", "aria-label": "Your call to action" });
      const btns = CTAS.map(v => choice(v.charAt(0).toUpperCase() + v.slice(1), p.cta === v, () => { p.cta = v; inp.value = ""; btns.forEach((x, i) => setPressed(x, CTAS[i] === v)); changed(); }));
      row.append(...btns);
      inp.addEventListener("input", () => { p.cta = inp.value.trim() || "DM me"; btns.forEach((x, i) => setPressed(x, CTAS[i] === p.cta)); changed(); });
      return h("div", { class: "field" }, h("span", { class: "label", text: "Your call to action" }), row, inp);
    }

    function goal() {
      const out = h("output", { text: String(p.weeklyGoal || 3) });
      const set = v => { p.weeklyGoal = Math.max(1, Math.min(7, v)); out.textContent = String(p.weeklyGoal); changed(); };
      return h("div", { class: "setting" },
        h("div", { class: "txt" }, h("b", { text: "Weekly goal" }), h("span", { text: "Posts a week. Three is a good start." })),
        h("div", { class: "stepper", role: "group", "aria-label": "Weekly goal" },
          iconButton("minus", "One fewer post a week", () => set((p.weeklyGoal || 3) - 1)), out,
          iconButton("plus", "One more post a week", () => set((p.weeklyGoal || 3) + 1))));
    }

    function voice() {
      const box = h("div", { class: "stack" });
      const v = (p.voice || []).slice(0, 3);
      while (v.length < 3) v.push("");
      v.forEach((txt, i) => {
        const ta = h("textarea", { class: "textarea", rows: 3, value: txt, maxLength: PROFILE_LIMITS.voice, placeholder: i === 0 ? "Paste a caption you wrote" : "Another one (optional)", "aria-label": `Caption ${i + 1}` });
        autogrow(ta);
        ta.addEventListener("input", () => { v[i] = ta.value; p.voice = v.map(s => s.trim()).filter(Boolean); changed(); });
        box.append(ta);
      });
      return h("div", { class: "field" }, h("span", { class: "label", text: "Your voice" }),
        h("p", { class: "hint", text: "Paste two or three captions you've written. Jarvis matches how you sound." }), box);
    }

    function pushBlock() {
      const s = push.support(), ps = push.state();
      const box = h("div", { class: "stack" });
      if (s === "home") {
        box.append(notice(`Add ${SHORT_NAME} to your home screen first, then turn this on.`, { kind: "calm", icon: "bell",
          sub: "On iPhone, notifications come only to apps on the home screen: tap Share, then Add to Home Screen." }));
        return box;
      }
      if (s === "none") { box.append(notice("This browser can't show notifications. The briefing is still here every morning.", { kind: "calm", icon: "bell" })); return box; }
      const sw = h("input", { type: "checkbox", role: "switch", checked: !!ps.on, "aria-label": "Morning heads-up" });
      const time = h("input", { class: "input", type: "time", value: ps.time || p.notifyTime || "07:00", step: 900, "aria-label": "Heads-up time", disabled: !ps.on });
      const status = h("p", { class: "hint", "aria-live": "polite", text: s === "denied" ? "Notifications are off for Jarvis. Turn them on in Settings › Notifications." : "" });
      sw.addEventListener("change", async () => {
        sw.disabled = true;
        try {
          if (sw.checked) { await push.enable(time.value || "07:00"); status.textContent = `On. Jarvis will nudge you at ${fmtTime(time.value)} when your briefing is ready.`; time.disabled = false; }
          else { await push.disable(); status.textContent = "Off."; time.disabled = true; }
        } catch (e) { sw.checked = false; time.disabled = true; status.textContent = e.reason || "Couldn't turn notifications on here."; }
        finally { sw.disabled = false; }
      });
      time.addEventListener("change", async () => {
        p.notifyTime = time.value || "07:00"; changed();
        try { await push.setTime(p.notifyTime); status.textContent = `Jarvis will nudge you at ${fmtTime(p.notifyTime)}.`; } catch (e) { status.textContent = e.reason || "Couldn't change the time."; }
      });
      box.append(h("div", { class: "setting" },
        h("div", { class: "txt" }, h("b", { text: "Nudge me when it's ready" }), h("span", { text: "One notification a morning, with the day's headline." })),
        h("label", { class: "switch" }, sw, h("span", { class: "track", "aria-hidden": "true" }))),
        h("div", { class: "field" }, h("label", { text: "At" }), time), status);
      return box;
    }

    function installHelp() {
      if (isStandalone()) return null;
      return h("details", { class: "how" }, h("summary", { text: "Put Jarvis on your home screen" }),
        h("div", { class: "body" },
          isIOSSafari() || isIOS()
            ? h("ol", {}, h("li", { text: "In Safari, tap Share (the square with the arrow)." }), h("li", { text: "Scroll down and tap Add to Home Screen, then Add." }),
              h("li", { text: "Open Jarvis from your home screen and type your code once." }))
            : h("p", { text: "In your browser's menu, choose Install or Add to Home Screen. On iPhone, use Safari: Share, then Add to Home Screen." }),
          h("p", { class: "muted", text: "From the home screen it opens full screen, works offline, and can nudge you in the morning." })));
    }

    function note() {
      const ta = h("textarea", { class: "textarea", rows: 3, placeholder: "What's working, what's missing, what you'd change…", "aria-label": "A note for Isaac", maxLength: 4000 });
      const send = button("Send Isaac a note", { kind: "lake", icon: "send", onClick: async () => {
        const t = ta.value.trim();
        if (!t) { toast("Write a note first."); return; }
        send.disabled = true;
        try { await api("POST", "/feedback", { text: t }); ta.value = ""; toast("Sent. Isaac will see it."); }
        catch (e) { toast(e.reason); }
        finally { send.disabled = false; }
      } });
      return h("div", { class: "stack" }, ta, send);
    }

    function how() {
      const lb = store.latestBriefing(), srcs = (lb && lb.briefing && lb.briefing.sources) || [];
      return h("details", { class: "how" }, h("summary", { text: "Sources and how Jarvis works" }),
        h("div", { class: "body" },
          h("p", { text: "Every morning before 7, Jarvis reads the week's mortgage rate (Freddie Mac), Seminole County's market numbers (Realtor.com, through the St. Louis Fed), local news (the City of Lake Mary, Google News, ClickOrlando and others), industry news (HousingWire, RISMedia, Real Estate News, The Close, Florida Realtors, Inman), the week's most-watched real estate videos on YouTube, write-ups of what's trending on Reels and TikTok, and the National Weather Service." }),
          h("p", { text: "Claude, an AI model, picks what matters and writes your briefing and scripts. Every number and every link comes from its source, never from the model's memory, and each number shows where it's from." }),
          h("p", { text: "The check reads each script for Fair Housing wording, Florida's brokerage-name rule, promises and numbers without a source. It catches common problems; it isn't legal advice, and your broker's rules come first." }),
          srcs.length ? h("ul", {}, srcs.map(s => h("li", { text: `${s.name}${s.ok ? "" : " (didn't answer this morning)"}` }))) : null,
          h("p", { class: "muted", text: "Isaac runs this app's server, so your scripts and settings follow you between devices. Your videos never leave your phone." })));
    }

    function signOut() {
      sheet("Sign out of this phone?", h("div", { class: "stack" },
        h("p", { class: "muted", text: "Your ideas and scripts stay safe; they'll be here when you sign back in with your code." }),
        button("Sign out", { kind: "primary", cls: "block", onClick: async () => {
          closeSheet();
          try { if (push.state().on) await push.disable(); } catch { /* */ }
          try { await api("DELETE", "/me/device", undefined, { timeout: 8000 }); } catch { /* best effort: the slot frees when Isaac revokes it */ }
          await store.signOutHere();
          sessionStorage.setItem("jarvis:signedOut", "self");
          go("/code", { replace: true });
        } }),
        button("Stay signed in", { kind: "ghost", cls: "block", onClick: closeSheet })));
    }

    // ---------------------------------------------------------------- the page
    const team = text("Team name (optional)", "team", { placeholder: "e.g. The Giavi Group", onInput: () => teamNote(), hint: "Florida lets a team use “Team” or “Group”, and the brokerage's name always shows with it." });
    els.team = h("div");
    replace(root,
      h("h1", { class: "page-title", text: "You" }),
      els.save = h("p", { class: "save-state", "aria-live": "polite", text: "Changes save as you go" }),
      h("section", { class: "group" }, h("h2", { text: "About you" }),
        text("Your first name", "firstName", { placeholder: "Giavi" }),
        text("Your brokerage's licensed name", "brokerage", { placeholder: "As it appears on your license", onInput: () => teamNote(),
          hint: "Florida needs it on every ad. The check makes sure it's in your caption." }),
        team, els.team),
      h("section", { class: "group" }, h("h2", { text: "Your market" }),
        multi("Where you sell", "areas", AREAS, { fixed: ["Lake Mary"] }),
        multi("Who you help", "helps", HELPS)),
      h("section", { class: "group" }, h("h2", { text: "Your videos" }),
        h("div", { class: "field" }, h("span", { class: "label", text: "On camera" }),
          h("div", { class: "cam-opts", role: "group", "aria-label": "On camera" }, CAMERA_CHOICES.map(([v, t, sub]) => {
            const b = h("button", { type: "button", class: "cam-opt", "aria-pressed": p.camera === v ? "true" : "false" }, h("b", { text: t }), h("span", { text: sub }), h("i", { class: "tick", "aria-hidden": "true" }, icon("check", 16, { weight: 3 })));
            b.addEventListener("click", () => { p.camera = v; for (const x of b.parentNode.children) setPressed(x, x === b); changed(); });
            return b;
          }))),
        multi("Your tone", "tone", TONES),
        multi("Where you post", "platforms", ["reels", "tiktok", "shorts", "facebook"], { fmt: v => PLATFORM_LABEL[v] }),
        cta(),
        goal(),
        single("Usual platform", ["reels", "tiktok", "shorts", "facebook"], () => p.defaults.platform, v => { p.defaults.platform = v; }, v => PLATFORM_LABEL[v]),
        single("Usual length", LENGTHS, () => p.defaults.lengthSec, v => { p.defaults.lengthSec = v; }, v => v + " s"),
        single("Usually you're", ["camera", "voiceover", "text"], () => p.defaults.appear, v => { p.defaults.appear = v; }, v => APPEAR_LABEL[v]),
        voice()),
      h("section", { class: "group" }, h("h2", { text: "Morning heads-up" }), pushBlock()),
      h("section", { class: "group" }, h("h2", { text: "Send Isaac a note" }),
        h("p", { class: "muted", text: "Ideas, problems, wishes. It goes straight to him." }), note()),
      h("section", { class: "group" }, installHelp(), how(),
        h("div", { class: "row" }, button("Sign out of this phone", { kind: "ghost", cls: "danger", icon: "close", onClick: signOut }))),
      h("p", { class: "build-line", text: `${SHORT_NAME} · build ${BUILD}${MOCK ? " · mock" : ""}` }));
    teamNote();
    return () => { alive = false; if (st.saveTimer) { clearTimeout(st.saveTimer); save(); } };
  },
};

function fmtTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
  if (!m) return hhmm || "7:00 am";
  const hh = +m[1];
  return `${hh % 12 === 0 ? 12 : hh % 12}:${m[2]} ${hh < 12 ? "am" : "pm"}`;
}
