# Neura IDE Separate App Architecture

Neura IDE is a sibling app to Neura Desktop, not an embedded route inside the
Desktop renderer.

## Product Split

- Neura Desktop owns agent tasks, browser/computer automation, research, Canvas
  project creation, and the local bridge lifecycle.
- Neura IDE owns the coding workbench, extensions, terminal UX, Git UX, editor
  settings, and Composer commands inside the VSCodium-compatible workbench.
- Canvas remains the handoff surface. It opens the active project in Neura IDE
  and passes a short-lived bridge token for real project sync.

## Runtime Contract

Neura Desktop launches Neura IDE with:

- `NEURA_BRIDGE_URL`
- `NEURA_BRIDGE_TOKEN`
- `NEURA_PROJECT_ID`
- the Canvas project root as the workspace folder
- isolated `--user-data-dir` and `--extensions-dir`

Neura IDE must include the bundled `neura-agent` extension. The extension uses
the bridge to read Canvas project state, create Composer plans, apply file
edits, refresh disk state, and request approval-gated command execution.

AI coding also flows through this bridge. Neura IDE sends the user request and
project context to Neura Desktop; Desktop calls the configured NVIDIA NIM
planner/chat model using `plannerApiKey || vlmApiKey`, then returns plans or
full-file edits. Neura IDE never stores or receives the NIM API key.

## Distribution Rules

- Build Neura IDE from VSCodium/Code-OSS sources.
- Use Open VSX for extensions in v1.
- Do not wire Microsoft Visual Studio Marketplace endpoints.
- Ship Neura IDE as its own Windows app and updater.
- Neura Desktop discovers Neura IDE from the installed app path,
  `NEURA_IDE_EXECUTABLE`, or local development output under `apps/neura-ide`.

## Local Development

```powershell
npm run ide:verify
npm run ide:build:win32
npm run ide:install:dev:win32
npm --prefix apps/neura run dev
```
