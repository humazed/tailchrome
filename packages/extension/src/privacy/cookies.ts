import { matchesScope } from "./scope";
import type { Scope } from "./model";

const TAB_KEY = "privacy.cookieTabs.v1";
type Visit = { host: string; storeId: string };

export class CookieCleaner {
  constructor(
    private readonly scope: () => Scope | null,
    private readonly report: (error: unknown) => void,
  ) {
    chrome.tabs.onUpdated.addListener((id, change, tab) => {
      if (change.url || change.status === "complete") {
        this.enqueue(() => this.remember(id, tab.url)).catch(report);
      }
    });
    chrome.tabs.onRemoved.addListener(id => {
      this.enqueue(() => this.remove(id)).catch(report);
    });
  }

  private chain = Promise.resolve();

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task);
    this.chain = next.catch(() => {});
    return next;
  }

  private async read(): Promise<Record<string, Visit[]>> {
    const stored: unknown = (await chrome.storage.session.get(TAB_KEY))[TAB_KEY];
    if (stored === undefined) return {};
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("Invalid cookie-cleanup state.");
    const result: Record<string, Visit[]> = {};
    for (const [id, visits] of Object.entries(stored)) {
      if (!Array.isArray(visits)) throw new Error("Invalid cookie-cleanup visits.");
      result[id] = visits.map((visit: unknown) => {
        if (!visit || typeof visit !== "object" || !("host" in visit) || typeof visit.host !== "string" ||
            !("storeId" in visit) || typeof visit.storeId !== "string") throw new Error("Invalid cookie-cleanup visit.");
        return { host: visit.host, storeId: visit.storeId };
      });
    }
    return result;
  }

  private async remember(id: number, url?: string): Promise<void> {
    const scope = this.scope();
    if (!scope || !url || !/^https?:/.test(url)) return;
    const host = new URL(url).hostname;
    if (!matchesScope(host, scope)) return;
    const store = (await chrome.cookies.getAllCookieStores()).find(item => item.tabIds.includes(id));
    if (!store) throw new Error("Cannot determine the cookie store for this tab.");
    const visits = await this.read();
    const current = visits[id] ?? [];
    if (!current.some(visit => visit.host === host && visit.storeId === store.id)) {
      visits[id] = [...current, { host, storeId: store.id }];
      await chrome.storage.session.set({ [TAB_KEY]: visits });
    }
  }

  private async remove(id: number): Promise<void> {
    const visits = await this.read();
    const closed = visits[id] ?? [];
    delete visits[id];
    await chrome.storage.session.set({ [TAB_KEY]: visits });
    const scope = this.scope();
    if (!scope || !closed.length) return;
    const stores = await chrome.cookies.getAllCookieStores();
    const tabs = await chrome.tabs.query({});
    for (const visit of closed) {
      if (!matchesScope(visit.host, scope)) continue;
      const cookies = await chrome.cookies.getAll({ storeId: visit.storeId });
      for (const cookie of cookies) {
        const domain = cookie.domain.replace(/^\./, "");
        const matching = (host: string) => cookie.hostOnly ? host === domain : host === domain || host.endsWith("." + domain);
        if (!matching(visit.host)) continue;
        if (cookie.partitionKey?.topLevelSite && !matching(new URL(cookie.partitionKey.topLevelSite).hostname)) continue;
        const stillOpen = tabs.some(tab => tab.id !== undefined && tab.url &&
          stores.find(store => store.id === visit.storeId)?.tabIds.includes(tab.id) &&
          /^https?:/.test(tab.url) && matching(new URL(tab.url).hostname));
        if (stillOpen) continue;
        await chrome.cookies.remove({
          url: (cookie.secure ? "https://" : "http://") + domain + cookie.path,
          name: cookie.name, storeId: cookie.storeId,
          ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
        });
      }
    }
  }
}
