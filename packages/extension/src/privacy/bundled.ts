import { SCRIPT_ID, type PagePolicy } from "./model";

export const PAGE_FEATURES = ["timeZone", "location", "language", "reduceAgent", "fingerprint", "blockWorkers"] as const;

// Used only by executeScript, with Chrome-serialized arguments. No extension
// API or secret is exposed to the page. apply.js consumes and removes this data.
export function preparePagePolicy(policy: PagePolicy): void {
  const key = Symbol.for("tailchrome.privacy.pending");
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: policy });
}

export function registeredPrivacyScript(policy: PagePolicy): chrome.scripting.RegisteredContentScript {
  const matches = policy.scope.split.mode === "only" ?
    policy.scope.split.domains.map(domain => "*://*." + domain + "/*") : ["http://*/*", "https://*/*"];
  const excluded = ["localhost", "local", ...policy.scope.excluded,
    ...(policy.scope.split.mode === "bypass" ? policy.scope.split.domains : [])];
  const js = ["privacy/egypt.js"];
  for (const feature of PAGE_FEATURES) if (policy[feature]) js.push("privacy/" + feature + ".js");
  // Packaged bit setters encode the session seed without generated runtime
  // code or an extra permission. All files are shipped with the extension.
  for (let bit = 0; bit < 32; bit++) if ((policy.seed >>> bit) & 1) js.push("privacy/seed-" + bit + ".js");
  js.push("privacy/apply.js");
  return {
    id: SCRIPT_ID, matches, excludeMatches: [...new Set(excluded)].map(domain => "*://*." + domain + "/*"),
    allFrames: true, runAt: "document_start", world: "MAIN", persistAcrossSessions: false, js,
  };
}
