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

## Phase Checkpoint

Before any phase is marked done:

- Run focused tests for changed modules.
- Run `npm run typecheck`.
- Run `npm run build`.
- Commit with a clear phase label.
- Tag stable milestones such as `v1-stable`, `v1-research-upgrade`, or `v1-orchestrator-alpha`.
