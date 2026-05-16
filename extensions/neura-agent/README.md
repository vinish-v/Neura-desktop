# Neura Agent Extension

This extension is bundled with Neura IDE and turns the VSCodium workbench into
an independent AI coding environment. It is optimized for real project files,
real terminal output, reviewable diffs, policy-gated tool use, and durable proof
artifacts.

## Core Surfaces

- `Neura AI` secondary side bar for Ask, Plan, Edit, and production-ready Build workflows.
- Mission Control for background agents, swarm missions, role status, merge
  review, logs, follow-ups, and artifacts.
- Editor-native review commands and CodeLens actions for pending Neura edits.
- Proof bundles under `.neura/proof-bundles` with JSON, Markdown, and HTML run
  reports.
- Production shipping profile detection is part of every Build run: framework,
  package manager, build output, deploy targets, CI, readiness gaps, and
  approval-gated verification/preview/deploy commands.

## AI Backends

Neura IDE uses an OpenAI-compatible provider chain for all Composer, agent,
planner, and background-agent chat calls. The default order is OpenRouter,
Ollama, then NVIDIA NIM.

- OpenRouter: `neura.openrouter.*`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.
- Ollama Cloud or local: `neura.ollama.*`, `OLLAMA_API_KEY`,
  `OLLAMA_CLOUD_API_KEY`, `OLLAMA_MODEL`. `https://ollama.com` uses native
  `/api/chat`; `http://localhost:11434/v1` uses OpenAI-compatible chat.
- NVIDIA NIM: `neura.nim.*`, `NVIDIA_NIM_API_KEY`, `NVIDIA_API_KEY`.

Set `neura.provider.order` to change fallback order. Secrets are redacted from
UI surfaces, artifacts, logs, and policy audit entries.

## Safety Model

Sensitive actions flow through `permissionEngine.js`:

- `command` policies for terminal commands.
- `file_read` and `file_write` workspace-boundary checks.
- `browser_url` and `read_url` domain allowlists.
- `mcp` policies for server/tool resources.
- `plugin` trust decisions and capability metadata.

Global permission modes still control default automation level, but explicit
policy rules in `neura.permissions.rules` can allow, deny, or ask for specific
resources.

## MCP And Plugins

MCP servers are configured with `neura.mcp.servers`. Server definitions support
`${workspaceFolder}` and `${env:NAME}` interpolation, disabled tool lists, and
capability metadata. MCP tool execution uses approval cards and audit logs.

Plugins live in `~/.neura/plugins`, require a `neura-plugin.json` manifest, and
stay disabled until explicitly trusted. Trusted plugins receive a restricted API
surface instead of direct access to the full Neura internals.

## Agent Execution

Background agents run in local git worktrees for v1 isolation. Each agent stores
its branch, base revision, environment snapshot, run log, verification output,
follow-ups, and merge-review proposal metadata. Swarm missions coordinate role
agents without letting them overwrite each other’s ownership lanes.

## Verification

Run the extension/product checks from the repo root:

```powershell
npm run ide:verify
```

That command verifies Open VSX product metadata plus Neura agent policy,
artifact-report, and manifest invariants.
