# Privacy implementation

Upstream baseline: 47fb2cc655109a7e8b839a44c2a3e7f0df84cee1.

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

Privacy behavior is isolated in its own module and entrypoint. Only four
existing production files have small integration edits. Shared state handling,
the native Go helper and Firefox integration are unchanged.

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
- Disable/re-enable, worker blocking, exclusions, last-tab cookie cleanup,
  coordinate-free Egypt nodes, mismatched countries and disconnect restoration.

All browser runs use fresh headless profiles and task-owned resources. The
native helper is the upstream fixture; HTTP proxy, TLS and UDP sockets are real.
No test used a real tailnet, a signed-in browser profile or a production server.
Firefox browser testing was removed from scope at the operator's request.

## Remaining boundaries

No implementation work remains within the accepted scope. Special frames,
worker environments unless blocked, previous site state and unmodified hardware
surfaces remain outside full coverage; see README.md. Live tailnet behavior is
not claimed verified by these fixture-backed tests.

The operator authorized committing and pushing on 2026-10-04. The owned fork is
humazed/tailchrome; dantraynor/tailchrome remains upstream. Publish the custom
commit before recording its revision in Automation. Existing Chrome profiles,
including humazed, have not been modified or given this extension by this task.
