# Neura Agent Extension

This extension is bundled with Neura IDE and connects a VSCodium-compatible
workbench to Neura Canvas through the authenticated local bridge started by the
desktop app.

The extension requires `NEURA_BRIDGE_URL`, `NEURA_BRIDGE_TOKEN`, and
`NEURA_PROJECT_ID` in the workbench environment. It does not talk to the
Microsoft Visual Studio Marketplace and does not execute agent terminal
commands without explicit user approval.

AI coding requests are sent to Neura Desktop over the bridge. Neura Desktop owns
the NVIDIA NIM API key and calls the configured planner model from app settings;
the key is never copied into the IDE process.

The primary surface is the `Neura AI` secondary side bar view. It supports Ask,
Plan, Agent, and Builder modes, shows proposed edit batches before apply, records
approval-gated terminal cards, and exposes Canvas checkpoints for restore.
