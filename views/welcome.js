// welcome.js: the gift (design §3.7 steps 1 and 2). The QR on Isaac's card opens the invite link; this is the first thing she sees:
// the app, Isaac's note, and Let's set it up. On iPhone Safari the next step shows how to add the app to the home screen, with her code
// in large type, because a home-screen app keeps its own storage apart from Safari's and asks for the code once. Elsewhere the code
// screen redeems the invite at once.
import { APP_NAME, SHORT_NAME, GIFT_NOTE } from "../config.js";
import { go } from "../router.js";
import { h, icon, replace, button, isIOSSafari, isStandalone } from "../ui.js";
import { formatCode, normalizeCode } from "../shared/ids.js";

export default {
  async mount(root, route) {
    const code = sessionStorage.getItem("jarvis:invite") || "";
    const pretty = normalizeCode(code) ? formatCode(code) : "";
    const homeStep = isIOSSafari() && !isStandalone();

    function gift() {
      const [note, from] = GIFT_NOTE.split(/\s+—\s+/);
      const start = button("Let's set it up", { kind: "primary", cls: "big", onClick: () => (homeStep ? go("/welcome", { query: { step: "home" } }) : go("/code", { query: { auto: "1" } })) });
      start.setAttribute("data-act", "start");
      replace(root, h("div", { class: "welcome", "data-step": "gift" },
        h("img", { class: "app-icon", src: "icons/icon-512.png", alt: "", width: 104, height: 104 }),
        h("h1", { text: APP_NAME }),
        h("p", { class: "tag", text: "Your morning briefing, video studio and camera prompter for Lake Mary" }),
        h("p", { class: "note" }, (note.match(/[^.!?]+[.!?]+/g) || [note]).map(x => h("span", { text: x.trim() }))),
        from ? h("p", { class: "from", text: "— " + from }) : null,
        start));
    }

    function home() {
      replace(root, h("div", { class: "welcome", "data-step": "home" },
        h("h2", { text: `Put ${SHORT_NAME} on your home screen` }),
        h("ol", { class: "steps" },
          h("li", {}, h("span", { class: "n", text: "1" }), h("span", {}, "Tap ", h("span", { class: "g", "aria-hidden": "true" }, icon("share", 18)), " Share at the bottom of Safari.")),
          h("li", {}, h("span", { class: "n", text: "2" }), h("span", {}, "Tap ", h("span", { class: "g", "aria-hidden": "true" }, icon("addhome", 18)), " Add to Home Screen, then Add.")),
          h("li", {}, h("span", { class: "n", text: "3" }), h("span", { text: `Open ${SHORT_NAME} from your home screen.` }))),
        h("div", { class: "code-box", "data-code": pretty },
          h("span", { text: pretty ? "You'll type this once:" : "Your code is on your card from Isaac." }),
          pretty ? h("b", { text: pretty, "aria-label": "Your code: " + pretty.split("").join(" ") }) : null),
        h("p", { class: "tag", text: "The home-screen app keeps its own storage, apart from Safari, so it asks for the code one time." }),
        button("Not now, keep going in Safari", { kind: "quiet", onClick: () => go("/code", { query: { auto: "1" } }) })));
    }

    if (route.query.step === "home" && homeStep) home(); else gift();
    return () => {};
  },
};
