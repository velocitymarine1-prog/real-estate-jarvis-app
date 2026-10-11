// compliance.js (browser-safe): the check before posting (design §3.13).
//
// It reads what she says, what's on screen, the caption and the hashtags, and returns findings:
//   { rule, severity: "amber"|"note", text, why, match?,
//     fix: null | { label, kind: "replace"|"append"|"remove"|"tweak", find?, replace?, text?, tweak?, note?, before?, at? } }
// fix.at lists where the check matched ({ path, n }: the n-th occurrence of `find` in that field; { tag } for a hashtag),
// so a one-tap fix changes only those places. [] means "Ready to post". The word lists live in data/fair-housing.json,
// passed in as ctx.rules (the browser fetches it; Node and the Worker import or read it), so this module never loads JSON.

import { extractNumbers, suppliedFrom, unknownNumbers, numberMatches } from "./numbers.js";
import { normWords } from "./text.js";
import { RULES } from "./models.js";

const SEVERITY = { amber: 0, note: 1 };
const PHRASE_RULES = ["fh.people", "fh.protected", "fh.safe", "fh.schools", "fh.places", "fh.primary", "promise", "regz", "politics"];
const SCHOOL_NAME = /\b(?:[A-Z][\w'’.-]*\s+){1,4}(?:Elementary|Middle|High|Academy|Prep|K-8)\b/;
const HEDGE = /\b(?:no|not|never|nothing|nobody|no one|without|if|whether|can['’]?t|cannot|isn['’]t|aren['’]t|won['’]t|don['’]t|doesn['’]t|nor|neither)\b/i;
// A fact's range ("12-month range $389,963 to $400,000", "a 52-week high of 7.9%"): its numbers are incidental.
const RANGE_ZONE = /\b(?:\d+-(?:week|month|year)\s+)?(?:range|high|low)\b[^;()]*/gi;
// …and a script cites one of them only when it talks about a high, a low or a range.
const RANGE_WORDS = /\b(?:high|low|highest|lowest|peak|record|range|top|bottom|most|least)\b/i;
// Sentences: a period between digits ("6.85%") or after an initial or a common abbreviation doesn't end one.
const SENTENCE = /(?:[^.!?\n]|(?<=\d)\.(?=\d)|(?<=\b[A-Z])\.(?=\s)|(?<=\b(?:St|Dr|Ave|Blvd|Rd|Mr|Mrs|Ms|Jr|Sr|vs|No|Mt|Ft|etc|approx))\.(?=\s))+(?:[.!?]+["”’)]*|$)[ \t]*/g;

// ---------------------------------------------------------------------------------------------------------------
// The rules data, compiled once per object (the Worker keeps its copy for the isolate's life).

const compiledCache = new WeakMap();

function regex(src, caseSensitive) {
  try {
    return new RegExp(src, caseSensitive ? "g" : "gi");
  } catch {
    return null; // a bad pattern in the data must not break the whole check
  }
}

function compilePattern(p) {
  if (typeof p === "string") return { re: regex(escapeRe(p).replace(/\\? /g, "[\\s-]+"), false), raw: { phrase: p }, replaceIf: [] };
  if (!p || typeof p !== "object" || typeof p.re !== "string") return null;
  const re = regex(p.re, p.case === true);
  if (!re) return null;
  const replaceIf = (Array.isArray(p.replaceIf) ? p.replaceIf : [])
    .map((r) => (r && typeof r.when === "string" ? { when: regex(r.when, false), replace: String(r.replace ?? "") } : null))
    .filter((r) => r && r.when);
  return { re, raw: p, replaceIf };
}

function compileRules(rules) {
  const root = rules && typeof rules === "object" ? (rules.rules && typeof rules.rules === "object" ? rules.rules : rules) : null;
  if (!root) return {};
  if (compiledCache.has(root)) return compiledCache.get(root);
  const out = {};
  for (const [id, r] of Object.entries(root)) {
    if (!r || typeof r !== "object") continue;
    out[id] = {
      ...r,
      id,
      severity: r.severity === "note" ? "note" : "amber",
      phrasesC: (Array.isArray(r.phrases) ? r.phrases : []).map(compilePattern).filter(Boolean),
      exceptC: (Array.isArray(r.except) ? r.except : []).map(compilePattern).filter(Boolean),
      notWhenRe: typeof r.notWhen === "string" ? regex(r.notWhen, false) : null,
      unlessCreditRe: typeof r.unlessCredit === "string" ? regex(r.unlessCredit, false) : null,
      safeRe: typeof r.safe === "string" ? regex(r.safe, false) : null,
      namedC: (Array.isArray(r.named) ? r.named : []).map(compilePattern).filter(Boolean),
    };
  }
  compiledCache.set(root, out);
  return out;
}

/** Compile the rules data ahead of time (the Worker calls this at module scope, so no request pays for it). */
export function prepareRules(rules) {
  compileRules(rules);
  // Warm the number and phrase paths once, so a request's first check isn't the one that pays for it.
  checkScript({ hook: { say: "Homes sell 30% faster near churches, 7.40%, Oct 8, 2026.", onScreen: "", shot: "" }, caption: "x", hashtags: ["#LakeMaryFL"] }, { rules, brokerage: "x" });
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function test(re, s) {
  if (!re) return false;
  re.lastIndex = 0;
  const r = re.test(s);
  re.lastIndex = 0;
  return r;
}

function fill(tpl, vars) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (all, k) => (vars[k] !== undefined ? String(vars[k]) : all));
}

/** Give `repl` the case shape of `orig`: "Master bedroom" → "Primary bedroom", "MASTER" → "PRIMARY". */
function matchCase(orig, repl) {
  if (!repl) return repl;
  if (/[A-Za-z]/.test(orig) && orig === orig.toUpperCase() && orig.replace(/[^A-Za-z]/g, "").length > 1) return repl.toUpperCase();
  if (/^[A-Z]/.test(orig)) return repl[0].toUpperCase() + repl.slice(1);
  if (/^[a-z]/.test(orig) && /^[A-Z][a-z]/.test(repl)) return repl[0].toLowerCase() + repl.slice(1);
  return repl;
}

/** "#LakeMaryFL" → "Lake Mary FL" (so the word lists can read hashtags). */
function hashtagWords(h) {
  return String(h ?? "").replace(/^#+/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2").replace(/_/g, " ");
}

/** "Perfect For you" → "#PerfectForYou"; "" → null. */
function toHashtag(words) {
  const body = String(words ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return body ? `#${body}` : null;
}

// Does text[i] end a sentence? Not the point in "6.85".
function endsSentence(text, i) {
  if (!/[.!?\n]/.test(text[i])) return false;
  return !(text[i] === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""));
}

function sentenceAround(text, start, end) {
  let a = start, b = end;
  while (a > 0 && !endsSentence(text, a - 1)) a--;
  while (b < text.length && !endsSentence(text, b)) b++;
  return text.slice(a, b);
}

function hedgedBefore(text, start) {
  const before = text.slice(Math.max(0, start - 48), start);
  const clause = before.split(/[.!?;:\n]/).pop();
  return HEDGE.test(clause);
}

const compact = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

function findRe(find) {
  const f = String(find).trim();
  const body = escapeRe(f).replace(/\s+/g, "\\s+");
  const pre = /^\w/.test(f) ? "\\b" : "";
  const post = /\w$/.test(f) ? "\\b" : "";
  return new RegExp(pre + body + post, "gi");
}

// ---------------------------------------------------------------------------------------------------------------
// What gets checked

/** Every spoken, on-screen, caption and hashtag string of a script, joined (one per line). */
export function scriptText(script) {
  return fields(script).map((f) => (f.kind === "hashtag" ? f.raw : f.text)).join("\n");
}

function fields(script) {
  const out = [];
  const push = (path, text, kind, raw) => { if (typeof text === "string" && text.trim()) out.push({ path, text, kind, raw: raw ?? text }); };
  const s = script && typeof script === "object" ? script : {};
  push("hook.say", s.hook?.say, "say");
  push("hook.onScreen", s.hook?.onScreen, "onScreen");
  (Array.isArray(s.beats) ? s.beats : []).forEach((b, i) => {
    push(`beats.${i}.say`, b?.say, "say");
    push(`beats.${i}.onScreen`, b?.onScreen, "onScreen");
  });
  push("cta.say", s.cta?.say, "say");
  push("cta.onScreen", s.cta?.onScreen, "onScreen");
  push("caption", s.caption, "caption");
  (Array.isArray(s.hashtags) ? s.hashtags : []).forEach((h, i) => { if (typeof h === "string") push(`hashtags.${i}`, hashtagWords(h), "hashtag", h); });
  return out;
}

// Where a match is, for the fix: the n-th occurrence of its words in that field, or the hashtag itself.
function occurrence(f, index, text) {
  if (f.kind === "hashtag") return { tag: f.raw };
  const n = [...f.text.matchAll(findRe(text))].findIndex((x) => x.index === index);
  return n >= 0 ? { path: f.path, n } : { path: f.path };
}

function addAt(fix, at) {
  if (!fix || fix.kind === "tweak" || fix.kind === "append") return;
  fix.at = fix.at || [];
  if (!fix.at.some((a) => a.tag === at.tag && a.path === at.path && a.n === at.n)) fix.at.push(at);
}

// A conservative guess at Spanish, for when the caller doesn't say (a script after the "In Spanish" tweak).
const ES = new Set(["el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "por", "para", "con", "es", "su", "sus", "al",
  "lo", "como", "más", "mas", "pero", "este", "esta", "estos", "estas", "muy", "sin", "sobre", "también", "hay", "donde", "desde", "todo",
  "nos", "les", "ese", "eso", "esto", "yo", "tu", "tus", "mi", "mis", "casa", "casas", "comprar", "vender", "hogar", "usted", "ustedes",
  "aquí", "ahora", "cuando", "porque", "qué", "cómo", "tiene", "tienen", "puedes", "quieres", "vivir", "precio", "hoy"]);
const EN = new Set(["the", "and", "to", "of", "in", "is", "you", "that", "it", "for", "your", "on", "with", "this", "are", "be", "at",
  "or", "as", "have", "from", "but", "not", "what", "all", "can", "if", "will", "my", "we", "so", "home", "buy", "here", "how", "now"]);

/** "es" when the text is clearly Spanish, else "en". */
export function detectLang(text) {
  let es = 0, en = 0;
  for (const w of normWords(text)) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
  }
  return es >= 4 && es > 2 * en ? "es" : "en";
}

// ---------------------------------------------------------------------------------------------------------------
// The rules

function excepted(rule, text, start, end) {
  for (const e of rule.exceptC) {
    e.re.lastIndex = 0;
    for (const m of text.matchAll(e.re)) {
      const a = m.index, b = a + m[0].length;
      if (start < b && end > a) return true;
    }
  }
  return false;
}

function phraseFinding(rule, p, m, all) {
  const match = m[0];
  let kind = null, replacement = null;
  if (p.raw.remove === true) kind = "remove";
  else if (typeof p.raw.replace === "string") {
    let tpl = p.raw.replace;
    for (const r of p.replaceIf) if (test(r.when, all)) { tpl = r.replace; break; }
    replacement = matchCase(match, tpl.replace(/\$(\d)/g, (x, d) => m[Number(d)] ?? "").replace(/\s+/g, " ").trim());
    kind = "replace";
  }
  const text = p.raw.text ? fill(p.raw.text, { match })
    : kind === "replace" && replacement ? `'${match}' → '${replacement}'`
    : rule.text ? fill(rule.text, { match })
    : `Take out '${match}'`;
  let fix = null;
  if (kind === "replace") {
    fix = { label: p.raw.label || (replacement ? `Change to '${replacement}'` : rule.fixLabel || "Take it out"), kind: "replace", find: match, replace: replacement };
  } else if (kind === "remove") {
    fix = { label: p.raw.label || rule.fixLabel || "Take out the sentence", kind: "remove", find: match };
  }
  return { rule: rule.id, severity: rule.severity, text, why: rule.why || "", match, fix };
}

function checkPhrases(rule, flds, all, ctx) {
  const found = new Map();
  const taken = [];
  const schoolNamed = SCHOOL_NAME.test(all);
  const user = String(ctx.userText ?? "").toLowerCase();
  for (const p of rule.phrasesC) {
    if (p.raw.unlessSchoolNamed && schoolNamed) continue;
    flds.forEach((f, fi) => {
      p.re.lastIndex = 0;
      for (const m of f.text.matchAll(p.re)) {
        const start = m.index, end = start + m[0].length;
        if (!m[0].trim()) continue;
        if (taken.some(([g, a, b]) => g === fi && start < b && end > a)) continue;
        if (excepted(rule, f.text, start, end)) continue;
        if (rule.hedged && hedgedBefore(f.text, start)) continue;
        if (p.raw.unlessUserSaid && user.includes(m[0].toLowerCase())) continue;
        if (rule.notWhenRe) {
          const sentence = sentenceAround(f.text, start, end);
          if (test(rule.notWhenRe, sentence) && !test(rule.unlessCreditRe, sentence.replace(m[0], " "))) continue;
        }
        taken.push([fi, start, end]);
        const key = m[0].toLowerCase().replace(/\s+/g, " ");
        let finding = found.get(key);
        if (!finding) { finding = phraseFinding(rule, p, m, all); found.set(key, finding); }
        addAt(finding.fix, occurrence(f, start, m[0]));
      }
    });
  }
  const list = [...found.values()];
  if (rule.id === "politics") {
    for (const f of list) if (f.fix === null) f.fix = { label: rule.fixLabel || "Make it a neutral explainer", kind: "tweak", tweak: "note", note: rule.tweakNote || "" };
  }
  return list;
}

function brokerageNorm(s, suffixes) {
  let t = String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  let changed = true;
  while (changed && t) {
    changed = false;
    for (const suf of suffixes) {
      if (t !== suf && t.endsWith(" " + suf)) { t = t.slice(0, -(suf.length + 1)).trim(); changed = true; }
    }
  }
  return t.replace(/ /g, "");
}

function checkBrokerage(rule, script, brokerage) {
  const name = String(brokerage ?? "").trim();
  const why = rule.why || "";
  if (!name) {
    return { rule: "fl.brokerage", severity: rule.severity || "amber", text: rule.textNoBrokerage || "Add your brokerage's name in You", why, fix: null };
  }
  const suffixes = Array.isArray(rule.suffixes) ? rule.suffixes : [];
  const want = brokerageNorm(name, suffixes);
  if (!want) return null;
  const seen = fields(script).filter((f) => f.kind === "caption" || f.kind === "onScreen").map((f) => brokerageNorm(f.text, []));
  if (seen.some((t) => t.includes(want))) return null;
  return {
    rule: "fl.brokerage", severity: rule.severity || "amber", text: rule.text || "Add your brokerage's name", why, match: name,
    fix: { label: fill(rule.fixLabel || "Add \"{brokerage}\" as the caption's last line", { brokerage: name }), kind: "append", text: name },
  };
}

function captionSourceLines(caption) {
  return String(caption ?? "").split("\n").map((l) => l.trim()).filter((l) => /^(?:sources?\b|based on information from\b)/i.test(l));
}

/** A fact's quantities with their units; those inside its range ("12-month range … to …") are marked incidental. */
function factNumbers(fact) {
  const text = String(fact.text ?? "");
  const zones = [...text.matchAll(RANGE_ZONE)].map((m) => [m.index, m.index + m[0].length]);
  return extractNumbers(text).filter((n) => n.kind === "num").map((n) => ({ ...n, incidental: zones.some(([a, b]) => n.index >= a && n.index < b) }));
}

// The same number in the same unit, at the coarser of the two roundings ("$390,225" cites "$390K").
const sameNumber = (n, fn) => n.unit === fn.unit && (numberMatches(n, fn.value) || numberMatches(fn, n.value));

function checkNumbers(rules, allFields, ctx, script, lang) {
  const out = [];
  const flds = allFields.filter((f) => f.kind !== "hashtag"); // a hashtag is a label, not a claim: #Top20, #LakeMary2026
  const text = flds.map((f) => f.text).join("\n");
  const facts = Array.isArray(ctx.facts) ? ctx.facts.filter((f) => f && typeof f === "object") : [];
  const supplied = suppliedFrom(ctx.supplied ?? [], facts);
  const unsourced = rules["num.unsourced"] || {};
  for (const n of unknownNumbers(text, supplied, { userText: ctx.userText ?? "", lang })) {
    const fix = { label: unsourced.fixLabel || "Take out the sentence", kind: "remove", find: n.raw };
    for (const f of flds) {
      [...f.text.matchAll(findRe(n.raw))].forEach((x) => addAt(fix, occurrence(f, x.index, n.raw)));
    }
    out.push({ rule: "num.unsourced", severity: unsourced.severity || "amber", text: fill(unsourced.text || "Check this number: {match}", { match: n.raw }), why: unsourced.why || "", match: n.raw, fix });
  }

  // A supplied statistic from a sourced fact needs its "Source:" line in the caption: the same number in the same
  // unit; a range's high or low only when the sentence talks about one; never a number she gave herself.
  const sourced = facts.filter((f) => typeof f.source === "string" && f.source.trim()).map((f) => ({ source: f.source.trim(), nums: factNumbers(f) }));
  if (!sourced.length) return out;
  const hers = suppliedFrom(ctx.userText ?? "");
  const cited = [];
  for (const f of flds) {
    for (const n of extractNumbers(f.text, { lang })) {
      if (n.kind !== "num" || hers.some((v) => numberMatches(n, v))) continue;
      const sentence = sentenceAround(f.text, n.index, n.index + n.raw.length);
      for (const s of sourced) {
        if (cited.includes(s.source)) continue;
        if (s.nums.some((fn) => sameNumber(n, fn) && (!fn.incidental || RANGE_WORDS.test(sentence)))) cited.push(s.source);
      }
    }
  }
  if (cited.length) {
    const lines = captionSourceLines(script?.caption).join(" ").toLowerCase();
    const missing = cited.filter((src) => !lines.includes(src.split(",")[0].trim().toLowerCase()));
    if (missing.length) {
      const rule = rules["num.source"] || {};
      const line = `Source: ${missing.join("; ")}`;
      const fix = { label: rule.fixLabel || "Add the source line", kind: "append", text: line };
      if (String(ctx.brokerage ?? "").trim()) fix.before = String(ctx.brokerage).trim();
      out.push({ rule: "num.source", severity: rule.severity || "amber", text: fill(rule.text || "Add the source line: \"{line}\"", { line }), why: rule.why || "", match: line, fix });
    }
  }
  return out;
}

function checkCopy(rule, flds, remixCaption) {
  const cap = normWords(remixCaption);
  const min = Number(rule.minWords) > 1 ? Number(rule.minWords) : 8;
  if (cap.length < min) return null;
  const grams = new Set();
  for (let i = 0; i + min <= cap.length; i++) grams.add(cap.slice(i, i + min).join(" "));
  const capText = ` ${cap.join(" ")} `;
  for (const f of flds) {
    if (f.kind === "hashtag") continue;
    const w = normWords(f.text);
    for (let i = 0; i + min <= w.length; i++) {
      if (!grams.has(w.slice(i, i + min).join(" "))) continue;
      let j = i + min;
      while (j < w.length && capText.includes(` ${w.slice(i, j + 1).join(" ")} `)) j++;
      const match = w.slice(i, j).join(" ");
      return {
        rule: "copy", severity: rule.severity || "amber", text: fill(rule.text || "Too close to the original: \"{match}\"", { match }), why: rule.why || "", match,
        fix: { label: rule.fixLabel || "Rewrite it in my words", kind: "tweak", tweak: "rewrite" },
      };
    }
  }
  return null;
}

function checkMusic(rule, script) {
  const suggestion = String(script?.audio?.suggestion ?? "").trim();
  if (!suggestion) return null;
  if (test(rule.safeRe, suggestion)) return null;
  if (!rule.namedC.some((p) => test(p.re, suggestion))) return null;
  const fix = rule.replace ? { label: rule.fixLabel || "Use original audio", kind: "replace", find: suggestion, replace: rule.replace, at: [{ path: "audio.suggestion", n: 0 }] } : null;
  return { rule: "music", severity: rule.severity || "note", text: fill(rule.text || "Check the music: '{match}'", { match: suggestion }), why: rule.why || "", match: suggestion, fix };
}

/** Check a script before posting. ctx = { rules (data/fair-housing.json), brokerage, supplied: number[], facts: Fact[],
 *  userText, remixCaption, lang }. → Finding[], amber first, then notes, in the table's order. */
export function checkScript(script, ctx = {}) {
  const rules = compileRules(ctx.rules);
  const flds = fields(script);
  const all = flds.map((f) => f.text).join("\n");
  const lang = ctx.lang && ctx.lang !== "en" ? String(ctx.lang) : detectLang(all);
  const out = [];

  if (lang === "en") {
    for (const id of PHRASE_RULES) if (rules[id]) out.push(...checkPhrases(rules[id], flds, all, ctx));
    if (rules.music) { const m = checkMusic(rules.music, script); if (m) out.push(m); }
  }
  const b = checkBrokerage(rules["fl.brokerage"] || {}, script, ctx.brokerage);
  if (b) out.push(b);
  out.push(...checkNumbers(rules, flds, ctx, script, lang));
  if (String(ctx.remixCaption ?? "").trim()) {
    const c = checkCopy(rules.copy || {}, flds, ctx.remixCaption);
    if (c) out.push(c);
  }
  if (lang !== "en") {
    const r = rules.lang || {};
    out.push({ rule: "lang", severity: r.severity || "note", text: r.text || "Word check is English-only: read it over once.", why: r.why || "", fix: null });
  }

  const order = (f) => (SEVERITY[f.severity] ?? 1) * 100 + (RULES.indexOf(f.rule) + 1 || 99);
  return out.map((f, i) => ({ f, i })).sort((a, b2) => order(a.f) - order(b2.f) || a.i - b2.i).map(({ f }) => f);
}

/** Florida Rule 61J2-10.026 for her team name (checked once, in You). → Finding | null. */
export function checkTeamName(team, brokerage, rules) {
  const name = String(team ?? "").trim();
  if (!name) return null;
  const r = compileRules(rules)["fl.team"] || {};
  const why = r.why || "Florida Rule 61J2-10.026: a team may use \"team\" or \"group\", not \"Realty\", \"Real Estate\", \"Properties\", \"Brokers\" or \"LLC\".";
  const forbidden = Array.isArray(r.forbidden) ? r.forbidden : ["realty", "real estate", "properties", "brokers", "llc"];
  const words = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const hit = forbidden.find((w) => words.includes(` ${w.toLowerCase()} `));
  if (hit) {
    const shown = name.match(new RegExp(escapeRe(hit).replace(/ /g, "[^A-Za-z0-9]+"), "i"))?.[0] ?? hit;
    return { rule: "fl.team", severity: "amber", text: fill(r.textForbidden || "A team name can't use '{match}'", { match: shown }), why, match: shown, fix: null };
  }
  if (!String(brokerage ?? "").trim()) {
    return { rule: "fl.team", severity: "amber", text: r.textNoBrokerage || "Add your brokerage's name: it always goes with the team name", why, fix: null };
  }
  if (!/\b(?:team|group)\b/i.test(name)) {
    return { rule: "fl.team", severity: "note", text: r.textNoTeamWord || "Florida team names use \"Team\" or \"Group\"", why, fix: null };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// One-tap fixes

// The fields the check reads (and so the only ones a fix touches), by path.
const CHECKED = (s) => {
  const out = [];
  const add = (path, obj, key) => { if (obj && typeof obj[key] === "string") out.push({ path, obj, key }); };
  add("hook.say", s.hook, "say");
  add("hook.onScreen", s.hook, "onScreen");
  (Array.isArray(s.beats) ? s.beats : []).forEach((b, i) => { add(`beats.${i}.say`, b, "say"); add(`beats.${i}.onScreen`, b, "onScreen"); });
  add("cta.say", s.cta, "say");
  add("cta.onScreen", s.cta, "onScreen");
  add("caption", s, "caption");
  add("audio.suggestion", s.audio, "suggestion");
  return out;
};

function tidy(s) {
  return s.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/^[ \t]+|[ \t]+$/gm, "").replace(/([(“"]) +/g, "$1");
}

// Replace the selected occurrences of `find` (all when `only` is null), keeping each one's case and the article before it.
function replaceIn(text, find, replace, only = null) {
  const re = findRe(find);
  let out = "", last = 0, changed = false, i = -1;
  for (const m of text.matchAll(re)) {
    i++;
    if (only && !only.has(i)) continue;
    let head = out + text.slice(last, m.index);
    const repl = matchCase(m[0], replace);
    // "an exclusive neighborhood" → "a neighborhood": fix the article right before the change.
    const nextWord = (repl || text.slice(m.index + m[0].length)).trimStart();
    head = head.replace(/\b(a|an|A|An)(\s+)$/, (all, art, sp) => {
      if (!/^[A-Za-z]/.test(nextWord)) return all;
      const want = /^[aeiou]/i.test(nextWord) ? "an" : "a";
      return (art[0] === "A" ? want[0].toUpperCase() + want.slice(1) : want) + sp;
    });
    out = head + repl;
    last = m.index + m[0].length;
    changed = true;
  }
  if (!changed) return text;
  const result = tidy(out + text.slice(last));
  return /^[a-z]/.test(result) && /^[A-Z]/.test(text) ? result[0].toUpperCase() + result.slice(1) : result;
}

// Take out the sentences holding the selected occurrences of `find` (all when `only` is null).
function removeSentencesIn(text, find, only = null) {
  const at = [...text.matchAll(findRe(find))].filter((m, i) => !only || only.has(i)).map((m) => m.index);
  if (!at.length) return text;
  const out = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const segs = [...line.matchAll(SENTENCE)].filter((m) => m[0]).map((m) => [offset + m.index, offset + m.index + m[0].length, m[0]]);
    const kept = segs.filter(([a, b]) => !at.some((p) => p >= a && p < b));
    if (kept.length === segs.length) out.push(line);
    else {
      const l = kept.map((x) => x[2]).join("").trim();
      if (l) out.push(l);
    }
    offset += line.length + 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Apply a finding's one-tap fix: a new Script (the input is never changed). A replace or remove fix changes only
 *  where the check matched (fix.at); without fix.at, every occurrence in the fields the check reads. A "tweak" fix
 *  (a rewrite the app asks the server for) and a finding without a fix return an unchanged copy. */
export function applyFix(script, finding) {
  const s = structuredClone(script);
  const fix = finding?.fix;
  if (!fix || typeof fix !== "object") return s;

  if ((fix.kind === "replace" || fix.kind === "remove") && typeof fix.find === "string" && fix.find.trim()) {
    const at = Array.isArray(fix.at) ? fix.at : null;
    const byPath = new Map(); // path → Set of occurrences, or null for every one
    const tags = new Set();
    if (at) {
      for (const a of at) {
        if (a && typeof a.tag === "string") { tags.add(a.tag); continue; }
        if (!a || typeof a.path !== "string") continue;
        if (!Number.isInteger(a.n)) byPath.set(a.path, null);
        else if (byPath.get(a.path) !== null) byPath.set(a.path, (byPath.get(a.path) || new Set()).add(a.n));
      }
    }
    for (const { path, obj, key } of CHECKED(s)) {
      if (at && !byPath.has(path)) continue;
      if (!at && path === "audio.suggestion" && obj[key].trim() !== fix.find.trim()) continue;
      const only = at ? byPath.get(path) : null;
      obj[key] = fix.kind === "replace" ? replaceIn(obj[key], fix.find, String(fix.replace ?? ""), only) : removeSentencesIn(obj[key], fix.find, only);
    }
    if (Array.isArray(s.hashtags)) {
      const re = findRe(fix.find);
      const hit = (h) => (at ? tags.has(h) : test(re, hashtagWords(h)));
      s.hashtags = s.hashtags.map((h) => {
        if (typeof h !== "string" || !hit(h)) return h;
        if (fix.kind === "remove") return null;
        return toHashtag(replaceIn(hashtagWords(h), fix.find, String(fix.replace ?? "")));
      }).filter(Boolean);
    }
    return s;
  }

  if (fix.kind === "append" && typeof fix.text === "string" && fix.text.trim()) {
    const text = fix.text.trim();
    const cap = String(s.caption ?? "").replace(/\s+$/, "");
    if (compact(cap).includes(compact(text))) return s;
    const lines = cap ? cap.split("\n") : [];
    const before = String(fix.before ?? "").trim();
    if (before && lines.length && compact(lines[lines.length - 1]) === compact(before)) lines.splice(lines.length - 1, 0, text);
    else lines.push(text);
    s.caption = lines.join("\n");
    return s;
  }
  return s;
}
