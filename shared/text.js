// text.js (browser-safe): small text helpers for feeds and model output. No DOM, so it runs in the Worker too.

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•", eacute: "é", Eacute: "É", egrave: "è",
  aacute: "á", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", ouml: "ö", auml: "ä",
  ccedil: "ç", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾", cent: "¢", pound: "£", euro: "€",
  shy: "", zwj: "", zwnj: "", thinsp: " ", ensp: " ", emsp: " ", prime: "′", Prime: "″", minus: "−",
};

/** Decode HTML entities: named (the common ones), decimal and hex. Unknown ones are left as they are. */
export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return all;
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : all;
  });
}

/** Collapse runs of whitespace to one space and trim. */
export function squash(s) {
  return String(s ?? "").replace(/[\s ​]+/g, " ").trim();
}

const BLOCK_TAGS = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|blockquote|figure|figcaption|hr)\b[^>]*>/gi;

/** Plain text from an HTML fragment: scripts, styles and comments dropped, tags removed, entities decoded,
 *  whitespace squashed. Feeds sometimes double-encode, so entities are decoded before and after. */
export function stripHtml(s) {
  let t = String(s ?? "");
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  if (/&lt;\/?[a-z]/i.test(t) && !/<[a-z]/i.test(t)) t = decodeEntities(t); // an escaped HTML body
  t = t.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(BLOCK_TAGS, " ")
    .replace(/<[^>]*>/g, "");
  return squash(decodeEntities(t));
}

/** Cut to at most n characters at a word boundary, ending with "…" when anything was cut. */
export function cut(s, n) {
  const t = squash(s);
  const max = Math.max(1, Math.floor(Number(n) || 0));
  if (t.length <= max) return t;
  let head = t.slice(0, max - 1);
  if (t[max - 1] !== " ") { // the cut falls inside a word: back up to the last space, if it isn't too far back
    const space = head.lastIndexOf(" ");
    if (space >= Math.floor(max * 0.5)) head = head.slice(0, space);
  }
  head = head.replace(/[\s,;:.\-–—(]+$/, "");
  return head + "…";
}

const EDGE = /^[^\p{L}\p{N}$#@]+|[^\p{L}\p{N}%]+$/gu;

/** The words of a text: split on whitespace, punctuation trimmed from each end ("7.40%" and "first-time" stay whole). */
export function words(s) {
  const out = [];
  for (const raw of String(s ?? "").split(/[\s ]+/)) {
    const w = raw.replace(EDGE, "");
    if (w) out.push(w);
  }
  return out;
}

/** Lower-case word tokens with accents and punctuation removed: the normal form used for comparisons. */
export function normWords(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** 0..1: Jaccard similarity of the two titles' normalised word sets. 0.8 or more means the same story. */
export function titleSimilarity(a, b) {
  const A = new Set(normWords(a)), B = new Set(normWords(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Escape text for HTML (for the rare place a string must go into markup; the app uses textContent). */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
