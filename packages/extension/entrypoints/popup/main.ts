import "@tailchrome/shared/popup/popup";
import { addPrivacyLink } from "../../src/privacy/ui";

document.title = chrome.runtime.getManifest().name;
if (import.meta.env.BROWSER === "chrome") addPrivacyLink();
