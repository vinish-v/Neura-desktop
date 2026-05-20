# Neura Manus-Style Upgrade Progress

This document tracks the phased upgrade work. Runtime progress is persisted in
Neura settings under `neuraRoadmap` and shown in the Projects page.

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

Evidence values: `test`, `typecheck`, `build`, `manual`, `commit`, `tag`.

## Phase 1: Stabilize Core Task Flow

| ID   | Task                        | Status      | Done When                                                                             |
| ---- | --------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| P1.1 | Verify task isolation       | Done        | New task does not overwrite previous task history, messages, runtime, or final answer |
| P1.2 | Fix final answer rendering  | Done        | Long answers render as normal assistant messages and are scrollable                   |
| P1.3 | Hide diagnostics by default | Done        | Stack traces, DOM retry text, validator text, and planner internals are collapsed     |
| P1.4 | Add regression tests        | Done        | Task isolation and final-answer UI tests pass                                         |

## Phase 2: Browser Research Upgrade

| ID   | Task                                    | Status      | Done When                                                                                 |
| ---- | --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| P2.1 | Split quick browser vs research routing | Done        | YouTube/open-site uses quick path; latest/news/current/price/top tasks use research path  |
| P2.2 | Strengthen source selection             | Done        | Research visits 2-4 deduped credible source pages                                         |
| P2.3 | Improve extraction                      | Done        | Each source captures title, URL, source name, date if visible, excerpt, and readable body |
| P2.4 | Add answer validation                   | Done        | Shallow visible-results answers are rejected                                              |
| P2.5 | Add research tests                      | Done        | Research runner tests prove multi-source synthesis                                        |

## Phase 3: Local Computer Polish

| ID   | Task                              | Status      | Done When                                                    |
| ---- | --------------------------------- | ----------- | ------------------------------------------------------------ |
| P3.1 | Fix Desktop path reporting        | Done        | Output clearly says local Desktop or OneDrive Desktop        |
| P3.2 | Improve file/folder final answers | Done        | Local actions return concise, useful paths and outcomes      |
| P3.3 | Keep GUI only for visible apps    | Done        | File/folder/shell tasks use native tools, not desktop vision |
| P3.4 | Add native tool tests             | Done        | Shell, folder, file, and Desktop path tests pass             |

## Phase 4: Workspace And Artifacts

| ID   | Task                    | Status      | Done When                                                      |
| ---- | ----------------------- | ----------- | -------------------------------------------------------------- |
| P4.1 | Add artifact viewer     | Done        | Markdown/code/PDF/image artifacts can be opened inside Neura   |
| P4.2 | Add workspace explorer  | Done        | User can browse task artifacts and generated files             |
| P4.3 | Add reveal/open actions | Done        | Artifacts can be opened in system apps or revealed in Explorer |
| P4.4 | Add artifact tests      | Done        | Artifact creation and viewer metadata tests pass               |

## Phase 5: Unified Orchestrator

| ID   | Task                                    | Status      | Done When                                                                                |
| ---- | --------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| P5.1 | Define orchestration contract           | Done        | Browser, terminal, native tools, desktop GUI share one plan-act-observe-finish interface |
| P5.2 | Move quick browser behind contract      | Done        | Existing YouTube/open-site behavior still passes                                         |
| P5.3 | Move research behind contract           | Done        | Source-backed research still passes                                                      |
| P5.4 | Move shell/native tools behind contract | Done        | Shell and local file tasks still pass                                                    |
| P5.5 | Remove obsolete paths safely            | Done        | Old paths deleted only after equivalent tests pass                                       |

## Phase 6: Advanced Manus-Like Capabilities

| ID   | Task                                | Status      | Done When                                                      |
| ---- | ----------------------------------- | ----------- | -------------------------------------------------------------- |
| P6.1 | File-system memory                  | Done        | Each task/project has persistent working context               |
| P6.2 | Episodic retrieval                  | Done        | Past useful task records can inform new runs                   |
| P6.3 | Approval gates                      | Done        | Sensitive actions show clean approve/deny controls             |
| P6.4 | Optional scraper backend evaluation | Done        | Obscura is tested behind `SourceExtractor`, not added blindly  |
| P6.5 | Local-only affordability guardrail  | In Progress | Roadmap and product surfaces avoid requiring paid cloud sandbox infrastructure |

## Phase 7: Enterprise Manus Upgrade Slice

| ID   | Task                                      | Status      | Done When                                                                 |
| ---- | ----------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| P7.1 | Manus-style launcher actions              | Done        | Home exposes outcome buttons for slides, websites, apps, design, research, browser, and connectors |
| P7.2 | Semantic intent contract                  | Done        | Routing returns task type, tools, risk, artifacts, approval, and proof fields |
| P7.3 | Wide Research source quality proof        | Done        | Source records carry deterministic quality scores and completion proof summary |
| P7.4 | Artifact refinement and proof affordances | Done        | Run panel exposes proof, preview, export summary, and refine actions |
| P7.5 | Browser/computer recovery UX              | Done        | Runtime surfaces retry, resume, takeover, and persistent local browser session status |
| P7.6 | Deep claim-level validation               | Done        | Research claims are mapped to citation records, strong claims require independent support, and gaps become needs-verification |
| P7.7 | Honest evidence status                    | Done        | Runs expose verified, needs-verification, or blocked status from recorded sources, artifacts, browser, command, and connector evidence |
| P7.8 | Recovery evidence layer                   | Done        | Browser/computer failures are classified with next-action recovery evidence shown in the run trace |
| P7.9 | Browser restore and health snapshots      | Done        | Runs persist last URL/title/backend/profile/CDP health and restart local CDP when disconnected outside takeover |
| P7.10 | Artifact format validation               | Done        | DOCX/PPTX/XLSX/PDF/image/website/archive artifacts must exist, be non-empty, and pass expected format checks before proof |
| P7.11 | Honest connector setup gaps              | Done        | Connector writes require approval and unavailable Drive upload reports a real setup gap instead of fake success |
| P7.12 | Wide Research worker records             | Done        | Wide Research runs persist worker records, source attribution, visible citation dates, claim IDs, and failed-worker retry state |
| P7.13 | Scheduled task management                | Done        | Recurring tasks can be created, edited, paused, deleted, run now, and audited through persisted history |
| P7.14 | Desktop Projects                         | Done        | Projects persist master instructions, knowledge-file metadata, pin state, project runs, and project memory |
| P7.15 | Connector diagnostics and approval proof | Done        | Connector tests do not write externally, writes require approval proof, audit logs are visible, and MCP discovery reports real tool status |
| P7.16 | Office artifact previews                 | Done        | DOCX/PPTX/XLSX/ZIP previews extract real readable text or entry summaries without placeholder thumbnails |
| P7.17 | Local deep-link task intake              | Done        | `neura://task?goal=...` and `neura://run?goal=...` queue real background Hermes tasks and reject empty links |
| P7.18 | Local task API                           | Done        | Localhost-only bearer-token API queues real background Hermes tasks, exposes task/run status, and has Desktop controls without storing plaintext tokens |
| P7.19 | Wide Research worker preflight          | Done        | Each Wide Research worker now runs an independent Hermes/browser-grounded preflight with a dedicated local browser profile before final synthesis |
| P7.20 | Honest media capability gaps            | Done        | Video analysis no longer creates placeholder artifacts when no real video upload adapter exists; it reports the missing real adapter instead |
| P7.21 | Connector lifecycle audit               | Done        | Connector connect, settings update, OAuth start/complete, and local revoke actions now write audit-log entries, not only connector tool calls |
| P7.22 | Local API token integrity               | Done        | Local task API refuses to listen when settings lack a usable token hash and surfaces a regenerate-token setup gap instead of inventing an unknowable token |
| P7.23 | Local API port recovery                 | Done        | Local task API reports an unavailable port as a setup gap instead of throwing through Desktop startup |
| P7.24 | Model-assisted intent arbitration       | Done        | Optional planner-model arbitration can upgrade routing behind deterministic safety rules and reports setup gaps when no planner provider is configured |
| P7.25 | Office visual thumbnails                | Done        | DOCX/PPTX/XLSX previews render a first-page PNG when LibreOffice and Poppler are available, otherwise show an honest tooling gap |
| P7.26 | Provider revoke coverage                | Done        | Gmail OAuth tokens can be revoked through the real provider endpoint before local credentials are removed; unsupported connectors report the gap |
| P7.27 | Generated media export checks           | Done        | Generated image/audio/video artifacts are validated for existence, nonzero size, readable preview, and expected signatures before being registered |
| P7.28 | Task-type proof validators              | Done        | Research, browser, website, artifact, media, code, spreadsheet, and connector runs now require matching completion evidence before verified proof |
| P7.29 | Launcher routing regression coverage    | Done        | Launcher prompts are tested against semantic task types and proof expectations, including design artifact proof |
| P7.30 | Gmail mail task intake                  | Done        | Disabled-by-default Gmail intake reads explicit `[Neura Task]` unread subjects through the real read-only connector and queues background Hermes tasks |
| P7.31 | Checkpoint state digests                | Done        | Checkpoints persist compact phase, next-action, workspace, session, browser, evidence, artifact, and todo digests for resume continuity |
| P7.32 | Browser action audit and timing         | Done        | Browser runs record action URL/title before and after, durations, failure classes, phase timing budgets, slow-step diagnostics, and a local performance report artifact |
| P7.33 | Browser recovery class coverage         | Done        | Recovery classification covers stale DOM, selector miss, login/captcha/paywall blocks, permission denial, download failure, network timeout, and browser crash |
| P7.34 | Browser research proof regression       | Done        | Numeric/current research claims remain needs-verification until two independent medium-or-better source records support them |
| P7.35 | Gmail intake allowlist and audit        | Done        | Read-only Gmail intake supports sender allowlists, dedupe-safe skipped messages, last-run state, and visible audit events |
| P7.36 | Local task intake abuse hardening       | Done        | Local API and deep links reject empty/overlong goals, local API requires JSON bodies, and bearer tokens are compared in constant time |
| P7.37 | Browser session aging and restart bounds | Done       | Warm local browser sessions age out safely, profile locks trigger honest isolated-profile fallback, and CDP restart attempts are capped |
| P7.38 | Artifact kind/format validation         | Done        | Claimed image/audio/video/document kinds must match readable local file formats before artifact proof is accepted |
| P7.39 | Browser search fallback honesty         | Done        | Hermes browser tasks now prefer configured Google/Bing/Baidu search, keep DuckDuckGo opt-in only, switch source once on search-provider verification blocks, and surface Firefox as a real adapter gap instead of fake support |

## Phase Checkpoint

Before any phase is marked done:

- Run focused tests for changed modules.
- Run `npm run typecheck`.
- Run `npm run build`.
- Commit with a clear phase label.
- Tag stable milestones such as `v1-stable`, `v1-research-upgrade`, or `v1-orchestrator-alpha`.

Latest local proof:

- `npm.cmd --prefix apps/neura run test -- --run src/shared/browserAutomationRecovery.test.ts src/shared/taskEvidence.test.ts src/main/services/hermesBrowserBridge.test.ts src/main/services/taskRunRegistry.test.ts src/main/services/task-manager.test.ts` passed (5 files, 26 tests).
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/intentArbitration.test.ts src/main/services/task-manager.test.ts src/main/services/artifactThumbnail.test.ts src/main/ipcRoutes/window.test.ts src/main/services/connectors-service.test.ts src/main/services/artifactValidation.test.ts src/main/services/nativeComputerTools.test.ts src/main/services/taskRunRegistry.test.ts src/shared/taskEvidence.test.ts src/shared/intentClassification.test.ts src/shared/taskLauncherCatalog.test.ts src/main/services/mail-task-intake-service.test.ts` passed (12 files, 61 tests).
- `npm.cmd --prefix apps/neura run test -- --run src/shared/browserAutomationRecovery.test.ts src/main/services/hermesBrowserBridge.test.ts src/main/services/taskRunRegistry.test.ts src/main/services/artifactValidation.test.ts src/main/services/nativeComputerTools.test.ts` passed.
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/scheduled-task-service.test.ts src/main/services/desktop-projects-service.test.ts` passed.
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/connectors-service.test.ts src/main/services/mcp-service.test.ts` passed.
- `npm.cmd --prefix apps/neura run test -- --run src/main/ipcRoutes/window.test.ts` passed.
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/deep-link-task-service.test.ts` passed.
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/local-task-api-service.test.ts` passed.
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/mail-task-intake-service.test.ts src/main/services/scheduled-task-service.test.ts` passed (2 files, 8 tests).
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/local-task-api-service.test.ts src/main/services/deep-link-task-service.test.ts` passed (2 files, 11 tests).
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/hermesBrowserBridge.test.ts` passed (1 file, 4 tests).
- `npm.cmd --prefix apps/neura run test -- --run src/main/services/artifactValidation.test.ts` passed (1 file, 5 tests).
- `npm.cmd --prefix apps/neura run typecheck:node` passed.
- `npm.cmd --prefix apps/neura run typecheck:web` passed.
- `npm.cmd --prefix apps/neura run build:dist` passed.
- `npm.cmd --prefix apps/neura run package` passed and produced `apps/neura/out/Neura-win32-x64/Neura.exe`.
