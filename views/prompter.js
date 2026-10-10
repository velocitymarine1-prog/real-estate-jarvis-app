// prompter.js: full screen, two modes (design §3.5, states §3.20). Camera: the front camera fills the screen (mirrored on screen like a
// selfie, recorded unmirrored), the script runs in a shaded band near the lens in large type (24–44 px), scrolling at her speed (150
// words a minute to start). Record counts down 3-2-1 and starts the scroll; a tap on the text pauses or resumes it. After a take: play
// it back, Save to Photos or Share (the share sheet), or Retake; the take never leaves her phone. Text only: white on black, the same
// scrolling, for a second device or rehearsing. No camera, or no permission: text mode and how to allow it. A call or the app going to
// the back stops the take and keeps it. The screen stays awake while the prompter is open.
import * as store from "../store.js";
import { api, event } from "../api.js";
import { go, link } from "../router.js";
import { h, icon, replace, button, toast, reducedMotion, isIOS } from "../ui.js";

const MAX_MS = 3 * 60 * 1000;
const MIMES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const words = s => (String(s || "").match(/\S+/g) || []).length;

export default {
  async mount(root, route) {
    const id = route.arg;
    const from = ["today", "studio", "plan"].includes(route.query.from) ? route.query.from : "studio";
    const prefs = { wpm: 150, size: 32, textOnly: false, facing: "user", hidden: false, ...(store.get("prompter") || {}) };
    const savePrefs = () => store.set("prompter", { wpm: prefs.wpm, size: prefs.size, textOnly: prefs.textOnly, facing: prefs.facing, hidden: prefs.hidden });

    // ---------------------------------------------------------------- the words
    let title = "", lines = [], row = null;
    if (id === "text") {
      let t = null;
      try { t = JSON.parse(sessionStorage.getItem("jarvis:prompterText") || "null"); } catch { t = null; }
      title = (t && t.title) || "Your words";
      lines = String((t && t.text) || "").split(/\n+/).map(s => s.trim()).filter(Boolean).map(text => ({ text }));
    } else {
      row = store.idea(id);
      if (!row) { try { const r = await api("GET", `/ideas/${encodeURIComponent(id)}`); row = r && r.idea; if (row) store.saveIdea(row); } catch { row = null; } }
      const s = row && ((row.current >= 0 && row.versions && row.versions[row.current] && row.versions[row.current].script) || row.script);
      title = (s && s.title) || (row && row.idea && row.idea.title) || "";
      if (s) {
        if (s.hook && s.hook.say) lines.push({ cue: "Hook", text: s.hook.say });
        for (const b of s.beats || []) if (b.say) lines.push({ text: b.say });
        if (s.cta && s.cta.say) lines.push({ cue: "Call to action", text: s.cta.say });
      } else if (row && row.idea && row.idea.hook) lines.push({ cue: "Hook", text: row.idea.hook });
    }
    if (!lines.length) lines = [{ text: "Nothing to read yet. Write the script first, or paste your own words in the Studio." }];
    const totalWords = lines.reduce((n, l) => n + words(l.text), 0) || 1;

    // ---------------------------------------------------------------- the screen
    const st = { stream: null, recorder: null, chunks: [], mime: "", recording: false, startedAt: 0, scrolling: false, pos: 0, lastT: 0,
      raf: 0, wake: null, take: null, takeUrl: "", countdown: 0, msg: null, camErr: null, alive: true, timerInt: 0, stopTimer: 0, interrupted: false };
    const video = h("video", { class: "cam", playsInline: true, muted: true, autoplay: true, "aria-hidden": "true" });
    video.setAttribute("playsinline", ""); video.setAttribute("muted", "");
    const text = h("div", { class: "scrolltext" }, lines.map(l => [l.cue ? h("p", { class: "cue", text: l.cue }) : null, h("p", { text: l.text })]));
    const paused = h("span", { class: "paused", text: "Paused · tap the text", hidden: true, "aria-live": "polite" });
    const band = h("div", { class: "band", role: "region", "aria-label": "Script. Tap to pause or go on scrolling." }, text, h("i", { class: "readline", "aria-hidden": "true" }));
    const timer = h("span", { class: "timer", hidden: true, "aria-live": "off" });
    const countEl = h("div", { class: "countdown", hidden: true, "aria-live": "assertive" });
    const msg = h("div", { class: "p-msg", hidden: true, role: "alertdialog" });
    const takeBox = h("div", { class: "take", hidden: true });

    const topBtn = (ic, label, fn, extra = {}) => {
      const b = h("button", { type: "button", class: "pbtn", "aria-label": label, title: label, ...extra }, typeof ic === "string" ? icon(ic, 22) : ic);
      b.addEventListener("click", fn); return b;
    };
    const closeBtn = topBtn("close", "Close the prompter", close);
    const textBtn = h("button", { type: "button", class: "pbtn", "aria-pressed": prefs.textOnly ? "true" : "false", "data-act": "text-only" }, h("span", { text: "Text only" }));
    textBtn.addEventListener("click", () => setTextOnly(!prefs.textOnly));
    const hideBtn = topBtn(prefs.hidden ? "eyeoff" : "eye", prefs.hidden ? "Show the text" : "Hide the text", () => {
      prefs.hidden = !prefs.hidden; savePrefs(); applyLayout();
      replace(hideBtn, icon(prefs.hidden ? "eyeoff" : "eye", 22)); hideBtn.setAttribute("aria-label", prefs.hidden ? "Show the text" : "Hide the text");
    });
    const flipBtn = topBtn("flip", "Flip camera", flip, { "data-act": "flip" });

    const speedOut = h("output", { text: prefs.wpm + " wpm", "aria-live": "polite" });
    const sizeOut = h("output", { text: prefs.size + " px", "aria-live": "polite" });
    const step = (label, out, dec, inc) => h("div", { class: "p-step", role: "group", "aria-label": label },
      topBtn("minus", label + ": less", dec), out, topBtn("plus", label + ": more", inc));
    const speed = step("Speed", speedOut, () => setWpm(prefs.wpm - 10), () => setWpm(prefs.wpm + 10));
    const size = step("Text size", sizeOut, () => setSize(prefs.size - 4), () => setSize(prefs.size + 4));
    const rec = h("button", { type: "button", class: "recbtn", "aria-label": "Record", "data-act": "record" }, h("i"));
    rec.addEventListener("click", () => (st.recording ? stopRecording() : st.countdown ? null : startCountdown()));
    const playBtn = topBtn("play", "Start scrolling", () => (st.scrolling ? pause() : resume()), { "data-act": "scroll" });
    const restartBtn = topBtn("refresh", "Back to the start", () => { st.pos = 0; place(); });

    const screen = h("div", { class: "prompter", "data-mode": "camera" },
      h("h1", { class: "sr-only", text: "Prompter" + (title ? ": " + title : "") }),
      video, band, timer, countEl,
      h("div", { class: "p-top" }, closeBtn, h("span", { class: "spacer" }, paused), textBtn, hideBtn, flipBtn),
      h("div", { class: "p-bottom" },
        h("div", { class: "p-steppers" }, speed, size),
        h("div", { class: "p-main" }, h("div", { class: "left" }, restartBtn), rec, h("div", { class: "right" }, playBtn))),
      msg, takeBox);
    replace(root, screen);

    // ---------------------------------------------------------------- scrolling
    function readTop() { return band.clientHeight * 0.3; }
    function place() {
      text.style.transform = `translate3d(0, ${Math.round(readTop() - st.pos)}px, 0)`;
      paused.hidden = st.scrolling || st.pos <= 0 || st.pos >= text.scrollHeight - 4;
    }
    function pxPerSec() { return (text.scrollHeight / totalWords) * (prefs.wpm / 60); }
    function tick(t) {
      if (!st.alive) return;
      if (st.scrolling) {
        const dt = st.lastT ? Math.min(0.1, (t - st.lastT) / 1000) : 0;
        st.pos = Math.min(text.scrollHeight, st.pos + pxPerSec() * dt);
        place();
        if (st.pos >= text.scrollHeight) { st.scrolling = false; syncPlay(); }
      }
      st.lastT = t;
      st.raf = requestAnimationFrame(tick);
    }
    function resume() { if (st.pos >= text.scrollHeight - 2) st.pos = 0; st.scrolling = true; st.lastT = 0; syncPlay(); place(); }
    function pause() { st.scrolling = false; syncPlay(); place(); }
    function syncPlay() { replace(playBtn, icon(st.scrolling ? "pause" : "play", 22)); playBtn.setAttribute("aria-label", st.scrolling ? "Pause scrolling" : "Start scrolling"); }
    function setWpm(v) { prefs.wpm = Math.max(80, Math.min(220, v)); speedOut.textContent = prefs.wpm + " wpm"; savePrefs(); }
    function setSize(v) {
      const ratio = text.scrollHeight ? st.pos / text.scrollHeight : 0;
      prefs.size = Math.max(24, Math.min(44, v)); sizeOut.textContent = prefs.size + " px"; savePrefs();
      text.style.fontSize = prefs.size + "px";
      st.pos = ratio * text.scrollHeight; place();
    }
    // a tap on the text pauses or goes on; a drag moves it by hand
    let drag = null;
    band.addEventListener("pointerdown", e => { drag = { y: e.clientY, pos: st.pos, moved: false }; band.setPointerCapture && band.setPointerCapture(e.pointerId); });
    band.addEventListener("pointermove", e => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) { st.pos = Math.max(0, Math.min(text.scrollHeight, drag.pos - dy)); place(); }
    });
    band.addEventListener("pointerup", () => { if (drag && !drag.moved) (st.scrolling ? pause() : resume()); drag = null; });
    band.addEventListener("pointercancel", () => { drag = null; });
    band.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); st.scrolling ? pause() : resume(); } });
    band.tabIndex = 0;

    // ---------------------------------------------------------------- the camera
    async function startCamera() {
      stopCamera();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cameraTrouble("none"); return; }
      const want = { video: { facingMode: prefs.facing, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true } };
      try {
        st.stream = await navigator.mediaDevices.getUserMedia(want);
      } catch (e) {
        if (e && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          try { st.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
          catch (e2) { cameraTrouble(e2 && e2.name === "NotAllowedError" ? "denied" : "none"); return; }
        } else { cameraTrouble(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "none"); return; }
      }
      if (!st.alive) { stopCamera(); return; }
      video.srcObject = st.stream;
      video.classList.toggle("mirror", prefs.facing === "user");
      try { await video.play(); } catch { /* autoplay of a muted stream is allowed; a second tap starts it if not */ }
      for (const tr of st.stream.getTracks()) tr.addEventListener("ended", () => { if (st.recording) { st.interrupted = true; stopRecording(); } });
      st.camErr = null; msg.hidden = true;
      rec.disabled = false;
    }
    function stopCamera() {
      if (st.stream) { for (const tr of st.stream.getTracks()) tr.stop(); st.stream = null; }
      video.srcObject = null;
    }
    function cameraTrouble(kind) {
      st.camErr = kind;
      prefs.textOnly = true; applyLayout();
      const ios = isIOS();
      replace(msg,
        h("h2", { text: kind === "denied" ? "Jarvis can't use the camera" : "No camera here" }),
        h("p", { text: kind === "denied"
          ? (ios ? "To allow it, open Settings › Apps › Safari › Camera and choose Allow or Ask, then come back and tap Try again. Until then, the text scrolls here on its own." : "Allow the camera for this site in your browser's settings, then tap Try again. Until then, the text scrolls here on its own.")
          : "This device has no camera Jarvis can use, so the prompter is in text mode. It works well on a second device propped beside your phone." }),
        h("div", { class: "btns" },
          kind === "denied" ? button("Try again", { kind: "lake", icon: "refresh", onClick: () => { msg.hidden = true; setTextOnly(false); } }) : null,
          button("Use text only", { kind: "ghost", onClick: () => { msg.hidden = true; } })));
      msg.hidden = false;
    }
    async function flip() {
      if (st.recording) return;
      prefs.facing = prefs.facing === "user" ? "environment" : "user"; savePrefs();
      if (!prefs.textOnly) await startCamera();
    }
    function setTextOnly(on) {
      if (st.recording) return;
      prefs.textOnly = on; savePrefs(); applyLayout();
      if (on) stopCamera(); else startCamera();
    }
    function applyLayout() {
      screen.classList.toggle("textonly", prefs.textOnly);
      screen.classList.toggle("hide-text", prefs.hidden && !prefs.textOnly);
      screen.dataset.mode = prefs.textOnly ? "text" : "camera";
      textBtn.setAttribute("aria-pressed", prefs.textOnly ? "true" : "false");
      rec.hidden = prefs.textOnly; flipBtn.disabled = prefs.textOnly; hideBtn.disabled = prefs.textOnly;
      requestAnimationFrame(place);
    }

    // ---------------------------------------------------------------- recording
    function startCountdown() {
      if (!st.stream || prefs.textOnly) { toast("Turn the camera on first."); return; }
      pause(); st.pos = 0; place();
      st.countdown = 3; countEl.hidden = false; countEl.textContent = "3";
      rec.setAttribute("aria-label", "Counting down");
      const stepDown = () => {
        if (!st.alive || !st.countdown) return;
        st.countdown -= 1;
        if (st.countdown > 0) { countEl.textContent = String(st.countdown); setTimeout(stepDown, 1000); }
        else { countEl.hidden = true; startRecording(); }
      };
      setTimeout(stepDown, 1000);
    }
    function startRecording() {
      const mime = typeof MediaRecorder !== "undefined" ? MIMES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "" : "";
      try {
        st.recorder = new MediaRecorder(st.stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 } : { videoBitsPerSecond: 8_000_000 });
      } catch (e) { toast("This browser can't record video. Use text only, and film with your camera app."); return; }
      st.mime = st.recorder.mimeType || mime || "video/mp4";
      st.chunks = []; st.interrupted = false; st.finished = false;
      st.recorder.addEventListener("dataavailable", e => { if (e.data && e.data.size) st.chunks.push(e.data); });
      st.recorder.addEventListener("stop", finished);
      st.recorder.addEventListener("error", e => {
        const name = e && e.error && e.error.name;
        if (name === "QuotaExceededError") toast("Your phone is out of space for this take.");
        stopRecording();
      });
      st.recorder.start(1000);
      st.recording = true; st.startedAt = Date.now();
      rec.classList.add("on"); rec.setAttribute("aria-label", "Stop recording");
      flipBtn.disabled = true; textBtn.disabled = true;
      timer.hidden = false; tickTimer(); st.timerInt = setInterval(tickTimer, 500);
      st.stopTimer = setTimeout(() => { toast("Three minutes is the most a take can be."); stopRecording(); }, MAX_MS);
      resume();
    }
    function tickTimer() {
      const s = Math.floor((Date.now() - st.startedAt) / 1000);
      timer.textContent = `● REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    function stopRecording() {
      if (!st.recording) return;
      st.recording = false;
      clearInterval(st.timerInt); clearTimeout(st.stopTimer);
      pause();
      rec.classList.remove("on"); rec.setAttribute("aria-label", "Record");
      flipBtn.disabled = prefs.textOnly; textBtn.disabled = false; timer.hidden = true;
      try { if (st.recorder && st.recorder.state !== "inactive") { st.recorder.requestData && st.recorder.requestData(); st.recorder.stop(); } } catch { finished(); }
    }
    function finished() {
      if (st.finished) return;
      st.finished = true;
      const blob = new Blob(st.chunks, { type: (st.mime || "video/mp4").split(";")[0] });
      st.recorder = null;
      if (!blob.size) { toast("That take came out empty. Try again."); return; }
      st.take = { blob, ms: Date.now() - st.startedAt, type: blob.type };
      showTake();
    }
    function showTake() {
      if (st.takeUrl) URL.revokeObjectURL(st.takeUrl);
      st.takeUrl = URL.createObjectURL(st.take.blob);
      const v = h("video", { src: st.takeUrl, controls: true, playsInline: true, "aria-label": "Your take" });
      v.setAttribute("playsinline", "");
      const secs = Math.round(st.take.ms / 1000), mb = st.take.blob.size / 1048576;
      const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [takeFile()] })); } catch { return false; } })();
      const saveB = button(canShare ? "Save to Photos" : "Save the video", { kind: "primary", cls: "block big", icon: "download", onClick: () => keep("save") });
      saveB.setAttribute("data-act", "save-take");
      const shareB = canShare ? button("Share", { kind: "ghost", icon: "share", onClick: () => keep("share") }) : null;
      const retake = button("Retake", { kind: "ghost", icon: "refresh", onClick: retakeIt });
      retake.setAttribute("data-act", "retake");
      replace(takeBox, v, h("div", { class: "acts" },
        st.interrupted ? h("p", { class: "meta", text: "The take stopped when the phone was busy. What you recorded is kept." }) : null,
        h("p", { class: "meta", text: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · ${mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(mb * 1024)) + " KB"} · stays on your phone until you save it` }),
        saveB, h("div", { class: "btns" }, shareB, retake)));
      takeBox.hidden = false;
      takeBox.dataset.size = String(st.take.blob.size);
      takeBox.dataset.type = st.take.type;
      try { v.play().catch(() => {}); } catch { /* */ }
    }
    function takeFile() {
      const ext = /mp4/.test(st.take.type) ? "mp4" : "webm";
      const slug = (title || "take").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "take";
      return new File([st.take.blob], `jarvis-${slug}.${ext}`, { type: st.take.type || "video/mp4" });
    }
    async function keep(how) {
      const file = takeFile();
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share(how === "share" ? { files: [file], title: title || "My video" } : { files: [file] });
        } else {
          const a = h("a", { href: st.takeUrl, download: file.name, class: "offscreen" });
          document.body.append(a); a.click(); a.remove();
        }
        markFilmed();
      } catch (e) {
        if (e && e.name === "AbortError") return;           // she closed the share sheet
        toast("Couldn't save it. Press and hold the video to save it instead.");
      }
    }
    async function markFilmed() {
      event("record");
      toast("Saved. Nice take!");
      if (!row || ["filmed", "posted"].includes(row.status)) return;
      try { const r = await api("PATCH", `/ideas/${encodeURIComponent(id)}`, { status: "filmed" }); if (r && r.idea) { row = r.idea; store.saveIdea(r.idea); } } catch { /* the take is saved; Plan can be moved by hand */ }
    }
    function retakeIt() {
      takeBox.hidden = true; replace(takeBox);
      if (st.takeUrl) { URL.revokeObjectURL(st.takeUrl); st.takeUrl = ""; }
      st.take = null; st.pos = 0; place();
    }

    // ---------------------------------------------------------------- awake, interrupted, closed
    async function wakeLock() {
      try { if ("wakeLock" in navigator && document.visibilityState === "visible") { st.wake = await navigator.wakeLock.request("screen"); } } catch { st.wake = null; }
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") { if (st.recording) { st.interrupted = true; stopRecording(); } pause(); }
      else { wakeLock(); if (!prefs.textOnly && !st.stream && !st.camErr) startCamera(); }
    }
    document.addEventListener("visibilitychange", onVisibility);
    function close() {
      if (st.recording) stopRecording();
      if (id === "text") go("/" + from); else go("/idea/" + id, { query: { from } });
    }

    // ---------------------------------------------------------------- start
    text.style.fontSize = prefs.size + "px";
    syncPlay();
    applyLayout();
    requestAnimationFrame(() => { place(); st.raf = requestAnimationFrame(tick); });
    wakeLock();
    event("prompter");
    rec.disabled = true;
    if (!prefs.textOnly) startCamera(); else rec.hidden = true;
    if (reducedMotion()) { /* the scroll is the one movement she asked for; it stays */ }

    window.__jarvis && (window.__jarvis.prompter = {
      state: () => ({ pos: st.pos, height: text.scrollHeight, scrolling: st.scrolling, recording: st.recording, mode: screen.dataset.mode, camera: !!st.stream,
        videoWidth: video.videoWidth, videoHeight: video.videoHeight, mime: st.mime, takeSize: st.take ? st.take.blob.size : 0, takeType: st.take ? st.take.type : "",
        wpm: prefs.wpm, size: prefs.size, camErr: st.camErr, words: totalWords, mirrored: video.classList.contains("mirror") }),
    });

    return () => {
      st.alive = false;
      cancelAnimationFrame(st.raf);
      document.removeEventListener("visibilitychange", onVisibility);
      if (st.recording) { try { st.recorder.stop(); } catch { /* */ } }
      clearInterval(st.timerInt); clearTimeout(st.stopTimer);
      stopCamera();
      if (st.wake) { try { st.wake.release(); } catch { /* */ } }
      if (st.takeUrl) URL.revokeObjectURL(st.takeUrl);
      if (window.__jarvis) delete window.__jarvis.prompter;
    };
  },
};
