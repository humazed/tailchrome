import type { ProxyManager } from "@tailchrome/shared/types";
import { PrivacyController } from "./controller";

let controller: PrivacyController | null = null;

export function startPrivacy(): void {
  controller ??= new PrivacyController();
}

export function withPrivacy<T extends ProxyManager>(manager: T): T {
  const apply = manager.apply;
  manager.apply = state => {
    apply.call(manager, state);
    controller?.observe(state);
  };
  return manager;
}
