// plan.js: ideas from saved to posted against her weekly goal (design §3.6). The week as a ring and her streak of weeks met; a
// segmented control Saved · Scripted · Filmed · Posted; rows with the topic, platforms and planned day, a menu that moves or removes;
// a posted row asks for the post's link and, three days later, "How did it do?"; the topic mix of the last 30 days (labels and counts,
// the bar's colours in the design's fixed order); Plan my week at the bottom.
import * as store from "../store.js";
import { api, event } from "../api.js";
import { go, link } from "../router.js";
import {
  h, icon, replace, button, iconButton, chip, choice, notice, sheet, closeSheet, toast, svgEl, safeUrl, extLink,
  PILLARS, PILLAR_LABEL, PLATFORM_LABEL, STATUS_LABEL,
} from "../ui.js";
import { easternDate, addDays, weekStart, weekdayShort, daysBetween, shortDate } from "../shared/time.js";

const TABS = ["saved", "scripted", "filmed", "posted"];

export default {
  async mount(root) {
    const st = { tab: TABS.includes(store.get("planTab")) ? store.get("planTab") : "scripted", loading: true };
    let alive = true;
    const today = easternDate();

    const rowsInPlan = () => Object.values(store.ideas()).filter(r => TABS.includes(r.status));
    const dayOf = iso => { try { return easternDate(new Date(iso)); } catch { return null; } };

    function draw() {
      if (!alive) return;
      const rows = rowsInPlan();
      const kids = [h("h1", { class: "page-title", text: "Plan" }), goalCard(rows)];
      if (!rows.length && !st.loading) {
        kids.push(h("div", { class: "card empty", "data-empty": "plan" }, icon("plan", 36),
          h("p", { text: "Nothing planned yet. Save an idea from Today or the Studio, or tap Plan my week." }),
          planWeek()));
      } else {
        kids.push(h("div", { class: "section" }, tabs(rows), list(rows)), mix(rows), h("div", { class: "section" }, planWeek()));
      }
      replace(root, ...kids);
    }

    // ---------------------------------------------------------------- the week against her goal, and the streak
    function postedIn(rows, monday) {
      const end = addDays(monday, 6);
      return rows.filter(r => r.status === "posted" && r.postedAt && (d => d && d >= monday && d <= end)(dayOf(r.postedAt))).length;
    }
    function goalCard(rows) {
      const goal = Math.max(1, Math.min(7, Number(store.profile().weeklyGoal) || 3));
      const monday = weekStart(today);
      const done = postedIn(rows, monday);
      let streak = 0;
      for (let w = addDays(monday, -7), i = 0; i < 104 && postedIn(rows, w) >= goal; w = addDays(w, -7), i++) streak++;
      if (done >= goal) streak++;
      const C = 2 * Math.PI * 30, frac = Math.min(1, done / goal);
      const svg = svgEl("svg", { width: 76, height: 76, viewBox: "0 0 76 76", "aria-hidden": "true" });
      svg.append(svgEl("circle", { cx: 38, cy: 38, r: 30, fill: "none", "stroke-width": 8, class: "ring-track" }));
      if (frac > 0) svg.append(svgEl("circle", { cx: 38, cy: 38, r: 30, fill: "none", "stroke-width": 8, "stroke-linecap": "round", class: "ring-fill",
        "stroke-dasharray": `${(frac * C).toFixed(1)} ${C.toFixed(1)}`, transform: "rotate(-90 38 38)" }));
      const t = svgEl("text", { x: 38, y: 44, "text-anchor": "middle", class: "ring-text" }); t.textContent = `${done}/${goal}`;
      svg.append(t);
      const line = streak >= 2 ? `Goal met ${streak} weeks running` : streak === 1 ? (done >= goal ? "Goal met this week" : "Goal met last week")
        : done >= goal ? "Goal met this week" : `${goal - done} more to meet your goal of ${goal}`;
      return h("section", { class: "card goal", "aria-label": `${done} of ${goal} posted this week. ${line}.` },
        svg, h("div", {}, h("p", { class: "big", text: `${done} of ${goal} posted this week` }), h("p", { text: line })));
    }

    // ---------------------------------------------------------------- the four stages
    function tabs(rows) {
      const bar = h("div", { class: "seg", role: "tablist", "aria-label": "Stage" });
      for (const t of TABS) {
        const n = rows.filter(r => r.status === t).length;
        const b = h("button", { type: "button", role: "tab", id: "tab-" + t, "aria-selected": st.tab === t ? "true" : "false", "aria-controls": "plan-list", "data-tab": t },
          h("span", { text: STATUS_LABEL[t] }), h("span", { class: "count", text: String(n), "aria-label": `${n} ideas` }));
        b.addEventListener("click", () => { st.tab = t; store.set("planTab", t); draw(); });
        bar.append(b);
      }
      return bar;
    }
    function sortRows(a, b) {
      if (st.tab === "posted") return (b.postedAt || "").localeCompare(a.postedAt || "");
      const pa = a.planDate || "9999", pb = b.planDate || "9999";
      return pa === pb ? (b.updatedAt || "").localeCompare(a.updatedAt || "") : pa.localeCompare(pb);
    }
    function when(r) {
      if (r.status === "posted" && r.postedAt) { const d = dayOf(r.postedAt); return d ? (daysBetween(d, today) < 7 ? weekdayShort(d) : shortDate(d, { year: false })) : ""; }
      if (!r.planDate) return "";
      const n = daysBetween(today, r.planDate);
      return n === 0 ? "Today" : n === 1 ? "Tmrw" : n > 1 && n < 7 ? weekdayShort(r.planDate) : shortDate(r.planDate, { year: false });
    }
    function list(rows) {
      const mine = rows.filter(r => r.status === st.tab).sort(sortRows);
      const panel = h("div", { id: "plan-list", role: "tabpanel", "aria-labelledby": "tab-" + st.tab, class: "list", style: { "margin-top": "12px" } });
      if (!mine.length) {
        panel.append(h("p", { class: "empty", text: st.tab === "posted" ? "Nothing posted yet this month. When you post, mark it here." : `Nothing ${STATUS_LABEL[st.tab].toLowerCase()} right now.` }));
        return panel;
      }
      for (const r of mine) panel.append(prow(r));
      return panel;
    }
    function prow(r) {
      const i = r.idea || {};
      const chips = h("div", { class: "chips" });
      if (i.pillar) chips.append(chip(PILLAR_LABEL[i.pillar] || i.pillar, { kind: "plain", topic: i.pillar }));
      for (const p of i.platforms || []) chips.append(chip(PLATFORM_LABEL[p] || p));
      const open = h("a", { class: "open", href: link("/idea/" + r.id, { from: "plan" }), "aria-label": `${i.title || "An idea"}. Open the script.` },
        h("h3", { text: (r.script && r.script.title) || i.title || "An idea" }), chips);
      const w = when(r);
      const right = h("div", { class: "row nowrap" },
        w ? h("span", { class: "when", text: w }) : null,
        iconButton("more", `More for “${i.title || "this idea"}”`, () => menu(r), { cls: "plain" }));
      const el = h("div", { class: "prow", "data-id": r.id }, open, right);
      if (r.status === "posted") {
        if (r.postUrl && safeUrl(r.postUrl)) el.append(extLink(r.postUrl, { class: "postlink" }, icon("link", 16), "Open the post"));
        const d = r.postedAt && dayOf(r.postedAt);
        if (r.outcome) el.append(h("div", { class: "chips", style: { "grid-column": "1 / -1" } }, chip(r.outcome === "great" ? "Did great" : r.outcome === "ok" ? "Did OK" : "Flopped", { kind: r.outcome === "great" ? "oak" : "plain" })));
        else if (d && daysBetween(d, today) >= 3) {
          const box = h("div", { class: "outcome" }, h("p", { text: "How did it do?" }),
            h("div", { class: "choices" }, [["great", "Great"], ["ok", "OK"], ["flop", "Flop"]].map(([k, label]) => choice(label, false, () => outcome(r, k)))));
          el.append(box);
        }
      }
      return el;
    }

    // ---------------------------------------------------------------- moving and removing
    function menu(r) {
      const i = r.idea || {};
      const moves = h("div", { class: "choices", role: "group", "aria-label": "Move to" });
      for (const s of TABS) {
        const c = choice(STATUS_LABEL[s], r.status === s, () => { closeSheet(); s === "posted" ? posted(r) : move(r, s); });
        c.setAttribute("data-status", s);
        if (s === "scripted" && !r.script) c.disabled = true;
        moves.append(c);
      }
      const date = h("input", { class: "input", type: "date", value: r.planDate || "", min: addDays(today, -30), "aria-label": "Plan a day" });
      date.addEventListener("change", () => setDay(r, date.value || null));
      sheet(i.title || "This idea", h("div", { class: "stack" },
        h("div", { class: "field" }, h("span", { class: "label", text: "Move to" }), moves),
        h("div", { class: "field" }, h("label", { text: "Plan a day" }), date),
        h("div", { class: "stack" },
          h("a", { class: "btn lake block", href: link("/idea/" + r.id, { from: "plan" }), on: { click: () => closeSheet() } }, h("span", { text: r.script ? "Open script" : "Open" })),
          button("Remove from Plan", { kind: "ghost", cls: "danger block", icon: "trash", onClick: () => { closeSheet(); remove(r); } }))));
    }
    async function patch(r, body) {
      const res = await api("PATCH", `/ideas/${encodeURIComponent(r.id)}`, body);
      if (res && res.idea) store.saveIdea(res.idea);
      return res && res.idea;
    }
    async function move(r, s) {
      try { const x = await patch(r, { status: s }); if (x) { st.tab = TABS.includes(x.status) ? x.status : st.tab; store.set("planTab", st.tab); } toast(`Moved to ${STATUS_LABEL[s]}`); draw(); }
      catch (e) { toast(e.reason); }
    }
    function posted(r) {
      const inp = h("input", { class: "input", type: "url", inputMode: "url", placeholder: "https://www.instagram.com/reel/…", "aria-label": "Link to the post (optional)", autocomplete: "off" });
      inp.setAttribute("autocapitalize", "off");
      sheet("Posted it?", h("div", { class: "stack" },
        h("p", { class: "muted", text: "Paste the post's link if you like. In three days Plan asks how it did, and the next ideas lean toward what worked." }),
        inp,
        button("Mark posted", { kind: "primary", cls: "block", onClick: async () => {
          const u = safeUrl(inp.value.trim());
          closeSheet();
          try { await patch(r, u ? { status: "posted", postUrl: u } : { status: "posted" }); event("posted"); st.tab = "posted"; store.set("planTab", "posted"); toast("Posted. Nice work!"); draw(); }
          catch (e) { toast(e.reason); }
        } })));
    }
    async function setDay(r, d) {
      try { await patch(r, { planDate: d }); toast(d ? `Planned for ${weekdayShort(d)}, ${shortDate(d, { year: false })}` : "Day cleared"); draw(); }
      catch (e) { toast(e.reason); }
    }
    async function remove(r) {
      const was = r.status;
      try {
        await patch(r, { status: "dismissed" });
        draw();
        toast("Removed from your Plan", { action: { label: "Undo", run: async () => { try { await patch(r, { status: was }); draw(); } catch (e) { toast(e.reason); } } } });
      } catch (e) { toast(e.reason); }
    }
    async function outcome(r, k) {
      try { await patch(r, { outcome: k }); toast(k === "great" ? "Great! More like this is coming." : k === "ok" ? "Noted." : "Noted. Jarvis will try a different angle."); draw(); }
      catch (e) { toast(e.reason); }
    }

    // ---------------------------------------------------------------- her mix over the last 30 days
    function mix(rows) {
      const since = addDays(today, -30);
      const recent = rows.filter(r => { const d = dayOf(r.postedAt || r.updatedAt || r.createdAt); return d && d >= since; });
      const counts = Object.fromEntries(PILLARS.map(p => [p, 0]));
      for (const r of recent) if (r.idea && counts[r.idea.pillar] !== undefined) counts[r.idea.pillar]++;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const bar = h("div", { class: ["mixbar", total ? "" : "empty"], role: "img",
        "aria-label": total ? "Your mix: " + PILLARS.filter(p => counts[p]).map(p => `${PILLAR_LABEL[p]} ${counts[p]}`).join(", ") : "No ideas in the last 30 days yet" });
      for (const p of PILLARS) if (counts[p]) bar.append(h("i", { style: { "--k": `var(--t-${p})`, "flex-grow": String(counts[p]), "flex-basis": "0" }, "data-pillar": p }));
      const legend = h("div", { class: "legend", "aria-hidden": "true" }, PILLARS.map(p => h("span", { class: counts[p] ? "" : "zero", style: { "--k": `var(--t-${p})` } },
        h("i"), `${PILLAR_LABEL[p]} ${counts[p]}`)));
      const lean = total >= 4 ? PILLARS.filter(p => counts[p] === 0).map(p => PILLAR_LABEL[p].toLowerCase()) : [];
      return h("section", { class: "section mix", "aria-labelledby": "h-mix" },
        h("h2", { class: "eyebrow", id: "h-mix", text: "Your mix, last 30 days" }),
        h("div", { class: "card stack" }, bar, legend,
          lean.length ? h("p", { class: "small muted", text: `Nothing on ${lean.join(", ")} lately. Plan my week spreads ideas across topics.` }) : null));
    }

    function planWeek() {
      const b = button("Plan my week", { kind: "primary", cls: "block big", icon: "calendar", onClick: () => go("/studio", { query: { mode: "week", go: "1" } }) });
      b.setAttribute("data-act", "plan-week");
      return b;
    }

    // open on a stage that has something in it (her last choice when it does)
    const settle = () => {
      const rows = rowsInPlan();
      if (!rows.some(r => r.status === st.tab)) { const t = ["scripted", "saved", "filmed", "posted"].find(k => rows.some(r => r.status === k)); if (t) st.tab = t; }
    };
    draw();
    try {
      const r = await api("GET", "/ideas");
      if (r && Array.isArray(r.ideas)) store.saveIdeas(r.ideas, { replace: true });
    } catch { /* the cached list stands */ }
    st.loading = false;
    settle();                                     // on the fresh list (or, offline, the cached one)
    draw();
    const offs = [store.on("front", async () => { try { const r = await api("GET", "/ideas"); if (r && r.ideas) { store.saveIdeas(r.ideas, { replace: true }); draw(); } } catch { /* */ } })];
    return () => { alive = false; offs.forEach(f => f()); };
  },
};
