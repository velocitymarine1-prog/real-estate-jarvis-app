// config.js: the app's names and addresses (contract §1). BUILD is stamped by tools/deploy.sh with the source commit.
export const APP_NAME = "Javi's Real Estate Jarvis";
export const SHORT_NAME = "Jarvis";
export const GIFT_NOTE = "Happy birthday! I made this for you. — Isaac";
export const BUILD = "36d47c4";

// The Web Push key pair's public half (tools/vapid.js made it; the private half is the Worker secret VAPID_PRIVATE)
export const VAPID_PUBLIC = "BFfdB5_LJtl4lYcTuHfe0M1IWXdCsRActHAYi3FS3Llw8Muyd-S7jCyS-nX06c-av4dFUk7aEVs3-n6bpOmoCKo";

export const PROD_API = "https://real-estate-jarvis.velocityicy.workers.dev/api/v1";
export const LOCAL_API = "http://localhost:8787/api/v1";

const params = new URLSearchParams(location.search);
export const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

// ?mock=1 answers every API call from tests/fixtures (app/mock.js), so the whole app can be driven without the Worker. Only on
// this Mac: the fixtures aren't deployed, and mock.js isn't either.
export const MOCK = IS_LOCAL && params.get("mock") === "1";

// The API: the Worker on Cloudflare; on this Mac the local Worker (wrangler dev); ?api=<url> points a test elsewhere (on this Mac
// only, and the page's CSP still decides what it may reach).
function pickApi() {
  const o = params.get("api");
  if (IS_LOCAL && o && /^https?:\/\/[^\s]+$/.test(o)) return o.replace(/\/+$/, "");
  return IS_LOCAL ? LOCAL_API : PROD_API;
}
export const API = pickApi();

// Lake Mary, for the copy that names the place
export const PLACE = "Lake Mary";
