export function privacyManifest(browser: string): {
  permissions: chrome.runtime.ManifestPermission[];
  options_ui?: { page: string; open_in_tab: boolean };
} {
  if (browser !== "chrome") return { permissions: [] };
  return {
    permissions: [
      "privacy", "scripting", "declarativeNetRequestWithHostAccess", "cookies", "tabs",
    ],
    options_ui: { page: "privacy.html", open_in_tab: true },
  };
}
