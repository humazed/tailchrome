import { describe, expect, it } from "vitest";
import { StateStore } from "@tailchrome/shared/background/state-store";
import { parseSettings, EGYPT_PROFILE, resolveLocation, reducedAgent, makeScope, type PagePolicy } from "./model";
import { matchesScope } from "./scope";
import { headerRules } from "./network";

describe("bundled Egypt profile", () => {
  it("works when a private exit node has no location metadata", () => {
    const state = new StateStore().getState();
    state.exitNode = { id: "exit", hostname: "private-exit", dnsName: "", online: true, location: null };
    expect(resolveLocation(state)).toEqual(EGYPT_PROFILE);
  });
  it("accepts Egypt but rejects known mismatched countries", () => {
    const state = new StateStore().getState();
    state.exitNode = { id: "exit", hostname: "exit", dnsName: "", online: true, location: { countryCode: "EG" } };
    expect(resolveLocation(state)?.timeZone).toBe("Africa/Cairo");
    state.exitNode.location = { countryCode: "GB" };
    expect(() => resolveLocation(state)).toThrow("Egypt");
    state.exitNode = null;
    expect(resolveLocation(state)).toBeNull();
  });
  it("rejects broken settings", () => {
    expect(() => parseSettings({ enabled: true })).toThrow();
  });
});

describe("routing and page scopes", () => {
  const scope = { split: { mode: "bypass" as const, domains: ["direct.example"] }, excluded: ["private.ts.net", "bank.example"] };
  it("matches subdomains without matching lookalike suffixes", () => {
    expect(matchesScope("a.direct.example", scope)).toBe(false);
    expect(matchesScope("notdirect.example", scope)).toBe(true);
    expect(matchesScope("shop.bank.example", scope)).toBe(false);
  });
  it("leaves local and literal-address requests alone", () => {
    for (const host of ["localhost", "printer", "printer.local", "a.localhost", "192.168.1.4", "8.8.8.8", "[2001:db8::1]"]) {
      expect(matchesScope(host, scope)).toBe(false);
    }
  });
  it("honors only-list mode, including an empty list", () => {
    expect(matchesScope("example.com", { split: { mode: "only", domains: [] }, excluded: [] })).toBe(false);
    expect(matchesScope("www.example.com", { split: { mode: "only", domains: ["example.com"] }, excluded: [] })).toBe(true);
  });
  it("derives internal exclusions from the actual connection", () => {
    const state = new StateStore().getState();
    state.magicDNSSuffix = "network.ts.net.";
    state.dnsRoutes = ["office.example"];
    const result = makeScope(state);
    expect(matchesScope("nas.network.ts.net", result)).toBe(false);
    expect(matchesScope("wiki.office.example", result)).toBe(false);
    expect(matchesScope("chromewebstore.google.com", result)).toBe(false);
  });
});

describe("request identity", () => {
  const policy: PagePolicy = {
    profile: EGYPT_PROFILE,
    timeZone: true, language: true, location: true, fingerprint: true, reduceAgent: true,
    userAgent: "Mozilla/5.0 Chrome/150.0.0.0", seed: 7, blockWorkers: false,
    scope: { split: { mode: "bypass", domains: ["direct.example"] }, excluded: ["bank.example"] },
  };
  it("sets language and browser headers together and removes extra version hints", () => {
    const rules = headerRules(policy);
    expect(rules[0]?.action.requestHeaders).toContainEqual({ header: "Accept-Language", operation: "set", value: "ar-EG" });
    expect(rules[0]?.action.requestHeaders).toContainEqual({ header: "User-Agent", operation: "set", value: policy.userAgent });
    expect(rules[0]?.action.requestHeaders).toContainEqual({ header: "Sec-CH-UA-Full-Version-List", operation: "remove" });
    expect(rules[0]?.condition.excludedRequestDomains).toContain("direct.example");
    expect(rules[0]?.condition.excludedInitiatorDomains).toContain("direct.example");
  });
  it("creates no header overrides while disconnected or for an empty only-list", () => {
    expect(headerRules(null)).toEqual([]);
    expect(headerRules({ ...policy, scope: { split: { mode: "only", domains: [] }, excluded: [] } })).toEqual([]);
  });
  it("retains browser family and operating system", () => {
    expect(reducedAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0.1234.56 Safari/537.36"))
      .toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0.0.0 Safari/537.36");
  });
});
