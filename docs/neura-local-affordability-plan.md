# Neura Local-Only Affordability Plan

## Decision

Neura will not require a paid cloud sandbox, hosted VM, RDP instance, or
microVM to reach Manus-style usefulness.

The product direction is local-first:

- local embedded browser
- local desktop automation
- local terminal and native tools
- local task workspaces and artifacts
- user-configured MCP servers and connectors
- optional remote integrations only when the user provides them

## Why

Cloud sandboxes add recurring infrastructure cost, operational complexity, and
failure modes before Neura has fully stabilized the local agent loop. For this
project, affordability is a product constraint, not a later optimization.

## Implementation Guardrails

- Do not add a required cloud worker dependency.
- Do not mark a feature as blocked on paid remote compute.
- Keep browser, terminal, files, artifacts, memory, skills, connectors, and
  approvals working locally first.
- Treat remote providers as optional adapters, never the default execution
  path.
- Preserve existing remote/free-trial code only as legacy or optional behavior;
  new core features should not depend on it.

## Replacement For Sandbox Work

The former sandbox/VM track is replaced by local hardening:

1. Improve local browser reliability and takeover.
2. Make command execution safer with approvals and clear output.
3. Keep generated files inside visible local workspaces.
4. Add better cancel/retry/resume for long tasks.
5. Use MCP and connectors for user-owned integrations instead of rented
   compute.

## Acceptance

P6.5 is complete only when the roadmap, UI copy, and new implementation work
make it clear that Neura can be useful without paid cloud sandbox
infrastructure.
