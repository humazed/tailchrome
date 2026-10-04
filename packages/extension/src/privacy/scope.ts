import type { Scope } from "./model";

// Keep this function self-contained: the same source runs in the page's world.
export function matchesScope(hostname: string, scope: Scope): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  const matches = (domain: string) => host === domain || host.endsWith("." + domain);
  if (scope.excluded.some(matches)) return false;
  const listed = scope.split.domains.some(matches);
  return scope.split.mode === "only" ? listed : !listed;
}
