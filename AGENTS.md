# Tailchrome privacy additions

This is a Git submodule of Automation. Keep the native helper and shared UI close
to upstream. Privacy code belongs in `packages/extension/src/privacy/`; settings
pages belong in their own extension entrypoint. Integrate through the proxy
manager interface, not changes throughout the connection state machine.

The Chrome display name is Tailchrome Privacy. Read the manifest name for
extension labels and page titles. Keep the extension ID, native-host identifiers
and the upstream Tailchrome Helper app name unchanged when updating branding.

Chrome on the operator's Mac loads the unpacked build straight from
`packages/extension/.output/chrome-mv3`, so any Chrome build replaces the
installed extension. Read "Installation on the operator's Mac" in
`docs/privacy/README.md` before building or changing the helper.

Use `pnpm` and the local lockfile. Read `docs/privacy/PLAN.md` for the current task
and `docs/privacy/README.md` for behavior and upstream updates. Never report page
protection as ready when script permissions, location data, or browser settings
are unavailable. Test actual browser values and request headers together.
