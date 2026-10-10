// models.js: the model, the route table and the app's shared vocabulary.
// No imports, so it is browser-safe too: the app can read the labels and TWEAKS from here
// (schemas.js re-exports the enums, but it imports zod and can't run in the browser).

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** Effort per route (Sonnet 5.5's levels). Thinking stays the model's default (adaptive): no `thinking` field is sent. */
export const ROUTES = {
  "trends.scan": { effort: "medium" },
  "briefing.compose": { effort: "medium" },
  "ideas.write": { effort: "low" },
  "script.write": { effort: "low" },
  "script.tweak": { effort: "low" },
};

export const MAX_TOKENS = 16000;       // every route, thinking included
export const MAX_TOKENS_RETRY = 24000; // one retry after a max_tokens stop

/** The request option write.js sets to name its route. The SDK ignores request options it doesn't know (they never
 *  reach the API); fake-client.js reads it to answer from the right fixture. */
export const ROUTE_OPTION = "jarvisRoute";

// Topics ("pillars"), in the fixed order of the app's mix bar (design §3.8).
export const PILLARS = ["market", "local", "tips", "listing", "proof", "personal"];
export const PILLAR_LABELS = { market: "Market", local: "Local", tips: "Tips", listing: "Listings", proof: "Proof", personal: "Personal" };

export const FORMATS = ["talking-head", "voiceover-broll", "walkthrough", "green-screen", "text-on-screen", "street", "duet-stitch"];
export const FORMAT_LABELS = {
  "talking-head": "talking head", "voiceover-broll": "voiceover + b-roll", walkthrough: "walk-through",
  "green-screen": "green screen", "text-on-screen": "text on screen", street: "street interview", "duet-stitch": "duet or stitch",
};

export const EFFORTS = ["5min", "15min", "30min", "listing"];
export const EFFORT_LABELS = { "5min": "5 min", "15min": "15 min", "30min": "30 min", listing: "at a listing" };

export const PLATFORMS = ["reels", "tiktok", "shorts", "facebook"];
export const PLATFORM_LABELS = { reels: "Reels", tiktok: "TikTok", shorts: "Shorts", facebook: "Facebook" };

export const LENGTHS = [15, 30, 45, 60, 90]; // seconds
export const APPEARS = ["camera", "voiceover", "text"]; // how she appears: on camera, voiceover, text only
export const APPEAR_LABELS = { camera: "On camera", voiceover: "Voiceover", text: "Text only" };

/** Script tweaks (POST /ideas/:id/script { tweak, note? }). "rewrite" is the check's one-tap fix for a remix that
 *  copies the original's words; the app's chip row shows the first seven. */
export const TWEAKS = ["shorter", "punchier", "funnier", "local", "expert", "spanish", "note", "rewrite"];
export const TWEAK_LABELS = {
  shorter: "Shorter", punchier: "Punchier hook", funnier: "Funnier", local: "More local", expert: "More expert",
  spanish: "In Spanish", note: "My own note", rewrite: "In my own words",
};

export const MODES = ["topic", "listing", "remix", "week", "seed", "first"];
export const SEED_KINDS = ["move", "local", "industry", "pulse", "trend", "asking", "calendar"];
export const IDEA_SOURCES = ["briefing", "topic", "listing", "remix", "week", "seed", "first"];
export const IDEA_STATUSES = ["new", "saved", "scripted", "filmed", "posted", "dismissed"];
export const OUTCOMES = ["great", "ok", "flop"];
export const PULSE_KEYS = ["rate30", "medianList", "active", "dom"];

// Her profile's choices (contract §4).
export const AREAS = ["Lake Mary", "Heathrow", "Sanford", "Longwood", "Winter Springs", "Oviedo", "Altamonte Springs", "DeBary", "Deltona"];
export const HELPS = ["first-time buyers", "move-up buyers", "sellers", "luxury", "relocation", "new construction", "investors", "55+ communities", "condos"];
export const TONES = ["warm", "funny", "expert", "high energy"];
export const CAMERAS = ["love", "getting", "voiceover"];
export const CAMERA_LABELS = { love: "loves the camera", getting: "getting comfortable on camera", voiceover: "prefers voiceover" };
export const CTAS = ["DM me", "link in bio", "call or text"];

// The check's rules (design §3.13), in the order the app lists them within a severity.
export const RULES = ["fh.people", "fh.protected", "fh.safe", "fh.schools", "fh.places", "fh.primary", "fl.brokerage", "num.unsourced",
  "num.source", "promise", "regz", "copy", "politics", "music", "lang", "fl.team"];
