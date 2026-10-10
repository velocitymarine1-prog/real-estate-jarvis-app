// invite.js: the code screen (design §3.7 step 3, §3.16). She types the eight characters once (case, spaces and the dash don't matter;
// I and L read as 1, O as 0). Wherever the address still carried the invite it fills itself, and from the welcome it redeems at once.
// After a 401 it says "This phone was signed out. Type your code to come back."
import * as store from "../store.js";
import { api, ApiError } from "../api.js";
import { go } from "../router.js";
import { API, APP_NAME } from "../config.js";
import { h, replace, button, notice, deviceLabel } from "../ui.js";
import { normalizeCode, formatCode } from "../shared/ids.js";

export default {
  async mount(root, route) {
    const pending = sessionStorage.getItem("jarvis:invite") || "";
    const signedOut = sessionStorage.getItem("jarvis:signedOut") === "1";
    let busy = false;

    const input = h("input", { class: "input code-input", id: "code", type: "text", inputMode: "text", maxLength: 12, autocomplete: "off",
      spellcheck: false, placeholder: "XXXX-XXXX", "aria-describedby": "code-help", enterKeyHint: "go",
      value: normalizeCode(pending) ? formatCode(pending) : "" });
    input.setAttribute("autocapitalize", "characters"); input.setAttribute("autocorrect", "off");
    const err = h("div", { class: "code-err", "aria-live": "assertive" });
    const goBtn = button("Continue", { kind: "primary", cls: "block big", onClick: () => redeem() });
    goBtn.setAttribute("data-act", "redeem");
    input.addEventListener("input", () => {
      const raw = input.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
      if (raw.length <= 8) { const f = raw.length > 4 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw; if (f !== input.value) input.value = f; }
      replace(err);
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter") redeem(); });

    replace(root, h("div", { class: "code-screen" },
      h("img", { class: "app-icon", src: "icons/icon-192.png", alt: "", width: 72, height: 72 }),
      h("h1", { text: signedOut ? "Welcome back" : "Type your code" }),
      signedOut ? notice("This phone was signed out. Type your code to come back.", { kind: "calm", icon: "info" }) : null,
      h("p", { class: "lede", id: "code-help", text: "It's on your birthday card from Isaac: eight letters and numbers. Capitals, spaces and the dash don't matter." }),
      h("label", { class: "sr-only", htmlFor: "code", text: "Your code" }),
      input, err, goBtn,
      h("p", { class: "small muted", text: `Lost it? Ask Isaac for a new code. ${APP_NAME} keeps your ideas on his server, so nothing is lost.` })));

    async function redeem() {
      if (busy) return;
      const code = normalizeCode(input.value);
      if (!code) { replace(err, notice("That's not quite eight letters and numbers. Check your card and try again.", { kind: "warn", icon: "info" })); input.focus(); return; }
      busy = true; goBtn.disabled = true; goBtn.querySelector("span").textContent = "Checking…";
      try {
        const r = await api("POST", "/invite", { code, label: deviceLabel() }, { auth: false, timeout: 20000 });
        if (!r || !r.token) throw new ApiError("other");
        await store.setToken(r.token, API);
        const u = r.user || {};
        store.setMe({ user: { id: u.id, name: u.name || "", role: u.role || "user", onboardedAt: u.onboarded ? new Date().toISOString() : null, profile: {} } });
        try { const m = await api("GET", "/me"); if (m && m.user) store.setMe(m); } catch { /* the invite's answer is enough to go on */ }
        sessionStorage.removeItem("jarvis:invite"); sessionStorage.removeItem("jarvis:signedOut");
        const done = store.live.me && store.live.me.user && (store.live.me.user.onboardedAt || store.live.me.user.onboarded);
        go(done ? "/today" : "/setup/1", { replace: true });
      } catch (e) {
        busy = false; goBtn.disabled = false; goBtn.querySelector("span").textContent = "Continue";
        const msg = e.kind === "offline" ? "You're offline. Connect to Wi-Fi or data and try again."
          : e.status === 429 ? "That's a lot of tries. Wait a minute and try again." : e.reason;
        replace(err, notice(msg, { kind: "warn", icon: "info" }));
      }
    }

    if (route.query.auto === "1" && normalizeCode(pending)) redeem();
    else setTimeout(() => input.focus({ preventScroll: true }), 80);
    return () => {};
  },
};
