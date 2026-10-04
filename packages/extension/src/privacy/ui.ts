import { parseSettings, STATUS_KEY, type PrivacySettings } from "./model";

export interface Snapshot {
  settings: PrivacySettings;
  status: { kind: string; message: string };
  currentNodeId: string | null;
}

export async function privacyRequest(action: "get" | "retry" | "save", settings?: PrivacySettings): Promise<Snapshot> {
  const response: unknown = await chrome.runtime.sendMessage({ feature: "privacy", action, settings });
  if (!response || typeof response !== "object" || !("ok" in response)) throw new Error("The extension did not respond.");
  if (response.ok !== true) {
    throw new Error("error" in response && typeof response.error === "string" ? response.error : "Could not save privacy settings.");
  }
  if (!("settings" in response) || !("status" in response) || !("currentNodeId" in response) ||
      response.currentNodeId !== null && typeof response.currentNodeId !== "string") throw new Error("Invalid privacy response.");
  const status = response.status;
  if (!status || typeof status !== "object" || !("kind" in status) || typeof status.kind !== "string" ||
      !("message" in status) || typeof status.message !== "string") throw new Error("Invalid privacy status.");
  return { settings: parseSettings(response.settings), status: { kind: status.kind, message: status.message },
    currentNodeId: response.currentNodeId };
}

export function addPrivacyLink(): void {
  const footer = document.createElement("div");
  footer.style.cssText = "border-top:1px solid var(--border-color,#ddd);padding:10px 16px;font:12px system-ui;display:flex;align-items:center;gap:10px";
  const button = document.createElement("button");
  button.textContent = "Privacy & location";
  button.style.cssText = "background:none;border:0;color:var(--accent,#16834b);cursor:pointer;font:inherit;padding:2px";
  button.addEventListener("click", () => { void chrome.runtime.openOptionsPage(); });
  const status = document.createElement("span");
  status.style.cssText = "margin-left:auto;color:var(--text-secondary,#666)";
  footer.append(button, status);
  document.body.append(footer);
  const show = (value: Snapshot["status"]) => {
    status.textContent = value.kind === "ready" ? "Active" : value.kind === "attention" ? "Needs attention" : "Inactive";
    status.title = value.message;
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    const value: unknown = area === "local" ? changes[STATUS_KEY]?.newValue : undefined;
    if (value && typeof value === "object" && "kind" in value && typeof value.kind === "string" &&
        "message" in value && typeof value.message === "string") show({ kind: value.kind, message: value.message });
  });
  void privacyRequest("get").then(snapshot => {
    show(snapshot.status);
  }, () => { status.textContent = "Unavailable"; });
}
