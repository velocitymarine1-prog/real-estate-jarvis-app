// numbers.js (browser-safe): the numbers guard of design §3.12.
//
// Every number in a model sentence must match a number the request supplied (rounding allowed: 6.1 matches
// 6.12, $489K matches 489,000), or be one of the kinds that are never statistics: a small count (10 or less),
// a year, a date, a time of day, a length in seconds, an ordinal, a loan term ("30-year"), an identifier
// (I-4, SR 417, HB 913, Amendment 3, a ZIP, an address, a phone number), or a number she typed herself.
//
// extractNumbers(text) gives each number a `kind`:
//   "num"   a quantity: must be supplied
//   "count" an integer from 0 to 10 with no % or $: free
//   "year" | "date" | "time" | "seconds" | "ordinal" | "term" | "id" | "zip" | "address" | "phone" | "url" | "idiom": free
// The supplied side (suppliedFrom) keeps only "num" and "count" values, so a loan term ("30-year"), a date
// ("30 November") or an ordinal ("30th year") never vouches for an invented "30%".

const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const STREETS = "Blvd|Boulevard|Rd|Road|Ave|Avenue|St|Street|Dr|Drive|Ln|Lane|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Pl|Place|Trl|Trail|Ter|Terrace|Loop|Cv|Cove|Xing|Crossing|Sq|Square";
// Words that turn the number after them into a name, not a quantity (case-sensitive on purpose).
const ID_WORDS = "SR|CR|US|Interstate|Route|Rte\\.?|Hwy|Highway|[Ee]xits?|HB|SB|CS/HB|Amendments?|Article|Section|§|s\\.|ss\\.|Rule|Chapter|Ch\\.|Unit|Apt\\.?|Suite|Ste\\.?|Lot|Phase|Building|Bldg\\.?|District|ZIP|Zip|zip code|ZIP code|No\\.|Channel|News|Fox|WESH|WFTV|WKMG|Station|Gate|Pier|Terminal|Concourse|Series";

// [kind, regex] in priority order: the first mask that covers a number decides its kind.
const MASKS = [
  ["url", /\b(?:https?:\/\/|www\.)\S+/gi],
  ["phone", /(?<![\d$])(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}(?!\d)/g],
  ["address", new RegExp(`(?<![\\d,.$])\\b\\d{1,6}\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Z][\\p{L}'.-]*\\s+){0,4}(?:${STREETS})\\.?(?![\\p{L}])`, "gu")],
  ["id", new RegExp(`(?<![\\p{L}\\p{N}])(?:${ID_WORDS})\\s?[-#]?\\s?\\d[\\p{L}\\p{N}.\\-/]*`, "gu")],
  ["id", /\b\d+\s+CFR\s+\d+(?:\.\d+)*(?:\([a-z0-9]+\))*/g],
  ["date", /\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/g],
  ["date", /(?<![\d/.,])(?:1[0-2]|0?[1-9])\/(?:3[01]|[12]\d|0?[1-9])(?:\/(?:\d{4}|\d{2}))?(?![\d/%])/g],
  ["date", new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s?[–-]\\s?\\d{1,2}(?:st|nd|rd|th)?)?(?!\\d|\\s?%)`, "g")],
  ["date", new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?(?:\\s?[–-]\\s?\\d{1,2}(?:st|nd|rd|th)?)?\\s+(?:of\\s+)?(?:${MONTHS})\\b`, "g")],
  ["time", /\b\d{1,2}(?::\d{2})?\s?[–-]\s?\d{1,2}(?::\d{2})?\s?[ap]\.?m\.?(?![a-z])/gi],
  ["time", /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?(?![a-z]))?(?!\d)/gi],
  ["time", /\b\d{1,2}\s?[ap]\.?m\.?(?![a-z])/gi],
  ["seconds", /\b\d+(?:\.\d+)?(?:\s?[–-]\s?\d+(?:\.\d+)?)?\s?-?\s?(?:s|secs?|seconds?)\b/gi],
  ["term", /\b(?:10|15|20|25|30|40|50)-(?:year|yr)\b(?!\s+(?:high|low|record))/gi],
  ["term", /\b(?:10|15|20|25|30|40|50)\s(?:year|yr)\s(?:fixed|mortgage|loan|term|rate|ARM|treasury|note|bond)\b/gi],
  ["term", /\b\d{1,2}yrs?\b/gi],
  ["term", /\b(?:52|26|13|4)-week\b|\b(?:12|6|3|18|24|36)-month\b/gi], // "a 52-week high", "a 12-month range"
  ["term", /\b\d{1,2}\/\d{1,2}\s?ARMs?\b/g],
  ["term", /\b24\/7\b|\b50\/50\b|\b401\s?\(?k\)?|\b1031\s+exchanges?\b|\b(?:55|62)\+/gi],
  ["term", /(?<![$\d.,])\b\dK\b/g], // 4K video, a 5K run
  ["idiom", /\b1[01]0\s?%/g],
  ["ordinal", /\b\d+(?:st|nd|rd|th)\b/gi],
  ["zip", /(?<![\d,.$])\b3[2-4]\d{3}\b(?![,.]\d|\s?%)/g],
];

// Letters allowed straight after a number without making it a name ("489K", "3x", "30s", "4bd", "7pm").
const SUFFIXES = new Set(["k", "m", "mm", "bn", "st", "nd", "rd", "th", "s", "sec", "secs", "x", "yr", "yrs", "bd",
  "br", "ba", "bed", "beds", "bath", "baths", "sqft", "sf", "am", "pm", "h", "hr", "hrs", "min", "mins", "mo", "mos", "wk",
  "wks", "pct"]);
// A 4-digit number before these is a quantity, not a year ("a 2000 sq ft home").
const QUANTITY_NOUNS = /^\s?(?:sq|square|sf|homes?|houses?|listings?|people|residents|employees|units?|acres?|feet|ft|members|policies|sales|buyers|sellers|views|followers|dollars)\b/i;

const NUM_RE = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g;

export const FREE_KINDS = new Set(["count", "year", "date", "time", "seconds", "ordinal", "term", "id", "zip", "address", "phone", "url", "idiom"]);
export const STAT_KINDS = new Set(["num", "count"]);

function maskRanges(text) {
  const ranges = [];
  for (const [kind, re] of MASKS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length, kind]);
  }
  return ranges;
}

function kindAt(ranges, start) {
  // MASKS order is priority order, and ranges were pushed in that order.
  for (const [a, b, kind] of ranges) if (start >= a && start < b) return kind;
  return null;
}

function decimalsOf(frac) {
  return frac ? frac.length - 1 : 0;
}

/** Every number in a text: [{ raw, value, unit: "%"|"$"|"days"|"", index, kind, step }].
 *  "$489K" → 489000, "12 percent" → 12, "1.2 million" → 1200000. `step` is the rounding the text implies. */
export function extractNumbers(text) {
  const s = String(text ?? "");
  if (!/\d/.test(s)) return [];
  const ranges = maskRanges(s);
  const out = [];
  NUM_RE.lastIndex = 0;
  for (const m of s.matchAll(NUM_RE)) {
    const index = m.index;
    const dollar = !!m[1];
    const intDigits = m[2].replace(/,/g, "");
    const frac = m[3] || "";
    const numStart = index + (m[1] ? m[1].length : 0);
    let end = index + m[0].length;
    const before = s.slice(Math.max(0, index - 3), index);
    let after = s.slice(end, end + 40);

    // Part of a word or a name: "FY2025", "I-4", "H1", "#Top10", "101A", "61J2".
    let kind = kindAt(ranges, numStart);
    if (!kind && /[\p{L}]-?$/u.test(before) && !dollar) kind = "id";
    let letters = /^[A-Za-z]+/.exec(after)?.[0] || "";
    if (!kind && letters && !dollar && !SUFFIXES.has(letters.toLowerCase())) kind = "id";

    // The unit and the multiplier.
    let mult = 1, multWord = "";
    // K and M multiply anywhere ("489K", "1.2M views"); B only after a dollar sign ("101B" is an exit, "$2B" money).
    const mm = /^\s?(k|K|M|mm|bn)\b/.exec(after) || (dollar ? /^\s?(m|b|B)\b/.exec(after) : null);
    if (mm && !(mm[1] === "K" && !dollar && intDigits.length === 1 && !frac && kind === "term")) {
      const k = mm[1].toLowerCase();
      mult = k === "k" ? 1e3 : k === "m" || k === "mm" ? 1e6 : 1e9;
      multWord = mm[0];
    } else {
      const w = /^\s(thousand|million|billion)\b/i.exec(after);
      if (w) { mult = { thousand: 1e3, million: 1e6, billion: 1e9 }[w[1].toLowerCase()]; multWord = w[0]; }
    }
    if (multWord) { end += multWord.length; after = s.slice(end, end + 40); }

    let unit = dollar ? "$" : "";
    let unitText = "";
    const pct = /^(?:\s?%|\s(?:percent|per cent|percentage points?|pct)\b)/i.exec(after);
    if (pct) { unit = "%"; unitText = pct[0]; }
    else if (/^(?:\s?\/\s?\d+(?:\.\d+)?)+\s?%/.test(after) || /^\s?[–-]\s?\d+(?:\.\d+)?\s?%/.test(after)) unit = "%";
    else if (/^\s?dollars\b/i.test(after)) { unit = "$"; }
    else {
      const d = /^\s?-?\s?days?\b/i.exec(after);
      if (d) { unit = "days"; unitText = d[0]; }
    }
    if (unitText) end += unitText.length;

    const base = Number(intDigits + frac);
    if (!Number.isFinite(base)) continue;
    let value = base * mult;
    const neg = /(?:^|[^\p{L}\p{N}])[-−]$/u.test(s.slice(Math.max(0, index - 2), index)) && !/\d\s?[-−]$/.test(s.slice(Math.max(0, index - 3), index));
    if (neg) value = -value;

    // Rounding implied by the text: decimals, a multiplier, or trailing zeros (keeping two significant digits).
    let step;
    if (frac || mult !== 1) step = Math.pow(10, -decimalsOf(frac)) * mult;
    else {
      const tz = intDigits.length - intDigits.replace(/0+$/, "").length;
      step = Math.pow(10, Math.max(0, Math.min(tz, intDigits.length - 2)));
    }

    if (!kind) {
      const isInt = !frac && mult === 1;
      if (isInt && !dollar && unit !== "%" && intDigits.length === 4 && !m[2].includes(",") && base >= 1900 && base <= 2100 && !QUANTITY_NOUNS.test(after)) kind = "year";
      else if (isInt && !dollar && unit !== "%" && Math.abs(base) <= 10) kind = "count";
      else kind = "num";
    }
    const raw = s.slice(index, end).trim();
    out.push({ raw, value, unit, index, kind, step });
  }
  return out;
}

const EPS = 1e-9;

/** Does the number found in a text (from extractNumbers) match a supplied value, allowing for the text's rounding?
 *  Signs are ignored: "down 2.4%" matches −2.42. */
export function numberMatches(n, v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  const x = Math.abs(n.value), y = Math.abs(v);
  if (Math.abs(x - y) <= EPS * Math.max(1, x)) return true;
  const step = n.step || 1;
  const rounded = Math.round(y / step) * step;
  return Math.abs(rounded - x) <= step * 1e-6 + EPS * Math.max(1, x);
}

function sameValue(a, b) {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= EPS * Math.max(1, Math.abs(a));
}

/** The supplied numbers, from strings (their quantities), numbers, arrays, or Fact-like objects ({ text, numbers }).
 *  A fact's listed number is dropped when its text uses it only as a non-quantity ("30-year", "Oct 8").
 *  Sorted, without duplicates. */
export function suppliedFrom(...parts) {
  const out = [];
  const visit = (p) => {
    if (p === null || p === undefined) return;
    if (typeof p === "number") { if (Number.isFinite(p)) out.push(p); return; }
    if (typeof p === "string") {
      for (const n of extractNumbers(p)) if (STAT_KINDS.has(n.kind)) out.push(n.value);
      return;
    }
    if (Array.isArray(p)) { for (const q of p) visit(q); return; }
    if (typeof p === "object") {
      const found = typeof p.text === "string" ? extractNumbers(p.text) : [];
      const stats = found.filter((n) => STAT_KINDS.has(n.kind)).map((n) => n.value);
      const other = found.filter((n) => !STAT_KINDS.has(n.kind)).map((n) => n.value);
      out.push(...stats);
      if (Array.isArray(p.numbers)) {
        for (const v of p.numbers) {
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          const onlyAsName = other.some((o) => sameValue(o, v)) && !stats.some((x) => sameValue(x, v));
          if (!onlyAsName) out.push(v);
        }
      }
    }
  };
  for (const p of parts) visit(p);
  const uniq = [];
  for (const v of out.sort((a, b) => a - b)) if (!uniq.length || uniq[uniq.length - 1] !== v) uniq.push(v);
  return uniq;
}

/** The numbers in `text` that nobody supplied: [{ raw, value }] (each raw once). Quantities only; the free kinds and
 *  her own numbers (`userText`) are allowed. `supplied` may be numbers, strings, arrays or facts (see suppliedFrom). */
export function unknownNumbers(text, supplied, { userText = "" } = {}) {
  const allowed = suppliedFrom(supplied, userText);
  const out = [];
  const seen = new Set();
  for (const n of extractNumbers(text)) {
    if (n.kind !== "num") continue;
    if (allowed.some((v) => numberMatches(n, v))) continue;
    if (seen.has(n.raw)) continue;
    seen.add(n.raw);
    out.push({ raw: n.raw, value: n.value });
  }
  return out;
}

/** True when every quantity in `text` is supplied (the briefing's `say` lines and headline). */
export function numbersOk(text, supplied, opts) {
  return unknownNumbers(text, supplied, opts).length === 0;
}
