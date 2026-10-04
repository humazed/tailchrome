import { parseDomain, STATUS_KEY, type PrivacySettings } from "../../src/privacy/model";
import { privacyRequest, type Snapshot } from "../../src/privacy/ui";

const toggles = ["enabled", "timeZone", "location", "language", "webRTC", "reduceAgent", "fingerprint", "blockWorkers"] as const;
let snapshot: Snapshot | null = null;

function element<T extends HTMLElement>(id: string, kind: { new(): T }): T {
  const result = document.getElementById(id);
  if (!(result instanceof kind)) throw new Error("Missing settings field: " + id);
  return result;
}
const input = (id: string) => element(id, HTMLInputElement);
const button = (id: string) => element(id, HTMLButtonElement);
const feedback = element("feedback", HTMLParagraphElement);
const form = element("settings", HTMLFormElement);

function showStatus(value: Snapshot): void {
  const status = element("status-kind", HTMLSpanElement);
  status.textContent = value.status.kind === "ready" ? "Active" : value.status.kind === "attention" ? "Needs attention" : value.status.kind;
  status.closest("section")?.setAttribute("data-kind", value.status.kind);
  element("status-message", HTMLParagraphElement).textContent = value.status.message;
}

function render(value: Snapshot): void {
  snapshot = value;
  for (const key of toggles) input(key).checked = value.settings[key];
  input("cookies").checked = value.settings.cookies === "visited";
  element("excluded", HTMLTextAreaElement).value = value.settings.excludedDomains.join("\n");
  showStatus(value);
}

function settingsFromForm(): PrivacySettings {
  if (!snapshot) throw new Error("Settings have not loaded.");
  const settings = structuredClone(snapshot.settings);
  for (const key of toggles) settings[key] = input(key).checked;
  settings.cookies = input("cookies").checked ? "visited" : "off";
  settings.excludedDomains = element("excluded", HTMLTextAreaElement).value.split("\n").filter(value => value.trim()).map(parseDomain);
  return settings;
}

async function save(): Promise<void> {
  const settings = settingsFromForm();
  const response = await privacyRequest("save", settings);
  render(response);
  feedback.textContent = "Saved. Reload open pages if they cached the previous values.";
}

async function run(task: () => Promise<void>): Promise<void> {
  feedback.textContent = "";
  for (const control of form.querySelectorAll("button")) control.disabled = true;
  try { await task(); }
  catch (error) { feedback.textContent = error instanceof Error ? error.message : "Could not update privacy settings."; }
  finally { for (const control of form.querySelectorAll("button")) control.disabled = false; }
}

chrome.storage.onChanged.addListener((changes, area) => {
  const value: unknown = area === "local" ? changes[STATUS_KEY]?.newValue : undefined;
  if (snapshot && value && typeof value === "object" && "kind" in value && typeof value.kind === "string" &&
      "message" in value && typeof value.message === "string") {
    snapshot.status = { kind: value.kind, message: value.message };
    showStatus(snapshot);
  }
});
form.addEventListener("submit", event => { event.preventDefault(); void run(() => save()); });
button("permissions").addEventListener("click", () => { void run(async () => { render(await privacyRequest("retry")); }); });
void run(async () => { render(await privacyRequest("get")); });
