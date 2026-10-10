// time.js (browser-safe): every "today" in the app is an Eastern date (America/New_York).
// Plain Intl and Date only, so it runs unchanged in Node, the Worker and the browser.

export const TZ = "America/New_York";
const PACIFIC = "America/Los_Angeles";
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formatters are built once: Intl.DateTimeFormat is slow to construct (the Worker has 10 ms of CPU).
const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function toDate(d) {
  if (d instanceof Date) return d;
  if (d === undefined || d === null) return new Date();
  return new Date(d);
}

function zonedParts(d, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(toDate(d))) parts[p.type] = p.value;
  const y = Number(parts.year), m = Number(parts.month), day = Number(parts.day);
  let hh = Number(parts.hour);
  if (hh === 24) hh = 0; // some engines still say "24" at midnight
  const mm = Number(parts.minute);
  return { y, m, d: day, hh, mm, dow: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
}

const pad2 = (n) => String(n).padStart(2, "0");
const ymdOf = ({ y, m, d }) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;

/** { y, m, d, hh, mm, dow (0 = Sunday) } in Eastern time. */
export function easternParts(d = new Date()) {
  return zonedParts(d, TZ);
}

/** "2026-10-10": the Eastern calendar date. */
export function easternDate(d = new Date()) {
  return ymdOf(zonedParts(d, TZ));
}

/** "05:41": the Eastern wall-clock time, 24 h. */
export function easternTime(d = new Date()) {
  const p = zonedParts(d, TZ);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** The Pacific calendar date: YouTube's quota day resets at midnight Pacific. */
export function pacificDate(d = new Date()) {
  return ymdOf(zonedParts(d, PACIFIC));
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function ymdToUtc(ymd) {
  const m = YMD_RE.exec(String(ymd));
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${ymd}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcToYmd(ms) {
  const d = new Date(ms);
  return ymdOf({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

/** Calendar arithmetic on "YYYY-MM-DD" (no time zone involved). */
export function addDays(ymd, n) {
  return utcToYmd(ymdToUtc(ymd) + Math.round(Number(n) || 0) * 86400000);
}

/** b − a in whole days. */
export function daysBetween(a, b) {
  return Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86400000);
}

/** That week's Monday. */
export function weekStart(ymd) {
  const dow = new Date(ymdToUtc(ymd)).getUTCDay();
  return addDays(ymd, -((dow + 6) % 7));
}

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon" */
export function weekdayShort(ymd) {
  return DOW_SHORT[new Date(ymdToUtc(ymd)).getUTCDay()];
}

/** Day of week of a "YYYY-MM-DD" date, 0 = Sunday. */
export function weekdayIndex(ymd) {
  return new Date(ymdToUtc(ymd)).getUTCDay();
}

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** The morning push window: true when the Eastern time is at or after notifyTime and less than three hours
 *  after it, and nothing was sent today. The window never wraps past midnight. */
export function pushDue(now, notifyTime, lastSentYmd) {
  const at = toDate(now);
  const p = zonedParts(at, TZ);
  const today = ymdOf(p);
  if (lastSentYmd && String(lastSentYmd).slice(0, 10) === today) return false;
  const start = minutesOf(notifyTime) ?? 7 * 60;
  const nowMin = p.hh * 60 + p.mm;
  return nowMin >= start && nowMin < start + 180;
}

/** "40 min", "5 h", "3 d" (how long ago). Future or under a minute: "now". Unreadable: "". */
export function ageText(iso, now = new Date()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = toDate(now).getTime() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** "18:06" → "6:06 pm". Anything else comes back as it was. */
export function clock12(hhmm) {
  const total = minutesOf(hhmm);
  if (total === null) return String(hhmm ?? "");
  const h = Math.floor(total / 60), m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${h < 12 ? "am" : "pm"}`;
}

/** "2026-10-08" → "Oct 8, 2026" (no time zone involved). */
export function shortDate(ymd, { year = true } = {}) {
  const m = YMD_RE.exec(String(ymd ?? "").slice(0, 10));
  if (!m) return "";
  const mon = MONTHS_SHORT[Number(m[2]) - 1];
  return year ? `${mon} ${Number(m[3])}, ${m[1]}` : `${mon} ${Number(m[3])}`;
}

/** "2026-10-08" → "Oct 2026" */
export function monthYear(ymd) {
  const m = YMD_RE.exec(String(ymd ?? "").slice(0, 10));
  if (!m) return "";
  return `${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

