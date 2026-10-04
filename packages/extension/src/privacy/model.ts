import type { DomainSplitConfig, TailscaleState } from "@tailchrome/shared/types";

export const SETTINGS_KEY = "privacy.settings.v1";
export const STATUS_KEY = "privacy.status.v1";
export const SEED_KEY = "privacy.seed.v1";
export const SCRIPT_ID = "tailchrome-privacy";
export const RULE_IDS: [number, number] = [74001, 74002];
export const RESTRICTED_DOMAINS = ["chromewebstore.google.com", "chrome.google.com"];

export interface LocationProfile {
  latitude: number;
  longitude: number;
  timeZone: string;
  language: string;
  accuracy: number;
}

export interface PrivacySettings {
  enabled: boolean;
  timeZone: boolean;
  location: boolean;
  language: boolean;
  webRTC: boolean;
  reduceAgent: boolean;
  fingerprint: boolean;
  blockWorkers: boolean;
  cookies: "off" | "visited";
  excludedDomains: string[];
}

export interface PagePolicy {
  profile: LocationProfile | null;
  timeZone: boolean;
  location: boolean;
  language: boolean;
  reduceAgent: boolean;
  userAgent: string;
  fingerprint: boolean;
  blockWorkers: boolean;
  seed: number;
  scope: Scope;
}

export interface Scope {
  split: DomainSplitConfig;
  excluded: string[];
}

export type PrivacyStatus =
  | { kind: "inactive"; message: string }
  | { kind: "applying"; message: string }
  | { kind: "ready"; message: string; nodeId: string; profile: LocationProfile | null }
  | { kind: "attention"; message: string };

export const DEFAULT_SETTINGS: PrivacySettings = {
  enabled: true,
  timeZone: true,
  location: true,
  language: true,
  webRTC: true,
  reduceAgent: true,
  fingerprint: true,
  blockWorkers: false,
  cookies: "off",
  excludedDomains: [],
};

export function parseSettings(value: unknown): PrivacySettings {
  if (value === undefined) return structuredClone(DEFAULT_SETTINGS);
  const input = record(value);
  const result = structuredClone(DEFAULT_SETTINGS);
  for (const key of ["enabled", "timeZone", "location", "language", "webRTC",
    "reduceAgent", "fingerprint", "blockWorkers"] as const) {
    if (typeof input[key] !== "boolean") throw new Error("Invalid privacy setting: " + key);
    result[key] = input[key];
  }
  if (input.cookies !== "off" && input.cookies !== "visited") throw new Error("Invalid cookie setting.");
  result.cookies = input.cookies;
  if (!Array.isArray(input.excludedDomains)) throw new Error("Invalid excluded domains.");
  result.excludedDomains = [...new Set(input.excludedDomains.map(parseDomain))];
  return result;
}

// Deliberately approximate country-level coordinates, not a claimed server city.
export const EGYPT_PROFILE: Readonly<LocationProfile> = Object.freeze({
  latitude: 26.8206, longitude: 30.8025, accuracy: 600_000,
  timeZone: "Africa/Cairo", language: "ar-EG",
});

export function resolveLocation(state: TailscaleState): LocationProfile | null {
  const node = state.exitNode;
  if (!node) return null;
  const country = (node.location ?? state.peers.find(peer => peer.id === node.id)?.location)?.countryCode;
  if (country && country.toUpperCase() !== "EG") {
    throw new Error("The bundled profile is for Egypt, but this exit node reports " + country + ".");
  }
  return { ...EGYPT_PROFILE };
}

export function makeScope(state: TailscaleState, settings: PrivacySettings): Scope {
  const internal = [state.magicDNSSuffix, ...(state.dnsRoutes ?? []), ...state.splitDNSDomains];
  return {
    split: state.domainSplit,
    excluded: [...new Set([...RESTRICTED_DOMAINS, ...settings.excludedDomains,
      ...internal.filter((value): value is string => Boolean(value)).map(value => value.replace(/\.$/, "").toLowerCase())])],
  };
}

export function reducedAgent(agent: string): string {
  return agent.replace(/(Chrome|Chromium|Edg|Firefox)\/(\d+)(?:\.\d+)+/g, "$1/$2.0.0.0")
    .replace(/Firefox\/(\d+)\.0\.0\.0/g, "Firefox/$1.0");
}

export function parseDomain(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a domain name.");
  const domain = value.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  if (!domain || /[/:?#@\s]/.test(domain)) throw new Error("Enter a hostname, without a scheme or path.");
  const hostname = new URL("https://" + domain).hostname;
  if (!hostname.includes(".")) throw new Error("Enter a complete domain name.");
  return hostname;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid privacy settings.");
  return value as Record<string, unknown>;
}
