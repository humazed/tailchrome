import type { WxtHooks, GeneratedPublicFile } from "wxt";
import { EGYPT_PROFILE, reducedAgent } from "./model";
import { installPagePrivacy } from "./page";
import { matchesScope } from "./scope";
import { PAGE_FEATURES, preparePagePolicy } from "./bundled";

// Windscribe's MV3 extension also packages known location profiles at build
// time and selects files through scripting.registerContentScripts. Output stays
// in WXT's build directory; maintained source files are never generated over.
export const privacyBuildHooks: Partial<WxtHooks> = {
  "build:publicAssets"(wxt, files) {
    if (wxt.config.browser !== "chrome") return;
    const pending = 'globalThis[Symbol.for("tailchrome.privacy.pending")]';
    const assets: GeneratedPublicFile[] = [{
      relativeDest: "privacy/egypt.js",
      contents: "(" + preparePagePolicy.toString() + ")(" +
        JSON.stringify({ profile: EGYPT_PROFILE, timeZone: false, location: false, language: false,
          reduceAgent: false, fingerprint: false, blockWorkers: false, seed: 0,
          scope: { split: { mode: "bypass", domains: [] }, excluded: [] } }).slice(0, -1) +
        ',"userAgent":(' + reducedAgent.toString() + ")(navigator.userAgent)});",
    }, {
      relativeDest: "privacy/apply.js",
      contents: "(()=>{const policy=" + pending + ";delete " + pending + ";if(!policy)return;(" +
        installPagePrivacy.toString() + ")(policy," + matchesScope.toString() + ");})();",
    }];
    for (const feature of PAGE_FEATURES) assets.push({
      relativeDest: "privacy/" + feature + ".js", contents: pending + "." + feature + "=true;",
    });
    for (let bit = 0; bit < 32; bit++) assets.push({
      relativeDest: "privacy/seed-" + bit + ".js", contents: pending + ".seed|=" + (1 << bit) + ";",
    });
    files.push(...assets);
  },
};
