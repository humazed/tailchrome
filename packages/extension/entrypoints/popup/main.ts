import "@tailchrome/shared/popup/popup";
import { addPrivacyLink } from "../../src/privacy/ui";

if (import.meta.env.BROWSER === "chrome") addPrivacyLink();
