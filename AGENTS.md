# Tailchrome privacy additions

This is a Git submodule of Automation. Keep the native helper and shared UI close
to upstream. Privacy code belongs in `packages/extension/src/privacy/`; settings
pages belong in their own extension entrypoint. Integrate through the proxy
manager interface, not changes throughout the connection state machine.

Use `pnpm` and the local lockfile. Read `docs/privacy/PLAN.md` for the current task
and `docs/privacy/README.md` for behavior and upstream updates. Never report page
protection as ready when script permissions, location data, or browser settings
are unavailable. Test actual browser values and request headers together.
