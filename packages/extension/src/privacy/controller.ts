import type { TailscaleState } from "@tailchrome/shared/types";
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, STATUS_KEY, SEED_KEY, SCRIPT_ID, RULE_IDS, RESTRICTED_DOMAINS,
  makeScope, parseSettings, resolveLocation, reducedAgent,
  type PagePolicy, type PrivacySettings, type PrivacyStatus, type Scope,
} from "./model";
import { matchesScope } from "./scope";
import { clearPagePrivacy } from "./page";
import { preparePagePolicy, registeredPrivacyScript } from "./bundled";
import { headerRules } from "./network";
import { CookieCleaner } from "./cookies";

type PageUpdateResult = { kind: "applied" } | { kind: "reload-required"; message: string };

export class PrivacyController {
  constructor() {
    this.ready = this.load().catch(error => { this.startupError = errorMessage(error); });
    chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
      if (!isPrivacyMessage(message) || sender.id !== chrome.runtime.id ||
          !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
      this.handle(message).then(respond, error => respond({ ok: false, error: errorMessage(error) }));
      return true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[SETTINGS_KEY]) return;
      try {
        this.settings = parseSettings(changes[SETTINGS_KEY].newValue);
        this.startupError = null;
        this.refresh();
      } catch (error) {
        this.startupError = errorMessage(error);
        this.refresh();
      }
    });
    chrome.runtime.onInstalled.addListener(() => { this.appliedKey = ""; this.refresh(); });
    chrome.permissions.onAdded.addListener(() => this.refresh());
    chrome.permissions.onRemoved.addListener(() => this.refresh());
    chrome.privacy.network.webRTCIPHandlingPolicy.onChange.addListener(details => {
      if (this.state && this.settings.enabled && this.settings.webRTC &&
          (details.levelOfControl === "controlled_by_other_extensions" || details.levelOfControl === "not_controllable")) {
        this.fail(new Error("Another extension or browser policy controls WebRTC protection."));
      }
    });
    this.cookies = new CookieCleaner(
      () => this.settings.cookies === "visited" ? this.cookieScope : null,
      error => this.fail(error),
    );
  }

  observe(state: TailscaleState): void {
    this.state = state;
    const key = JSON.stringify([
      state.exitNode, state.pendingExitNodeID, state.backendState, state.hostConnected,
      state.routingPolicy, state.routingHealth?.status, state.domainSplit, state.magicDNSSuffix,
      state.dnsRoutes, state.splitDNSDomains,
    ]);
    if (key === this.observedKey) return;
    this.observedKey = key;
    this.refresh();
  }

  private state: TailscaleState | null = null;
  private settings: PrivacySettings = structuredClone(DEFAULT_SETTINGS);
  private policy: PagePolicy | null = null;
  private cookieScope: Scope | null = null;
  private seed = 0;
  private observedKey = "";
  private appliedKey = "";
  private startupError: string | null = null;
  private status: PrivacyStatus = { kind: "inactive", message: "Waiting for the connection." };
  private chain = Promise.resolve();
  private readonly ready: Promise<void>;
  private readonly cookies: CookieCleaner;

  private async load(): Promise<void> {
    const [local, session] = await Promise.all([
      chrome.storage.local.get(SETTINGS_KEY), chrome.storage.session.get(SEED_KEY),
    ]);
    this.settings = parseSettings(local[SETTINGS_KEY]);
    const saved: unknown = session[SEED_KEY];
    this.seed = typeof saved === "number" && Number.isInteger(saved) ? saved : Number.parseInt(crypto.randomUUID().slice(0, 8), 16);
    await chrome.storage.session.set({ [SEED_KEY]: this.seed });
  }

  private refresh(): void {
    this.chain = this.chain.then(async () => {
      await this.ready;
      await this.sync();
    }).catch(async error => {
      // Do not leave a previous node's headers behind after a permission,
      // registration or location failure.
      let message = errorMessage(error);
      try {
        const cleanup = await this.apply(null);
        if (cleanup.kind === "reload-required") message += " " + cleanup.message;
      }
      catch (cleanupError) { message += " " + errorMessage(cleanupError); }
      await this.fail(new Error(message));
    });
  }

  private async handle(message: PrivacyMessage): Promise<unknown> {
    await this.ready;
    if (message.action === "save") {
      const settings = parseSettings(message.settings);
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      this.settings = settings;
      this.startupError = null;
    }
    this.refresh();
    await this.chain;
    const state = this.state;
    return { ok: true, settings: this.settings, status: this.status,
      currentNodeId: state?.exitNode?.id ?? null };
  }

  private async sync(): Promise<void> {
    if (this.startupError) {
      this.cookieScope = null;
      throw new Error(this.startupError);
    }
    const state = this.state;
    const node = state?.exitNode;
    const connected = state?.backendState === "Running" && state.hostConnected &&
      state.routingPolicy?.mode === "active" && state.routingHealth?.status === "active" &&
      node?.online && !state.pendingExitNodeID && state.routingPolicy.selectedExitNodeID === node.id;
    if (!this.settings.enabled || !connected || !state || !node) {
      this.cookieScope = null;
      const [pages, webRTC] = await Promise.allSettled([this.apply(null), this.setWebRTC(false)]);
      if (pages.status === "rejected") throw pages.reason;
      if (webRTC.status === "rejected") throw webRTC.reason;
      if (pages.value.kind === "reload-required") {
        await this.report({ kind: "attention", message: pages.value.message });
        return;
      }
      await this.report({ kind: "inactive", message: this.settings.enabled ?
        "Location matching is inactive until an exit node is connected." : "Privacy features are turned off." });
      return;
    }
    await this.report({ kind: "applying", message: "Applying privacy settings for " + node.hostname + "." });
    await this.setWebRTC(this.settings.webRTC);
    this.cookieScope = makeScope(state, this.settings);
    const profile = resolveLocation(state);
    const policy: PagePolicy = {
      profile, timeZone: this.settings.timeZone, location: this.settings.location,
      language: this.settings.language, reduceAgent: this.settings.reduceAgent,
      userAgent: reducedAgent(navigator.userAgent), fingerprint: this.settings.fingerprint,
      blockWorkers: this.settings.blockWorkers, seed: this.seed, scope: makeScope(state, this.settings),
    };
    const needsPage = this.settings.timeZone || this.settings.location || this.settings.language ||
      this.settings.reduceAgent || this.settings.fingerprint || this.settings.blockWorkers;
    const pages = await this.apply(needsPage ? policy : null);
    if (pages.kind === "reload-required") {
      await this.report({ kind: "attention", message: pages.message });
      return;
    }
    await this.report({
      kind: "ready", message: "The Egypt privacy profile is active for " + node.hostname + ".",
      nodeId: node.id, profile,
    });
  }

  private async apply(policy: PagePolicy | null): Promise<PageUpdateResult> {
    const previousPolicy = this.policy;
    const key = JSON.stringify(policy);
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (key === this.appliedKey && (!policy || scripts.length > 0)) return { kind: "applied" };
    if (policy) {
      const registration = registeredPrivacyScript(policy);
      // Chrome rejects an empty matches list. Only-list mode with no domains
      // has no covered documents and needs no registration.
      if (!registration.matches?.length) {
        if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      } else if (scripts.length) await chrome.scripting.updateContentScripts([registration]);
      else await chrome.scripting.registerContentScripts([registration]);
    } else if (scripts.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: RULE_IDS, addRules: headerRules(policy),
    });
    this.policy = policy;
    this.appliedKey = key;
    // Open pages may already have cached old values. Update future reads without
    // reloading a user's forms; the settings page explains the reload boundary.
    const tabs = await chrome.tabs.query({});
    const tabIds = tabs.flatMap(tab => {
      // Discarded tabs have no live document; document-start scripts cover
      // their next load. Trying to inject into them can fail or wake them.
      if (tab.discarded || tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return [];
      const host = new URL(tab.url).hostname;
      if (RESTRICTED_DOMAINS.includes(host)) return [];
      return [tab.id];
    });
    const results = await Promise.allSettled(tabIds.map(async tabId => {
      if (!policy) return chrome.scripting.executeScript({
        target: { tabId, allFrames: true }, world: "MAIN", func: clearPagePrivacy,
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true }, world: "MAIN", func: preparePagePolicy, args: [policy],
      });
      return chrome.scripting.executeScript({
        target: { tabId, allFrames: true }, world: "MAIN", files: ["privacy/apply.js"],
      });
    }));
    const failures = results.filter(result => result.status === "rejected" ||
      result.value.some(frame => "error" in frame && frame.error));
    if (failures.length && (policy || previousPolicy)) {
      this.appliedKey = "";
      // A closed/restricted frame must not undo the successfully registered
      // scripts and headers for every other tab. Keep the warning visible and
      // retry existing documents on the next status check.
      return { kind: "reload-required", message:
        (policy ? "The Egypt privacy profile is applied to new pages. " : "Privacy overrides are disabled for new pages. ") +
        failures.length + " open tab(s) could not be updated; reload those pages to apply the current settings." };
    }
    return { kind: "applied" };
  }

  private async setWebRTC(enabled: boolean): Promise<void> {
    const setting = chrome.privacy.network.webRTCIPHandlingPolicy;
    const current = await setting.get({});
    if (!enabled) {
      if (current.levelOfControl === "controlled_by_this_extension") await setting.clear({});
      return;
    }
    if (current.levelOfControl === "controlled_by_other_extensions" || current.levelOfControl === "not_controllable") {
      throw new Error("Another extension or browser policy controls WebRTC protection.");
    }
    const value = "disable_non_proxied_udp";
    if (current.value !== value || current.levelOfControl !== "controlled_by_this_extension") {
      await setting.set({ value });
    }
  }

  private async report(status: PrivacyStatus): Promise<void> {
    this.status = status;
    await chrome.storage.local.set({ [STATUS_KEY]: status });
  }

  private async fail(error: unknown): Promise<void> {
    await this.report({ kind: "attention", message: errorMessage(error) });
  }
}

type PrivacyMessage = { feature: "privacy"; action: "get" | "retry" } |
  { feature: "privacy"; action: "save"; settings: unknown };

function isPrivacyMessage(value: unknown): value is PrivacyMessage {
  return typeof value === "object" && value !== null && "feature" in value && value.feature === "privacy" &&
    "action" in value && (value.action === "get" || value.action === "retry" ||
      value.action === "save" && "settings" in value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Privacy settings could not be applied.";
}
