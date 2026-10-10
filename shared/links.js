// links.js (browser-safe): links the app builds itself. The model never writes a URL.

import { squash } from "./text.js";

/** One-tap searches for an idea's own phrase (design §3.10). Each opens the platform's app when it's installed. */
export function searchLinks(query) {
  const q = encodeURIComponent(squash(query));
  return {
    tiktok: `https://www.tiktok.com/search?q=${q}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${q}`,
    youtube: `https://www.youtube.com/results?search_query=${q}`,
  };
}

/** Instagram's tag page for a phrase ("Lake Mary homes" → .../explore/tags/lakemaryhomes/): the fallback when
 *  keyword search doesn't open on a phone. */
export function instagramTagUrl(query) {
  const tag = squash(query).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "");
  return `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
}

/** https://www.youtube.com/shorts/<id> for a Short, https://www.youtube.com/watch?v=<id> otherwise. */
export function youtubeUrl(id, isShort) {
  const v = encodeURIComponent(String(id ?? ""));
  return isShort ? `https://www.youtube.com/shorts/${v}` : `https://www.youtube.com/watch?v=${v}`;
}

/** The video's medium thumbnail (320×180). */
export function ytThumb(id) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(String(id ?? ""))}/mqdefault.jpg`;
}
