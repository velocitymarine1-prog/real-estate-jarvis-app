// rules.js: the check's two halves, loaded once (design §3.13): shared/compliance.js (the same module the Worker and the morning job
// run) and data/fair-housing.json (its word lists, which the module takes as ctx.rules). The rules are prepared once (compiled and
// warmed, compliance.prepareRules), so the check that runs as she types stays quick. Both files are cached by the service worker,
// so the check works offline; if either fails to load, the server's own findings (IdeaRow.check) stand.
let rulesP = null, complianceP = null, readyP = null;
export const loadRules = () => (rulesP ||= fetch("data/fair-housing.json").then(r => (r.ok ? r.json() : null)).catch(() => null));
export const loadCompliance = () => (complianceP ||= import("./shared/compliance.js").catch(e => { console.warn("compliance", e && e.message); return null; }));
export function checker() {
  return (readyP ||= Promise.all([loadCompliance(), loadRules()]).then(([C, R]) => {
    if (C && R && C.prepareRules) { try { C.prepareRules(R); } catch (e) { console.warn("prepareRules", e && e.message); } }
    return { C, R };
  }));
}
