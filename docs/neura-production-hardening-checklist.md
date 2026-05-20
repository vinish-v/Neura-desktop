# Neura Production Hardening Checklist

Use this checklist before trusting Neura with long, complex work.

## Automated Gates

- Run `npm.cmd --prefix apps/neura run typecheck:node`.
- Run `npm.cmd --prefix apps/neura run typecheck:web`.
- Run `npm.cmd --prefix apps/neura test -- --run src/main/services/productionReadiness.test.ts src/main/services/task-manager.test.ts src/main/services/hermesBrowserBridge.test.ts src/main/services/nativeComputerTools.test.ts`.
- Run `npm.cmd --prefix apps/neura run qa:installed` after packaging/installing.

## Manual Installed-App QA

1. Launch the installed `Neura.exe`, not the dev build.
2. Start a browser research task that produces a saved report with citations.
3. Confirm Neura Computer shows live frames, cursor, clicks, typing, takeover, and resume.
4. Start a local desktop/file task and confirm artifacts plus completion proof.
5. Trigger a disabled connector or missing media provider and confirm Neura reports the setup gap.
6. Pause or interrupt a long run, then use Resume and confirm checkpoint continuity.
7. Confirm final completion is blocked unless evidence, artifacts, commands, or connector actions prove the result.

Neura should not mark a task complete when a provider, connector, browser, OS permission, artifact, or evidence requirement is missing.
