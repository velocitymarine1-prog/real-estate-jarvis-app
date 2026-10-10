// onboarding.js: five short questions, one per screen, big buttons, each skippable except the brokerage name (design §3.7 step 4):
// name and brokerage; where she sells and who she helps; on camera and platforms; her voice; the 7 am heads-up. The name is filled in
// from her invite. At the end her profile is saved with onboarded, and Today opens with a first move written for her on the spot.
import * as store from "../store.js";
import { api } from "../api.js";
import { go } from "../router.js";
import { SHORT_NAME } from "../config.js";
import { h, icon, replace, button, choice, setPressed, notice, toast, autogrow, isIOS, isStandalone, PLATFORM_LABEL } from "../ui.js";
import { AREAS, HELPS, TONES, CTAS } from "../shared/models.js";
import { CAMERA_CHOICES } from "./you.js";
import * as push from "../push.js";

const STEPS = 5;
const cap = v => v.charAt(0).toUpperCase() + v.slice(1);

export default {
  async mount(root, route) {
    const n = Math.max(1, Math.min(STEPS, Number(route.arg) || 1));
    const me = store.live.me || { user: {} };
    const base = { firstName: "", brokerage: "", team: "", areas: ["Lake Mary"], helps: [], tone: [], camera: "getting", platforms: ["reels", "tiktok"],
      cta: "DM me", weeklyGoal: 3, voice: [], notifyTime: "07:00", tz: "America/New_York", defaults: { platform: "reels", lengthSec: 30, appear: "camera" } };
    const p = { ...base, ...((me.user && me.user.profile) || {}), ...(store.get("setupDraft") || {}) };
    if (!p.firstName && me.user && me.user.name) p.firstName = me.user.name;
    if (!p.areas.includes("Lake Mary")) p.areas = ["Lake Mary", ...p.areas];
    const keep = () => store.set("setupDraft", p);
    let busy = false;

    const next = () => { keep(); if (n < STEPS) go("/setup/" + (n + 1), { replace: true }); else finish(); };
    const prev = () => { keep(); go("/setup/" + (n - 1), { replace: true }); };

    function frame(title, lede, body, { nextLabel = "Next", canSkip = true, nextOk = true, extra = null, onNext = next, titleEl = null } = {}) {
      const nextBtn = button(nextLabel, { kind: "primary", cls: "block big", onClick: () => onNext(nextBtn), disabled: !nextOk });
      nextBtn.setAttribute("data-act", "next");
      const foot = h("div", { class: "foot" }, nextBtn, extra,
        h("div", { class: "row" },
          n > 1 ? button("Back", { kind: "quiet", icon: "back", onClick: prev }) : h("span"),
          h("span", { class: "spacer" }),
          canSkip ? button("Skip", { kind: "quiet", onClick: () => { keep(); next(); } }) : null));
      replace(root, h("div", { class: "setup", "data-step": String(n) },
        h("div", { class: "progress", "aria-label": `Question ${n} of ${STEPS}` },
          h("span", { text: `${n} of ${STEPS}` }), h("span", { class: "bar", "aria-hidden": "true" }, h("i", { style: { width: (n / STEPS * 100) + "%" } }))),
        h("div", { class: "q" }, titleEl || h("h1", { text: title }), lede ? h("p", { class: "lede", text: lede }) : null, body),
        foot));
      return nextBtn;
    }
    const field = (label, inp, hint) => h("div", { class: "field" }, h("label", { htmlFor: inp.id, text: label }), inp, hint ? h("p", { class: "hint", text: hint }) : null);
    const input = (id, key, placeholder, onInput) => {
      const i = h("input", { class: "input", id, type: "text", value: p[key] || "", placeholder, maxLength: 80, autocomplete: id === "s-name" ? "given-name" : "organization" });
      i.addEventListener("input", () => { p[key] = i.value; keep(); if (onInput) onInput(i.value); });
      return i;
    };
    const multi = (label, key, list, { fixed = [], fmt = cap } = {}) => {
      const row = h("div", { class: "choices", role: "group", "aria-label": label });
      for (const v of list) {
        const b = choice(fmt(v), (p[key] || []).includes(v), () => {
          if (fixed.includes(v)) return;
          const set = new Set(p[key] || []);
          set.has(v) ? set.delete(v) : set.add(v);
          p[key] = list.filter(x => set.has(x)); keep();
          setPressed(b, set.has(v));
        });
        if (fixed.includes(v)) b.setAttribute("aria-disabled", "true");
        row.append(b);
      }
      return h("div", { class: "field" }, h("span", { class: "label", text: label }), row);
    };

    if (n === 1) {
      const name = input("s-name", "firstName", "Your first name");
      const brk = input("s-brk", "brokerage", "As it appears on your license", v => { nextBtn.disabled = !v.trim(); });
      const team = input("s-team", "team", "Optional, e.g. The Javi Group");
      const nextBtn = frame(`Hi${p.firstName ? ", " + p.firstName : ""}! Let's set ${SHORT_NAME} up for you.`, "Five quick questions. Everything can be changed later in You.",
        h("div", { class: "stack" },
          field("What should Jarvis call you?", name),
          field("Your brokerage's licensed name", brk, "Florida needs it on every ad, so Jarvis checks your captions for it."),
          field("Your team's name", team)),
        { canSkip: false, nextOk: !!(p.brokerage || "").trim() });
      setTimeout(() => (p.firstName ? brk : name).focus({ preventScroll: true }), 50);
      brk.addEventListener("keydown", e => { if (e.key === "Enter" && !nextBtn.disabled) next(); });
    } else if (n === 2) {
      frame("Where do you sell, and who do you help?", "Ideas and scripts stay local to your towns and speak to your clients.",
        h("div", { class: "stack" }, multi("Where you sell", "areas", AREAS, { fixed: ["Lake Mary"] }), multi("Who you help", "helps", HELPS)));
    } else if (n === 3) {
      const cams = h("div", { class: "cam-opts", role: "group", "aria-label": "On camera" }, CAMERA_CHOICES.map(([v, t, sub]) => {
        const b = h("button", { type: "button", class: "cam-opt", "aria-pressed": p.camera === v ? "true" : "false" }, h("b", { text: t }), h("span", { text: sub }), h("i", { class: "tick", "aria-hidden": "true" }, icon("check", 16, { weight: 3 })));
        b.addEventListener("click", () => { p.camera = v; keep(); for (const x of cams.children) setPressed(x, x === b); });
        return b;
      }));
      frame("How do you feel about being on camera?", "Formats will fit how you like to film.",
        h("div", { class: "stack" }, cams, multi("Where you post", "platforms", ["reels", "tiktok", "shorts", "facebook"], { fmt: v => PLATFORM_LABEL[v] })));
    } else if (n === 4) {
      const caps = h("div", { class: "stack" });
      const v = (p.voice || []).slice(0, 2);
      while (v.length < 2) v.push("");
      v.forEach((txt, i) => {
        const ta = h("textarea", { class: "textarea", rows: 3, value: txt, placeholder: i === 0 ? "Paste a caption you've written" : "And another (optional)", "aria-label": `Caption ${i + 1}` });
        autogrow(ta);
        ta.addEventListener("input", () => { v[i] = ta.value; p.voice = v.map(s => s.trim()).filter(Boolean); keep(); });
        caps.append(ta);
      });
      const ctaRow = h("div", { class: "choices", role: "group", "aria-label": "Your call to action" });
      const ctaBtns = CTAS.map(c => choice(cap(c), p.cta === c, () => { p.cta = c; keep(); ctaBtns.forEach((x, i) => setPressed(x, CTAS[i] === c)); }));
      ctaRow.append(...ctaBtns);
      frame("How do you sound?", "Pick your tone and paste a caption or two, so scripts sound like you.",
        h("div", { class: "stack" }, multi("Your tone", "tone", TONES), h("div", { class: "field" }, h("span", { class: "label", text: "Your captions" }), caps),
          h("div", { class: "field" }, h("span", { class: "label", text: "How viewers reach you" }), ctaRow)));
    } else {
      const s = push.support();
      let body, nextLabel = "Finish", extra = null;
      if (s === "home") {
        body = notice(`On iPhone, the heads-up comes once ${SHORT_NAME} is on your home screen. Turn it on in You any time after that.`, { kind: "calm", icon: "bell" });
      } else if (s === "none") {
        body = notice("This browser can't show notifications. Your briefing is still ready every morning by 7.", { kind: "calm", icon: "bell" });
      } else {
        const lb = store.latestBriefing();
        const headline = (lb && lb.briefing && lb.briefing.headline) || "Your Lake Mary briefing is ready";
        body = h("div", { class: "stack" },
          h("div", { class: "notif-preview", "aria-label": "What the heads-up looks like" },
            h("img", { src: "icons/icon-192.png", alt: "", width: 38, height: 38 }),
            h("div", {}, h("p", { class: "nhead" }, h("b", { text: SHORT_NAME.toUpperCase() }), h("span", { text: "7:00 am" })),
              h("p", { class: "ntitle", text: "Good morning ☀️" }), h("p", { class: "nbody", text: headline }))),
          h("p", { text: "One notification at 7:00 am when your briefing is ready, with the day's headline. Nothing else, ever." }),
          h("p", { class: "muted", text: "You can change the time or turn it off in You." }));
        nextLabel = "Turn on the 7 am heads-up";
        extra = button("Not now", { kind: "ghost", cls: "block big", onClick: () => finish() });
      }
      frame("", null, body, { titleEl: h("h1", {}, "Want a ", h("span", { class: "nowrap", text: "heads-up" }), " in the morning?"), nextLabel, canSkip: false, extra, onNext: s !== "ok" ? () => finish() : async btn => {
        btn.disabled = true;
        try { await push.enable("07:00"); p.notifyTime = "07:00"; keep(); toast("The heads-up is on for 7:00 am"); }
        catch (e) { toast(e.reason || "Notifications weren't turned on. You can do it later in You."); }
        finish();
      } });
    }

    async function finish() {
      if (busy) return;
      busy = true;
      keep();
      const prof = { ...p, firstName: (p.firstName || "").trim(), brokerage: (p.brokerage || "").trim(), team: (p.team || "").trim() };
      const status = h("div", { class: "part" }, h("p", { class: "writing-line" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), "Saving your answers…"));
      root.append(status);
      try {
        const r = await api("PUT", "/me", { name: prof.firstName || undefined, profile: prof, onboarded: true });
        if (r && r.user) store.setMe(r);
        else store.setMe({ user: { ...(me.user || {}), profile: prof, onboardedAt: new Date().toISOString() } });
        store.del("setupDraft");
        go("/today", { query: { first: "1" }, replace: true });
      } catch (e) {
        busy = false;
        replace(status, notice(e.reason || "Couldn't save that. Try again.", { kind: "error", icon: "info",
          action: button("Try again", { kind: "lake", icon: "refresh", onClick: () => { status.remove(); finish(); } }) }));
      }
    }
    return () => {};
  },
};
