# Privacy implementation

Upstream baseline: 13c87cb7fdf028a0d5eb6fc261ad05e4229ea741 (v0.1.15), merged on
2026-10-26. The original implementation started from 47fb2cc655109a7e8b839a44c2a3e7f0df84cee1.

## Accepted scope

- Add tailchrome as an Automation Git submodule, preserving upstream history.
- Implement and test Chrome only.
- Bundle Egypt, following Windscribe's packaged-profile approach: Africa/Cairo,
  ar-EG and clearly approximate country coordinates. No user-script toggle.
- Coordinate page values, request headers and WebRTC protection. Add optional
  worker blocking and cookie cleanup, plus graphics/audio readout protection.
- Keep upstream integration small and document ordinary Git merges.

## Progress

- [x] Register tailchrome/ as an Automation submodule.
- [x] Inspect Tailchrome's proxy-state interfaces and Windscribe's current MV3 code.
- [x] Implement privacy modules and a separate Chrome settings page.
- [x] Verify types, automated tests, build and actual browser/network behavior.
- [x] Inspect the rendered settings page.
- [x] Document implementation boundaries, limitations and upstream maintenance.
- [x] Install in humazed Chrome and test through the existing account's real Egypt exit node.

## Observed and changed

Windscribe's public MV3 revision b851b5f3bafc4cb7407d115be77bdb98004432ad
packages location scripts and selects them through registerContentScripts. The
operator's Egypt-only scope allows the same architecture here. Packaged scripts
run in MAIN at document_start; settings choose feature files and session-seed
bit files. No additional dependencies or remote code are needed.

The profile uses Chrome's date-specific Cairo rules, not a fixed UTC offset.
Temporal is covered as well as Date and Intl. Header rules cover main-document
requests and honor excluded initiators. Country mismatches clear stale overrides
and report attention. Disconnect releases page/header and WebRTC settings.

Privacy behavior is isolated in its own module and entrypoint, with four
existing production files connecting it to the extension. Separate branding
edits make popup labels and setup messages read the manifest name. Shared state
handling, the native Go helper and Firefox integration are unchanged.

## Verification: 2026-10-04

Completed successfully on the final implementation:

- pnpm typecheck: shared and extension TypeScript checks pass.
- pnpm test: 622 shared tests, 111 extension tests, 7 browser-fixture utility
  tests and 11 dependency tests pass; total 751, zero failures.
- pnpm build:chrome: built the actual unpacked Chrome extension and bundled assets.
- node scripts/e2e/privacy.mjs: passed in Chrome for Testing 150.0.7871.24.
- node scripts/e2e/chrome-proxy-auth.mjs: passed HTTPS authentication from a second
  extension before browsing and after a native-helper restart.
- git diff --check: clean for changed tracked source and submodule metadata.
- Settings screenshot inspected directly: readable layout, visible switches and
  save/status feedback, with the approximate Egypt location explained.

The privacy browser run verifies:

- First-inline-script timezone, language and user agent; matching HTTP headers;
  high-entropy client-hint suppression on requests and navigator APIs.
- Egypt coordinates and stated accuracy; winter/summer offsets; local Date
  construction, parsing, setters, DST gaps/folds and explicit-zone preservation.
- Modern Temporal defaults, explicit zones and instant formatting.
- Canvas and WebGL readouts are changed and stable; audio samples are changed
  and agree with copied samples. Same-origin documents share the session seed.
- Ordinary iframe scripts see the profile at document start.
- An actual RTCPeerConnection reaches a local UDP STUN server in the unprotected
  positive control, then sends no direct UDP when WebRTC protection is enabled.
- The actual settings form switches page and request language together.
- Disable/re-enable, worker blocking, last-tab cookie cleanup,
  coordinate-free Egypt nodes, mismatched countries and disconnect restoration.

The automated browser runs use fresh headless profiles and task-owned resources. The
native helper is the upstream fixture; HTTP proxy, TLS and UDP sockets are real.
Firefox browser testing was removed from scope at the operator's request.

## Installation and live verification: 2026-10-04

Installed and enabled the unpacked Chrome build in the operator-authorized
humazed profile, retaining the existing extension ID and Tailscale account.
The previous Web Store extension was disabled. Its native helper was v0.1.11,
which does not support v0.1.14's proxy authentication. Verified the official
v0.1.14 helper ZIP checksum, code signature and Apple notarization, installed
the app under ~/Applications/Tailchrome Helper.app, and registered its binary
for Chrome only. No Tailscale identity or browser storage was deleted.

Connected the existing account and selected its available exit node. In the
actual Chrome 154 profile, verified:

- Cloudflare's trace endpoint reports country EG for the browser's public IP.
- Date, Intl and Temporal report Africa/Cairo; January is UTC+2 and July UTC+3.
- navigator.language is ar-EG; httpbin receives the same Accept-Language and
  the same reduced User-Agent exposed to the page.
- Geolocation returns the bundled Egypt coordinates with 600 km accuracy.
- High-entropy version values are empty.
- Canvas, WebGL and audio readouts are changed and stable across repeated reads.
- A real RTCPeerConnection using a public STUN server completes ICE gathering
  with zero address candidates. The headless test separately checks actual UDP
  traffic against a working local STUN positive control.

Live testing found that an existing-tab injection failure rolled back scripts
and headers for every new tab. The controller now skips discarded tabs and
returns an explicit partial-update result for other document failures. New-page
protection stays installed; the settings page reports which scope is protected
and that older pages need reloading. Genuine registration/rule failures still
clear stale overrides. A browser regression reproduces a rejected existing-tab
injection, verifies first-script values and real request headers on a fresh
page, and verifies recovery on retry.

After the fix: typecheck, all 111 extension tests, the Chrome build, the complete
privacy browser test and the live checks above passed. The local live test
report is evidence/humazed-live-privacy.json. Existing user tabs were not
reloaded; Chrome reports 160 older tabs whose values could not be updated.
Newly loaded test pages pass all checks. The ordinary extension Reload action
stalled after rebuilding; loading the same output folder through Load unpacked
recovered it with the saved account and selected exit node intact.

## Chrome display name: 2026-10-04

Renamed the Chrome extension to Tailchrome Privacy in the manifest, popup,
setup messages and privacy settings. Labels and page titles read the manifest
name. Firefox keeps Tailchrome, and the extension ID and native-host identifiers
are unchanged.

Typecheck, all 751 tests, the Chrome build and all ten privacy browser checks
passed. Updated the installed humazed copy through Load unpacked using the same
output directory. Chrome's extension details and popup both show Tailchrome
Privacy. The saved account and Egypt exit node remained intact; reconnected
after the update and verified that the popup showed the selected exit node
without a routing-blocked message. The existing-tab Needs attention warning
remains, as expected from the live checks above.

The extension is left enabled and connected to Egypt. After live verification,
the operator authorized committing and pushing the installation fix, rename and
verification records, followed by Automation's submodule reference.

## Helper cleanup: 2026-10-25

The Mac held three helper copies, and only the per-user app was registered for
Chrome. Removed the other two and their registrations, following upstream's
one-method-per-account rule:

- The v0.1.11 system package: `/Applications/Tailchrome Helper.app`,
  `/Library/Application Support/Tailscale/BrowserExt/` and its package receipt.
- Its legacy runtime copy, v0.1.13 with a `.before-0.1.13` backup, in
  `~/Library/Application Support/Tailscale/BrowserExt/`, plus the Brave,
  Chromium, Edge and Firefox registrations that pointed to it.

Chrome's registration and the node state in `~/.config/tailscale-browser-ext/`
were not touched. The remaining helper reports v0.1.14, and its signature and
Gatekeeper checks pass. Installation and helper updates are described in
README.md.

## Upstream v0.1.15 update: 2026-10-26

Merged upstream/main at 13c87cb (the v0.1.15 release plus upstream documentation
and Homebrew updates) with no conflicts; none of the four integration points or
the branding files changed upstream. Upstream's changes add IPv6 subnet routing,
popup device and profile controls, and Chrome proxy-authentication fixes.

Checks on the merged tree:

- pnpm install --frozen-lockfile and pnpm typecheck pass.
- pnpm test: 775 shared, 128 extension, 7 browser-fixture utility and 11
  dependency tests pass; total 921, zero failures.
- pnpm build:chrome builds Tailchrome Privacy 0.1.15.
- node scripts/e2e/privacy.mjs: all ten privacy checks pass in Chrome for
  Testing 150.0.7871.24, after reinstalling that browser into
  `~/.cache/puppeteer`, which was missing.
- node scripts/e2e/chrome-proxy-auth.mjs passes.
- The generated settings screenshot was inspected directly and renders correctly.

Helper: the official v0.1.15 `tailchrome-helper-macos-user.zip` matched the
release's SHA256SUMS.txt, is signed by the same Developer ID team (UL9B796XFN)
as v0.1.14, is notarized with a valid stapled ticket and passes Gatekeeper.
It replaced `~/Applications/Tailchrome Helper.app`, and
`install --binary-path` registered it for Chrome, Chrome Beta, Canary and Dev,
Chromium, Brave, Vivaldi, Opera and Firefox, all of which already had settings
folders. Every registration points to the one helper. Node state was not touched.

Chrome: the extension was off in the Humazed profile (labelled Ibrahim in
Chrome). Turning it on still showed 0.1.14; the Reload button stalled on
"Reloading…"; Load unpacked on the same output folder loaded 0.1.15 with no
errors. The extension started the v0.1.15 helper from `~/Applications`, and its
popup showed the normal "Tailscale is not connected" view with no helper or
version warning. The extension was turned off again, as found. It was not
connected to the tailnet, so routing through the exit node was not rechecked
live this time.

## Remaining boundaries

The upstream merge is staged in the submodule but not committed.

No implementation work remains within the accepted scope. Special frames,
worker environments unless blocked, previous site state and unmodified hardware
surfaces remain outside full coverage; see README.md. The live checks verify
the selected Egypt exit node and newly loaded pages; they do not establish
coverage of every existing tab or every website.

The operator authorized committing and pushing on 2026-10-04. The owned fork is
humazed/tailchrome; dantraynor/tailchrome remains upstream. Publish the custom
commit before recording its revision in Automation. The initial implementation
and submodule pointer were committed and pushed before the installation work.
