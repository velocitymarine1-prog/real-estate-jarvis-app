// ids.js (browser-safe): ids, invite codes, device tokens and hashes. Web Crypto only.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// Each byte's low five bits pick a character: 256 is a multiple of 32, so every character is equally likely.
function crockford(n) {
  let s = "";
  for (const b of randomBytes(n)) s += CROCKFORD[b & 31];
  return s;
}

/** prefix + 12 Crockford base32 characters (60 random bits), lower case so it reads well in a URL. */
export function newId(prefix = "") {
  return String(prefix) + crockford(12).toLowerCase();
}

/** An invite code: 8 Crockford characters (40 random bits), upper case: "K7QM4XD2". */
export function newCode() {
  return crockford(8);
}

/** Loose typing back to the code: upper case, no spaces/dashes/underscores/dots, I and L → 1, O → 0, U → V.
 *  Returns the 8 valid characters, or null. */
export function normalizeCode(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).toUpperCase().replace(/[\s\-_.]/g, "")
    .replace(/[IL]/g, "1").replace(/O/g, "0").replace(/U/g, "V");
  if (t.length !== 8) return null;
  for (const c of t) if (!CROCKFORD.includes(c)) return null;
  return t;
}

/** "K7QM4XD2" → "K7QM-4XD2" (anything that isn't a code comes back as typed). */
export function formatCode(c) {
  const n = normalizeCode(c);
  return n ? `${n.slice(0, 4)}-${n.slice(4)}` : String(c ?? "");
}

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A device token: 32 random bytes, base64url without padding (43 characters). */
export function newToken() {
  return base64url(randomBytes(32));
}

/** SHA-256 of a string (UTF-8) as lower-case hex. */
export async function sha256Hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/** A short stable id for a string (FNV-1a 64 over its UTF-8 bytes, base 36, the last 10 characters).
 *  Synchronous, so item ids can be made from URLs anywhere. */
export function stableId(s) {
  let h = FNV_OFFSET;
  for (const b of encoder.encode(String(s ?? ""))) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(36).padStart(10, "0").slice(-10);
}
