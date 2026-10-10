// today.js: the two-minute morning read (design §3.3, states §3.20). Summary first: the greeting, the alert, Today's move and the
// market pulse; then the stories, what's working in video, questions, dates, industry, and the footer. Sections with nothing in them
// are left out. The cached briefing shows at once and is refreshed quietly, and again whenever the app comes to the front.
import * as store from "../store.js";
import { api, event, ApiError } from "../api.js";
import { go, link } from "../router.js";
import {
  h, icon, replace, button, iconButton, chip, notice, section, sheet, closeSheet, extLink, toast, videoCard, skeleton, ideaChips,
  ago, safeUrl, isIOSSafari, isStandalone, FORMAT_LABEL, EFFORT_LABEL, PLATFORM_LABEL,
} from "../ui.js";
import { easternDate, easternParts, clock12, shortDate, weekdayShort, daysBetween, TZ } from "../shared/time.js";

const LONG_DATE = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default {
  async mount(root, route) {
    const st = { answer: store.latestBriefing(), loading: false, others: false, sig: "" };
    const today = easternDate();
    let alive = true;

    function draw() {
      if (!alive) return;
      const a = st.answer, b = a && a.briefing;
      const fm = firstMove();
      replace(root,
        header(b && !a.stale ? b : null),
        b && b.alert ? alertBanner(b.alert) : null,
        stateNote(a, fm),
        moveCard(b, fm),
        b ? pulse(b) : null,
        b ? stories(b) : null,
        b ? videoSection(b) : null,
        b ? asking(b) : null,
        b ? comingUp(b) : null,
        b ? industry(b) : null,
        footer(a),
      );
      if (!a && st.loading) root.append(firstLoadSkeleton());
    }

    // ---------------------------------------------------------------- the header: greeting, date, the weather pill
    function header(b) {
      const p = easternParts();
      const greet = p.hh < 12 ? "Good morning" : p.hh < 17 ? "Good afternoon" : "Good evening";
      const name = store.firstName();
      const head = h("header", { class: "today-head" },
        h("p", { class: "hello-date", text: LONG_DATE.format(new Date()) }),
        h("h1", { class: "hello", text: name ? `${greet}, ${name}` : greet }));
      if (b && b.weather) head.append(weatherPill(b.weather));
      return head;
    }
    function weatherPill(w) {
      const g = w.golden || {};
      const s = clock12(g.start), e = clock12(g.end);
      const span = s && e ? (s.endsWith(" pm") && e.endsWith(" pm") ? s.replace(" pm", "") + "–" + e : s + "–" + e) : "";
      const rainy = Number(w.rainPct) > 50;
      const text = [w.tempF != null ? `${Math.round(w.tempF)}°` : null, span ? `golden hour ${span}` : null, rainy ? "rain likely, film inside" : null].filter(Boolean).join(" · ");
      if (!text) return null;
      const label = `${w.tempF != null ? Math.round(w.tempF) + " degrees" : ""}${w.summary ? ", " + w.summary : ""}. ${span ? "Golden hour, the best light for filming outside, " + span + "." : ""}${rainy ? " Rain likely: film inside." : ""} Forecast from the ${w.source || "National Weather Service"}.`;
      const kids = [icon(rainy ? "rain" : "sun", 18, { class: rainy ? "pill-rain" : "" }), h("span", { text })];
      return safeUrl(w.url) ? extLink(w.url, { class: "pill", "aria-label": label }, ...kids) : h("span", { class: "pill", "aria-label": label }, ...kids);
    }
    function alertBanner(al) {
      return h("section", { class: "alert-banner", role: "alert", "aria-label": "Weather alert" },
        icon("alert", 24),
        h("div", {},
          h("h2", { text: al.event || "Weather alert" }),
          al.headline ? h("p", { text: al.headline }) : null,
          safeUrl(al.url) ? extLink(al.url, { "aria-label": "Details of the alert from the National Weather Service" }, "Details", icon("ext", 16)) : null));
    }

    // ---------------------------------------------------------------- the states of §3.20
    function stateNote(a, fm) {
      if (!a) return null;
      const b = a.briefing;
      if (!b) {
        return h("div", { class: "state-note" }, notice(fm && fm.state === "done" ? "Your first full briefing arrives tomorrow morning by 7:00. Until then, here's a first move made for you."
          : "Your first full briefing arrives tomorrow morning by 7:00.", { icon: "sun", kind: "calm" }));
      }
      if (a.stale) {
        const p = easternParts();
        const early = p.hh * 60 + p.mm < 7 * 60 + 30;
        const whose = `This is ${b.date ? weekdayLong(b.date) : "an earlier"}'s briefing.`;
        return h("div", { class: "state-note" }, early
          ? notice("Today's briefing is on its way.", { icon: "sun", kind: "calm", sub: whose })
          : notice("Today's briefing didn't come through. Isaac has been told.", { icon: "info", kind: "warn", sub: whose }));
      }
      return null;
    }

    // ---------------------------------------------------------------- Today's move (or her first move, made on the spot)
    function firstMove() {
      const fm = store.get("firstMove");
      if (!fm || fm.date !== today) return null;
      if (fm.state === "writing" && Date.now() - (fm.at || 0) > 3 * 60 * 1000) return { ...fm, state: "failed" };
      return fm;
    }
    function moveCard(b, fm) {
      if (fm && fm.state === "writing") {
        return h("section", { class: "move", "aria-label": "Your first move", "aria-busy": "true" },
          h("span", { class: "rider", text: "Your first move" }),
          h("p", { class: "writing-line" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), "Jarvis is writing your first move… usually 20–40 seconds"),
          skeleton(4));
      }
      if (fm && (fm.state === "failed" || fm.state === "off") && !(b && b.move)) {
        return h("section", { class: "move", "aria-label": "Your first move" },
          h("span", { class: "rider", text: "Your first move" }),
          fm.state === "off" ? notice("Writing isn't switched on yet. Isaac is setting it up.", { kind: "calm", sub: "Your first briefing still arrives tomorrow morning." })
            : notice(fm.reason || "Couldn't write that just now. Try again in a minute.", { kind: "warn", icon: "info",
              action: button("Try again", { kind: "lake", icon: "refresh", onClick: () => startFirstMove(true), disabled: !store.live.online }) }));
      }
      let row = null, why = "", rider = "Today's move", made = false, others = [];
      if (fm && fm.state === "done" && fm.ideaId) {
        row = store.idea(fm.ideaId);
        if (row) { rider = "Your first move"; made = true; why = row.idea.why || ""; others = (fm.others || []).map(id => store.idea(id)).filter(Boolean).map(r => ({ id: r.id, idea: r.idea, script: r.script })); }
      }
      if (!row && b && b.move) {
        const it = (b.ideas || []).find(i => i.id === b.move.ideaId);
        if (it) { row = { id: it.id, idea: it.idea, script: it.script }; why = b.move.why || it.idea.why || ""; others = (b.ideas || []).filter(i => i.id !== it.id); }
      }
      if (!row) return null;
      const idea = row.idea || {};
      const chips = h("div", { class: "chips" });
      if (idea.format) chips.append(chip(FORMAT_LABEL[idea.format] || idea.format));
      if (idea.lengthSec) chips.append(chip(idea.lengthSec + " s"));
      if (idea.effort) chips.append(chip(idea.effort === "listing" ? "At a listing" : `${EFFORT_LABEL[idea.effort] || idea.effort} · no listing`, { kind: "oak" }));
      const card = h("section", { class: "move", "aria-label": rider },
        h("span", { class: "rider", text: rider }),
        made ? h("span", { class: "made-for" }, icon("sparkle", 16), "Made for you, just now") : null,
        h("h2", { text: idea.title || "Today's video" }),
        why ? h("p", { class: "why", text: why }) : null,
        chips);
      const open = h("a", { class: "btn primary", href: link("/idea/" + row.id, { from: "today" }), "data-act": "open-move" }, h("span", { text: row.script ? "Open script" : "Write script" }));
      const acts = h("div", { class: "btns" }, open);
      if (others.length) {
        const more = button(st.others ? "Fewer" : "Something else", { kind: "ghost", onClick: () => { st.others = !st.others; draw(); } });
        more.setAttribute("aria-expanded", st.others ? "true" : "false");
        acts.append(more);
      }
      card.append(acts);
      if (st.others && others.length) {
        const list = h("div", { class: "others" });
        for (const o of others) {
          list.append(h("div", { class: "other" },
            h("h3", { text: o.idea.title }),
            o.idea.hook ? h("q", { class: "small", text: o.idea.hook }) : null,
            ideaChips(o.idea),
            h("div", { class: "btns" }, h("a", { class: "btn lake", href: link("/idea/" + o.id, { from: "today", write: o.script ? null : "1" }) }, h("span", { text: o.script ? "Open script" : "Write script" })))));
        }
        card.append(list);
      }
      return card;
    }

    // ---------------------------------------------------------------- the market pulse: four stat tiles
    function pulse(b) {
      const tiles = (b.pulse || []).filter(t => t && t.display);
      if (!tiles.length) return null;
      return section("Market pulse", h("div", { class: "tiles" }, tiles.map(t => tile(t, b))));
    }
    const SHORT = { rate30: "30-year fixed", medianList: "Median list price", active: "Active listings", dom: "Days on market" };
    const nb = x => String(x || "").replace(/ /g, "\u00a0");
    function areaShort(a) { return a === "Seminole County" ? "Seminole" : a === "U.S. average" ? "" : (a || "").replace(/ County$/, ""); }
    function srcLine(t) { return [t.period, areaShort(t.area), t.source].filter(Boolean).map(nb).join(" · "); }
    function changeText(c) { return c ? [c.display, c.against].filter(Boolean).join(" ") : ""; }
    function arrow(dir) { return icon(dir === "up" ? "arrowUp" : dir === "down" ? "arrowDown" : "arrowFlat", 15, { weight: 2.2 }); }
    function tile(t, b) {
      const label = `${t.label}${t.area ? ", " + t.area : ""}: ${t.display}. ${t.change ? (t.change.dir === "up" ? "Up, " : t.change.dir === "down" ? "Down, " : "") + changeText(t.change) + ". " : ""}${srcLine(t)}. Shows the last 12 values.`;
      const el = h("button", { type: "button", class: "tile", "aria-label": label, "data-key": t.key },
        h("span", { class: "lab", text: SHORT[t.key] || t.label }),
        h("span", { class: "val", text: t.display }),
        t.change ? h("span", { class: "del" }, arrow(t.change.dir), h("span", { text: changeText(t.change) })) : null,
        spark(t.history),
        h("span", { class: "src", text: srcLine(t) }));
      el.addEventListener("click", () => tileSheet(t, b));
      return el;
    }
    // 12 points in the muted ink, the last one in lake blue (the dataviz stat-tile form). The line is drawn in a 100 x 20 box stretched to
    // the tile (its stroke kept at 2 px); the dot is a round element placed by percent, so it never stretches into an oval
    function spark(hist) {
      const pts = (hist || []).map(p => Number(p.value)).filter(v => !isNaN(v)).slice(-12);
      if (pts.length < 2) return null;
      const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
      const xy = pts.map((v, i) => [i / (pts.length - 1) * 100, 18 - (v - lo) / span * 16]);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 20"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true");
      const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      pl.setAttribute("points", xy.map(([x, y]) => x.toFixed(2) + "," + y.toFixed(2)).join(" "));
      pl.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(pl);
      const last = xy[xy.length - 1];
      const dot = h("i", { class: "spark-dot", style: { left: last[0] + "%", top: (last[1] / 20 * 100) + "%" } });
      return h("span", { class: "spark", "aria-hidden": "true" }, svg, h("span", { class: "spark-box" }, dot));
    }
    function fmtValue(t, v) {
      if (v == null || isNaN(v)) return "";
      const d = String(t.display || "");
      if (d.endsWith("%")) return Number(v).toFixed(2) + "%";
      if (d.startsWith("$")) return "$" + Math.round(v).toLocaleString("en-US");
      return Math.round(v).toLocaleString("en-US");
    }
    function fmtPeriod(t, ymd) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
      if (!m) return ymd || "";
      return t.key === "rate30" ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : `${MONTHS[+m[2] - 1]} ${m[1]}`;
    }
    function tileSheet(t, b) {
      const hist = (t.history || []).slice(-12);
      const facts = h("div", { class: "facts" });
      if (t.streak && t.streak.n >= 2) facts.append(chip(`${t.streak.dir === "up" ? "Up" : "Down"} ${t.streak.n} ${t.streak.unit}s in a row`, { kind: "plain" }));
      if (t.high52 != null && Number(t.high52) === Number(t.value)) facts.append(chip(t.key === "rate30" ? "Highest in a year" : "Highest in 12 months", { kind: "plain" }));
      if (t.low52 != null && Number(t.low52) === Number(t.value)) facts.append(chip(t.key === "rate30" ? "Lowest in a year" : "Lowest in 12 months", { kind: "plain" }));
      const table = h("table", { class: "values" },
        h("caption", { class: "sr-only", text: `${t.label}, the last ${hist.length} values` }),
        h("thead", {}, h("tr", {}, h("th", { scope: "col", text: t.key === "rate30" ? "Week of" : "Month" }), h("th", { scope: "col", text: t.label }))),
        h("tbody", {}, hist.slice().reverse().map((p, i) => h("tr", { class: i === 0 ? "latest" : "" }, h("td", { text: fmtPeriod(t, p.date) }), h("td", { text: fmtValue(t, p.value) })))));
      const say = t.say || "";
      const content = h("div", { class: "tile-sheet stack" },
        h("p", { class: "muted", text: [t.area, t.period].filter(Boolean).join(" · ") }),
        h("p", { class: "bigval", text: t.display }),
        t.change ? h("p", { class: "del" }, arrow(t.change.dir), h("span", { text: changeText(t.change) })) : null,
        facts.childNodes.length ? facts : null,
        say ? h("blockquote", { class: "say-quote", text: say }) : null,
        h("div", { class: "btns" },
          say ? button("Say it on camera", { kind: "lake", icon: "film", onClick: () => { closeSheet(); prompterText(say, t.label); } }) : null,
          button("Make a video", { kind: "primary", icon: "sparkle", onClick: () => { closeSheet(); seed("pulse", t.key, b.date); } })),
        table,
        h("div", { class: "srclinks" }, h("span", { text: "Source:" }), safeUrl(t.sourceUrl) ? extLink(t.sourceUrl, { class: "srclink" }, t.source, icon("ext", 14)) : h("span", { text: t.source })),
        t.area === "U.S. average" ? h("p", { class: "small muted", text: "A U.S. average, not a Lake Mary number." }) : null);
      sheet(t.label, content);
    }

    // ---------------------------------------------------------------- around Lake Mary
    function stories(b) {
      const items = b.local || [];
      if (!items.length) return null;
      return section("Around Lake Mary", h("div", { class: "list" }, items.map(s => h("article", { class: "item story" },
        h("p", { class: "src-line", text: [s.source, ago(s.at)].filter(Boolean).join(" · ") }),
        h("h3", { text: s.title }),
        s.why ? h("p", { class: "line" }, h("b", { text: "Why it matters: " }), s.why) : null,
        s.angle ? h("p", { class: "line" }, h("b", { text: "Video angle: " }), s.angle) : null,
        h("div", { class: "row" },
          safeUrl(s.url) ? extLink(s.url, { class: "btn ghost", "aria-label": `Read "${s.title}" on ${s.source || "its site"}` }, h("span", { text: "Read" }), icon("ext", 16)) : null,
          button("Make a video", { kind: "lake", onClick: () => seed("local", s.id, b.date) }))))));
    }

    // ---------------------------------------------------------------- what's working in real estate video
    function videoSection(b) {
      const trends = b.trends || [], audio = b.audio || [], nearby = b.nearby || [], top = b.topVideos || [];
      const parts = [];
      for (const [i, t] of trends.entries()) {
        const vids = (t.videos || []).slice(0, 3);
        parts.push(h("article", { class: "card trend" },
          h("div", { class: "row nowrap" }, h("h3", { class: "spacer", text: t.name }), t.platform ? chip(PLATFORM_LABEL[t.platform] || t.platform, { kind: "plain" }) : null),
          t.what ? h("p", { text: t.what }) : null,
          t.why ? h("p", { class: "evidence" }, icon("info", 17), h("span", { text: t.why })) : null,
          t.how ? h("p", { class: "how" }, h("b", { text: "For you: " }), t.how) : null,
          vids.length ? h("div", { class: "videos" }, vids.map(v => videoCard(v))) : null,
          (t.sources || []).filter(s => safeUrl(s.url)).length ? h("div", { class: "srclinks" }, h("span", { text: "From" }),
            (t.sources || []).filter(s => safeUrl(s.url)).map(s => extLink(s.url, { class: "srclink" }, s.title || "the source", icon("ext", 14)))) : null,
          h("div", { class: "row" }, button("Try it", { kind: "primary", onClick: () => seed("trend", String(i), b.date) }))));
      }
      if (!trends.length && top.length) {
        parts.push(h("div", { class: "card" }, h("p", { class: "small muted", text: "The most-watched real estate videos on YouTube this week. Tap one to see how it's done." }),
          h("div", { class: "videos grid" }, top.slice(0, 6).map(v => videoCard(v)))));
      }
      const out = [];
      if (parts.length) out.push(section(trends.length ? "Working in real estate video" : "Most-watched real estate videos this week", h("div", { class: "stack" }, parts)));
      if (audio.length) {
        out.push(section("Trending audio this week", h("div", { class: "list" }, audio.map(a => h("article", { class: "item" },
          h("div", { class: "row nowrap" }, h("h3", { class: "spacer", text: a.name }), a.platform ? chip(PLATFORM_LABEL[a.platform] || a.platform, { kind: "plain" }) : null),
          a.how ? h("p", { class: "line", text: a.how }) : null,
          a.cleared === true ? h("span", { class: "audio-state ok" }, icon("check", 17), "Cleared for business accounts")
            : a.cleared === false ? h("span", { class: "audio-state check" }, icon("alert", 17), "Not cleared for business accounts: use your own audio")
              : h("span", { class: "audio-state check" }, icon("info", 17), "Check it's in the Commercial Music Library before using it on a business account"),
          a.source && safeUrl(a.source.url) ? h("div", { class: "srclinks" }, h("span", { text: "From" }), extLink(a.source.url, { class: "srclink" }, a.source.title || "the source", icon("ext", 14))) : null)))));
      }
      if (nearby.length) {
        out.push(section("Nearby agents this week", h("div", { class: "card" }, h("div", { class: "videos" }, nearby.slice(0, 3).map(v => videoCard(v))))));
      }
      return out;
    }

    // ---------------------------------------------------------------- people are asking
    function asking(b) {
      const qs = b.asking || [];
      if (!qs.length) return null;
      return section("People are asking", h("div", { class: "list" }, qs.map(q => h("article", { class: "item ask" },
        h("q", { text: q.question }),
        q.angle ? h("p", { class: "line muted", text: q.angle }) : null,
        h("div", { class: "row" }, button("Answer this on camera", { kind: "lake", icon: "film", onClick: () => seed("asking", q.id, b.date) })),
        q.video && safeUrl(q.video.url) ? extLink(q.video.url, { class: "from", "aria-label": `From the comments on the video "${q.video.title}". Opens YouTube.` }, `From the comments on “${q.video.title}”`) : null))));
    }

    // ---------------------------------------------------------------- coming up
    function comingUp(b) {
      const cal = (b.calendar || []).filter(c => c && c.date >= today).slice(0, 8);
      if (!cal.length) return null;
      const month = today.slice(5, 7);
      return section("Coming up", h("div", { class: "list" }, cal.map(c => {
        const idx = (b.calendar || []).indexOf(c);
        const days = daysBetween(today, c.date);
        const otherMonth = c.date.slice(5, 7) !== month;
        const r = h("button", { type: "button", class: "cal-row", "aria-label": `${weekdayLong(c.date)}, ${shortDate(c.date, { year: false })}: ${c.label}. ${c.angle || ""} Make a video about it.` },
          h("span", { class: "cal-date", "aria-hidden": "true" }, h("b", { text: days === 0 ? "Today" : days === 1 ? "Tmrw" : weekdayShort(c.date) }), h("span", { text: String(+c.date.slice(8, 10)) })),
          h("span", { class: "cal-text" }, h("span", { class: "lab", text: (otherMonth ? shortDate(c.date, { year: false }) + " · " : "") + c.label }), c.angle ? h("span", { class: "ang", text: c.angle }) : null),
          icon("next", 18));
        r.addEventListener("click", () => seed("calendar", String(idx), b.date));
        return r;
      })));
    }

    // ---------------------------------------------------------------- industry
    function industry(b) {
      const items = b.industry || [];
      if (!items.length) return null;
      return section("Industry", h("div", { class: "list" }, items.map(s => h("article", { class: "item" },
        h("p", { class: "src-line", text: [s.source, ago(s.at)].filter(Boolean).join(" · ") }),
        h("h3", { text: s.title }),
        s.why ? h("p", { class: "line" }, h("b", { text: "Why it matters here: " }), s.why) : null,
        h("div", { class: "row" },
          safeUrl(s.url) ? extLink(s.url, { class: "btn ghost", "aria-label": `Read "${s.title}" on ${s.source || "its site"}` }, h("span", { text: "Read" }), icon("ext", 16)) : null,
          button("Make a video", { kind: "lake", onClick: () => seed("industry", s.id, b.date) }))))));
    }

    // ---------------------------------------------------------------- the footer
    function footer(a) {
      const b = a && a.briefing;
      const foot = h("footer", { class: "today-foot" });
      if (b) {
        const srcs = b.sources || [], ok = srcs.filter(s => s.ok).length;
        const when = b.createdAt ? clockOf(b.createdAt) : "";
        const line = h("div", { class: "foot-line" },
          h("span", { text: when ? `Updated ${when}` : "Updated" }), h("span", { "aria-hidden": "true", text: "·" }));
        const srcBtn = button(`${ok} of ${srcs.length} sources`, { kind: "quiet", onClick: () => sourcesSheet(srcs) });
        srcBtn.setAttribute("data-act", "sources");
        line.append(srcBtn);
        foot.append(line);
        if (b.lite) foot.append(h("p", { class: "lite-note" }, icon("info", 18), h("span", {}, h("b", { text: "A simpler briefing today. " }), "Writing wasn't available this morning, so this one is plainer. Every number and link is still from its source.")));
      }
      const refresh = button(st.loading ? "Refreshing…" : "Refresh", { kind: "ghost", icon: "refresh", onClick: () => load(true), disabled: st.loading });
      refresh.setAttribute("data-act", "refresh");
      foot.append(h("div", { class: "row" }, refresh));
      if (isIOSSafari() && !isStandalone() && !store.get("installDismissed")) foot.append(installCard());
      return foot;
    }
    function sourcesSheet(srcs) {
      sheet("Where this came from", h("div", { class: "stack" },
        h("p", { class: "muted", text: "Every source the morning run tried. A source that didn't answer is left out; its section is skipped, never guessed." }),
        h("ul", { class: "src-list" }, srcs.map(s => h("li", { class: s.ok ? "" : "bad" },
          h("span", { class: "st" }, icon(s.ok ? "check" : "alert", 18)),
          h("span", { text: s.name }),
          h("span", { class: "n", text: s.ok ? (s.n != null ? `${s.n} item${s.n === 1 ? "" : "s"}` : "ok") : (s.error || "didn't answer") }))))));
    }
    function installCard() {
      const card = h("section", { class: "card install-card", "aria-label": "Put Jarvis on your home screen" },
        h("h2", { text: "Put Jarvis on your home screen" }),
        h("p", { class: "how" }, "Tap ", h("span", { class: "glyph", "aria-label": "Share" }, icon("share", 18)), " Share, then ",
          h("span", { class: "glyph", "aria-label": "Add to Home Screen" }, icon("addhome", 18)), " Add to Home Screen."),
        h("p", { class: "small muted", text: "It opens full screen, works offline, and can nudge you at 7 am." }),
        h("div", { class: "row" }, button("Not now", { kind: "quiet", onClick: () => { store.set("installDismissed", true); draw(); } })));
      return card;
    }
    function firstLoadSkeleton() {
      return h("div", { class: "stack", "aria-label": "Loading today's briefing", "aria-busy": "true" },
        h("span", { class: "sk-block", style: { height: "190px", "margin-top": "26px" } }),
        h("div", { class: "tiles" }, [0, 1, 2, 3].map(() => h("span", { class: "sk-block", style: { height: "128px" } }))),
        skeleton(5));
    }

    // ---------------------------------------------------------------- actions
    function seed(kind, id, date) { go("/studio", { query: { seed: `${kind}:${id}`, date, go: "1" } }); }
    function prompterText(text, title) {
      sessionStorage.setItem("jarvis:prompterText", JSON.stringify({ text, title }));
      go("/prompter/text", { query: { from: "today" } });
    }

    async function load(manual = false) {
      if (st.loading) return;
      st.loading = true;
      if (manual || !st.answer) draw();
      try {
        const ans = await api("GET", "/briefing/today", undefined, { timeout: 20000 });
        store.saveBriefing(ans);
        st.answer = store.latestBriefing() || { briefing: ans.briefing, stale: ans.stale, date: ans.date };
        if (ans && !ans.briefing) st.answer = { briefing: null, stale: false, date: ans.date, fetchedAt: Date.now() };
        if (manual) toast("Up to date");
      } catch (e) {
        if (manual && e.kind !== "aborted") toast(e.kind === "offline" ? "You're offline. Showing what loaded earlier." : e.reason);
      } finally {
        st.loading = false;
        const a = st.answer, sig = a ? JSON.stringify([a.date, a.stale, a.briefing && a.briefing.createdAt, a.briefing && a.briefing.date]) : "";
        if (manual || sig !== st.sig || !a) { st.sig = sig; draw(); }
      }
    }

    // her first move, written on the spot after the five questions (design §3.7 step 5)
    async function startFirstMove(retry = false) {
      const fm = store.get("firstMove");
      if (fm && fm.date === today && !retry && (fm.state === "done" || (fm.state === "writing" && Date.now() - (fm.at || 0) < 3 * 60 * 1000))) return;
      if (store.aiOff()) { store.set("firstMove", { date: today, state: "off", at: Date.now() }); draw(); return; }
      store.set("firstMove", { date: today, state: "writing", at: Date.now() });
      draw();
      try {
        const p = store.profile();
        const r = await api("POST", "/ideas", { mode: "first", options: p.defaults || undefined }, { timeout: 90000 });
        const rows = (r && r.ideas) || [];
        store.saveIdeas(rows);
        if (!rows.length) throw new ApiError("busy");
        let row = rows[0];
        const s = await api("POST", `/ideas/${encodeURIComponent(row.id)}/script`, {}, { timeout: 90000 });
        if (s && s.idea) { row = s.idea; store.saveIdea(row); }
        store.set("firstMove", { date: today, state: "done", ideaId: row.id, others: rows.slice(1).map(x => x.id), at: Date.now() });
        event("script");
      } catch (e) {
        store.set("firstMove", { date: today, state: e.kind === "not_connected" ? "off" : "failed", reason: e.reason, at: Date.now() });
      }
      draw();
    }

    draw();
    const offs = [store.on("front", () => load()), store.on("online", draw)];
    load();
    if (route.query.first === "1") { history.replaceState(history.state, "", "#/today"); startFirstMove(); }
    return () => { alive = false; offs.forEach(f => f()); };
  },
};

function weekdayLong(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}
function clockOf(iso) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm"); }
  catch { return ""; }
}
