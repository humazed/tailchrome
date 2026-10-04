import { startChromeBackground } from "../src/background/chrome";
import { startFirefoxBackground } from "../src/background/firefox";
import { startPrivacy } from "../src/privacy/integration";

export default defineBackground({
  type: "module",
  main() {
    if (import.meta.env.BROWSER === "chrome") startPrivacy();
    if (import.meta.env.BROWSER === "firefox") {
      startFirefoxBackground();
      return;
    }

    startChromeBackground();
  },
});
