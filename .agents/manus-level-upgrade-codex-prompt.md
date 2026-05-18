You are Codex GPT-5.5 working inside the Neura Main Desktop repository at D:/new-neura/neura-main-desktop.

USER GOAL:
Bring Neura Main Desktop significantly closer to Manus AI quality. Do NOT inspect or modify Neura IDE. Focus only on the desktop app and shared packages needed by it.

IMPORTANT SAFETY / SCOPE:
- Preserve existing uncommitted user work; do not reset, delete, or discard changes.
- Do not touch apps/neura-ide or IDE-specific workspaces.
- Keep the product local-first; cloud/hosted providers may be optional adapters only.
- Do not introduce secrets, hardcoded API keys, or required paid cloud dependencies.
- Prefer incremental, tested, enterprise-grade work over superficial UI-only changes.
- If the whole goal is too large for one run, implement a coherent vertical slice and leave a detailed enterprise roadmap and checklist for remaining work.

CURRENT GAP ANALYSIS TO ADDRESS:
1. Productized browser/computer reliability: hosted-like readiness, better local session persistence, browser recovery, clearer takeover/retry/failure states.
2. Finished-work polish: stronger artifacts for slides, docs, spreadsheets, websites; previews, refinement flow, templates, export quality.
3. Wide Research depth: browser-grounded retrieval, source-quality scoring, citation records, multi-source validation; roadmap currently says this is remaining Phase 8 gap.
4. Connector ecosystem: GitHub/Slack/MCP/Drive placeholders should become more productized, with clean enablement, status, testing, and permission flows.
5. Consumer UX/onboarding: simple Manus-like launcher buttons: Create slides, Build website, Develop app, Design, Wide Research, Browser Operator, Connectors/Automations. Hide internals.
6. Multimodal creation: productized image/TTS/STT/video/music/design flows where feasible; no fake claims if provider missing.
7. Agent autonomy feel: reduce brittle keyword routing, improve semantic intent contract, plan-act-observe-validate loop, completion proof, retry/resume, progress UX.

IMPLEMENTATION EXPECTATIONS:
- Start by inspecting existing docs and code: docs/neura-manus-parity-roadmap.md, docs/neura-progress-roadmap.md, apps/neura/src/main/services/*, apps/neura/src/renderer/src/pages/*, apps/neura/src/main/shared/toolRegistry.ts.
- Create/update a durable roadmap doc for the enterprise Manus-level push, ideally docs/neura-enterprise-manus-upgrade-plan.md, with explicit acceptance criteria.
- Implement the highest-leverage vertical slices first:
  A) Manus-style task launcher / onboarding surface in Home or Dashboard.
  B) Richer intent catalog/semantic routing contract beyond only keyword matching.
  C) Wide Research source quality scoring + validation proof metadata.
  D) Artifact refinement/preview affordances in Projects/Run panel.
  E) Browser/computer reliability status/recovery UX.
- Add or update TypeScript tests where practical.
- Run focused tests/typecheck/build commands that are available in package.json. At minimum run relevant tests and typecheck if feasible.
- Commit logical chunks if tests pass. If committing is blocked by pre-existing changes, leave a clear summary and do not force.

QUALITY BAR:
Enterprise-grade, not hacky. Clear types, minimal duplication, predictable UI, accessible copy, local-first, no fake completion. It is acceptable to be honest in docs that full Manus parity is an ongoing program, but implement real improvements now.

FINAL OUTPUT REQUIRED:
When finished, report:
- What was implemented.
- Files changed.
- Tests/typechecks run and results.
- Remaining gaps to true Manus parity.
- Whether it is honest to call the current build Manus-level yet.
