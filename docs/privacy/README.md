# Tailchrome Privacy: Egypt profile for Chrome

This is the tailchrome Git submodule inside Automation. It retains upstream
history from revision 47fb2cc655109a7e8b839a44c2a3e7f0df84cee1. The privacy
additions target Chrome; upstream Firefox integration is unchanged.

## Settings and profile

Open **Privacy & location** at the bottom of the Tailchrome Privacy popup. The bundled
profile applies while an exit node is connected and routing is healthy:

- Time zone: Africa/Cairo, using Chrome's date-specific daylight-saving rules.
- Language: Egyptian Arabic (ar-EG), in both page APIs and Accept-Language.
  Turn off Language & region to retain the browser's usual language.
- Location: approximate country coordinates 26.8206, 30.8025, with 600 km accuracy.
  This is not a claim about the city or exact position of the exit server.
- Nodes without country or coordinate metadata use Egypt, as requested by the
  operator. A node that explicitly reports another country triggers a visible
  warning and removal of the previous page/header overrides.

Chrome 122+ is required. The current browser verification uses Chrome 150.
All scripts are packaged with the extension and registered at document start.
There is no userScripts permission, no Allow user scripts toggle, no external
location lookup and no added runtime dependency. Developer mode is still needed
if loading an unpacked extension, as it is for any such Chrome extension.

## Behavior

- Dates: Date local getters, setters, construction, parsing and formatting agree
  with default Intl formatting. Modern Chrome's Temporal.Now and locale methods
  use the same defaults. Explicit time zones and absolute timestamps are kept.
- Browser identity: retain the actual browser family and operating system,
  reduce detailed versions and suppress matching high-entropy client hints.
- WebRTC: use Chrome's disable_non_proxied_udp policy. This is browser-wide and
  may affect calls on excluded sites. Disconnecting or turning protection off
  releases this extension's setting without clearing another extension's choice.
- Fingerprint readouts: small, repeatable changes to canvas, WebGL pixels and
  audio samples. A session seed survives background-worker restarts and differs
  by origin. Hardware descriptions, fonts and other fingerprint surfaces remain.
- Worker blocking: optionally block new Worker, SharedWorker and service-worker
  registrations. Off by default because it can break websites.
- Cookie cleanup: optionally remove cookies for visited sites when their last
  relevant tab closes. Off by default because it signs users out. Cookie stores,
  partitions, open tabs and exclusions are respected.
- Exclusions: literal IPs, internal names, Chrome's extension-store origins,
  Tailchrome routing exclusions and user exclusions retain native page values.
  Header rules also honor excluded request initiators, following Windscribe's
  allowlist behavior. WebRTC's browser-wide control is the exception.

## Windscribe review

Reviewed the current public MV3 repository at
[b851b5f3bafc4cb7407d115be77bdb98004432ad](https://github.com/Windscribe/browser-extension-mv3/tree/b851b5f3bafc4cb7407d115be77bdb98004432ad),
as well as its older extension source. Relevant implementation references:

- [Packaged scripts and document-start registration](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/src/utils/scriptController.ts)
- [Building bundled time-zone profiles](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/scripts/embedTimeZoneWarp.js)
- [Time-zone page methods](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/scripts/buildUtils/templates/timeZoneWarpContentScript.js)
- [Header rules and initiator exclusions](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/src/services/declarativeNetRequest/updateDynamicRules.ts)
- [WebRTC policy](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/src/services/privacy/network.ts)
- [Location callbacks](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/src/pages/content/locationWarp.ts)
- [Worker controls](https://github.com/Windscribe/browser-extension-mv3/blob/b851b5f3bafc4cb7407d115be77bdb98004432ad/src/pages/contentScripts/workerBlock.ts)

We adopted its packaged-profile architecture, MAIN-world document-start
injection, coordinated page/header changes, initiator exclusions and Chrome
WebRTC policy. The Egypt-only requirement makes the packaged approach practical
without an extra script permission. The code here is independently implemented;
Windscribe source was not copied. Tailchrome's existing license is unchanged.

Deliberate differences: preserve the actual browser family, use offsets for the
date being evaluated, preserve explicit formatting zones, cover Temporal, and
report application failures visibly. Windscribe's maturity was useful design
input; it is not a substitute for testing this implementation.

## Limits

- Active means the extension applied its scripts and request rules. It does not
  establish anonymity or guarantee that a website cannot detect an override.
- Existing pages can cache earlier values. Future reads are updated without
  reloading users' forms; reload a page to discard its own cached data. Discarded
  tabs receive the profile when loaded. If an existing document cannot be
  updated, new-page scripts and headers stay enabled and the settings page
  reports Needs attention with a reload warning for those older tabs.
- Startup and connection changes are asynchronous. Wait for Active before
  opening pages that need the Egypt profile. This is not a privacy kill switch.
- Internal browser pages, restricted sites and special frames such as about:blank
  are outside document-start coverage. Scripts in worker environments can read
  native values unless blocked. Existing service workers are not removed.
- Geolocation replacement does not change the browser's permission state. The
  approximate response is not GPS data or a live location lookup.
- Fingerprint protection covers the listed readouts, not every rendering API;
  for example OffscreenCanvas and GPU/hardware descriptions are not covered.
- Accounts, saved data, fonts, screen size and network characteristics can still
  identify a browser. This does not implement a Tor-style anonymity set.

## Keeping upstream merges small

Privacy modules live in packages/extension/src/privacy/. The options page is
its own packages/extension/entrypoints/privacy/ entrypoint. Shared connection
code and the Go helper are unchanged. Privacy behavior connects through four
existing production files:

1. entrypoints/background.ts starts the Chrome privacy controller.
2. src/background/chrome.ts observes the existing proxy manager's applied state.
3. entrypoints/popup/main.ts adds the Chrome settings link.
4. wxt.config.ts adds the Chrome manifest fields and privacy build hook.

The Chrome manifest also names the extension Tailchrome Privacy. Popup labels,
setup messages and page titles read that name from the manifest. These small
branding edits touch the shared popup header and setup views, plus the popup
loading text. Firefox retains its upstream name. The extension ID, native-host
identifiers and Tailchrome Helper app name stay unchanged.

The build hook emits the Egypt profile, feature switches, session-seed bit
setters and the page runtime into WXT's output directory. It never rewrites
maintained source. Selecting packaged seed files preserves a session seed
without runtime code generation. Generated output is ignored and regenerable.

The upstream browser-test network fixture has one optional response callback
so privacy tests can reuse its real TLS origin and proxy.

The origin remote points to [humazed/tailchrome](https://github.com/humazed/tailchrome).
The upstream remote retains [dantraynor/tailchrome](https://github.com/dantraynor/tailchrome).
Automation's submodule URL uses the owned fork. Publish the submodule commit
before updating Automation's pointer to it. Commit and push only on operator
request.

After the custom changes have been committed, update inside this submodule:

    git fetch upstream --prune --no-tags
    git log --oneline HEAD..upstream/main
    git merge --no-commit --no-ff upstream/main
    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm test
    pnpm build:chrome
    node scripts/e2e/privacy.mjs
    node scripts/e2e/chrome-proxy-auth.mjs

Resolve conflicts at the four integration points and preserve the manifest-based
labels; keep privacy behavior in its module. After approved commits/pushes,
Automation records the submodule commit.
Normal Git ancestry supports upstream merges without a patch-replay workflow.

## Verification

Run the checks above from the submodule directory. The browser tests use the
built extension, fresh headless Chrome profiles, the upstream native-helper
fixture, a real local TLS origin/proxy and a local UDP STUN server. They do not
use the operator's browser profiles or a real tailnet.

They check first-inline-script values, headers/client hints, coordinates,
Date/Intl/Temporal, Egypt's DST gaps/folds, ordinary frames, stable graphics/audio
output, live settings changes, WebRTC network traffic with a positive control,
worker blocking, cookie cleanup, exclusions, country mismatches and disconnect
restoration. The upstream proxy-authentication test covers another extension's
HTTPS requests and native-helper restarts.

The installed humazed Chrome profile was also tested through the operator's
existing Tailscale account and actual Egypt exit node. That live run caught and
verified the fix for existing-tab update failures. Current results and the
installation paths are recorded in [PLAN.md](PLAN.md). Raw screenshots and live
test captures are ignored, local files under evidence/.
