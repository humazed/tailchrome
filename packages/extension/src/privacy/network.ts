import { RULE_IDS, type PagePolicy } from "./model";

export function headerRules(policy: PagePolicy | null): chrome.declarativeNetRequest.Rule[] {
  if (!policy) return [];
  const requestHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [];
  if (policy.language && policy.profile) {
    requestHeaders.push({ header: "Accept-Language", operation: "set", value: policy.profile.language });
  }
  if (policy.reduceAgent) {
    requestHeaders.push({ header: "User-Agent", operation: "set", value: policy.userAgent });
    for (const header of ["Sec-CH-UA-Arch", "Sec-CH-UA-Bitness", "Sec-CH-UA-Model",
      "Sec-CH-UA-Platform-Version", "Sec-CH-UA-Full-Version", "Sec-CH-UA-Full-Version-List"]) {
      requestHeaders.push({ header, operation: "remove" });
    }
  }
  if (!requestHeaders.length || policy.scope.split.mode === "only" && !policy.scope.split.domains.length) return [];
  const resourceTypes: NonNullable<chrome.declarativeNetRequest.RuleCondition["resourceTypes"]> = [
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
    "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
  ];
  const excludedDomains = ["localhost", "local", ...policy.scope.excluded,
    ...(policy.scope.split.mode === "bypass" ? policy.scope.split.domains : [])];
  return [{
    id: RULE_IDS[0],
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders },
    condition: {
      resourceTypes,
      regexFilter: "^https?://[^/:]+\\.[^/:]+[:/]",
      excludedRequestDomains: excludedDomains,
      excludedInitiatorDomains: excludedDomains,
      ...(policy.scope.split.mode === "only" ? { requestDomains: policy.scope.split.domains } : {}),
    },
  }, {
    id: RULE_IDS[1],
    priority: 2,
    action: { type: "allow" },
    condition: { resourceTypes, regexFilter: "^https?://[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+[:/]" },
  }];
}
