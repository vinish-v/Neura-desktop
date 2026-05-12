# Neura Manus-Style Upgrade Progress

This document tracks the phased upgrade work. Runtime progress is persisted in
Neura settings under `neuraRoadmap` and shown in the Projects page.

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

Evidence values: `test`, `typecheck`, `build`, `manual`, `commit`, `tag`.

## Phase 1: Stabilize Core Task Flow

| ID   | Task                        | Status      | Done When                                                                             |
| ---- | --------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| P1.1 | Verify task isolation       | Not Started | New task does not overwrite previous task history, messages, runtime, or final answer |
| P1.2 | Fix final answer rendering  | Not Started | Long answers render as normal assistant messages and are scrollable                   |
| P1.3 | Hide diagnostics by default | Not Started | Stack traces, DOM retry text, validator text, and planner internals are collapsed     |
| P1.4 | Add regression tests        | Not Started | Task isolation and final-answer UI tests pass                                         |

## Phase 2: Browser Research Upgrade

| ID   | Task                                    | Status      | Done When                                                                                 |
| ---- | --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| P2.1 | Split quick browser vs research routing | Not Started | YouTube/open-site uses quick path; latest/news/current/price/top tasks use research path  |
| P2.2 | Strengthen source selection             | Not Started | Research visits 2-4 deduped credible source pages                                         |
| P2.3 | Improve extraction                      | Not Started | Each source captures title, URL, source name, date if visible, excerpt, and readable body |
| P2.4 | Add answer validation                   | Not Started | Shallow visible-results answers are rejected                                              |
| P2.5 | Add research tests                      | Not Started | Research runner tests prove multi-source synthesis                                        |

## Phase 3: Local Computer Polish

| ID   | Task                              | Status      | Done When                                                    |
| ---- | --------------------------------- | ----------- | ------------------------------------------------------------ |
| P3.1 | Fix Desktop path reporting        | Not Started | Output clearly says local Desktop or OneDrive Desktop        |
| P3.2 | Improve file/folder final answers | Not Started | Local actions return concise, useful paths and outcomes      |
| P3.3 | Keep GUI only for visible apps    | Not Started | File/folder/shell tasks use native tools, not desktop vision |
| P3.4 | Add native tool tests             | Not Started | Shell, folder, file, and Desktop path tests pass             |

## Phase 4: Workspace And Artifacts

| ID   | Task                    | Status      | Done When                                                      |
| ---- | ----------------------- | ----------- | -------------------------------------------------------------- |
| P4.1 | Add artifact viewer     | Not Started | Markdown/code/PDF/image artifacts can be opened inside Neura   |
| P4.2 | Add workspace explorer  | Not Started | User can browse task artifacts and generated files             |
| P4.3 | Add reveal/open actions | Not Started | Artifacts can be opened in system apps or revealed in Explorer |
| P4.4 | Add artifact tests      | Not Started | Artifact creation and viewer metadata tests pass               |

## Phase 5: Unified Orchestrator

| ID   | Task                                    | Status      | Done When                                                                                |
| ---- | --------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| P5.1 | Define orchestration contract           | Not Started | Browser, terminal, native tools, desktop GUI share one plan-act-observe-finish interface |
| P5.2 | Move quick browser behind contract      | Not Started | Existing YouTube/open-site behavior still passes                                         |
| P5.3 | Move research behind contract           | Not Started | Source-backed research still passes                                                      |
| P5.4 | Move shell/native tools behind contract | Not Started | Shell and local file tasks still pass                                                    |
| P5.5 | Remove obsolete paths safely            | Not Started | Old paths deleted only after equivalent tests pass                                       |

## Phase 6: Advanced Manus-Like Capabilities

| ID   | Task                                | Status      | Done When                                                      |
| ---- | ----------------------------------- | ----------- | -------------------------------------------------------------- |
| P6.1 | File-system memory                  | Not Started | Each task/project has persistent working context               |
| P6.2 | Episodic retrieval                  | Not Started | Past useful task records can inform new runs                   |
| P6.3 | Approval gates                      | Not Started | Sensitive actions show clean approve/deny controls             |
| P6.4 | Optional scraper backend evaluation | Not Started | Obscura is tested behind `SourceExtractor`, not added blindly  |
| P6.5 | Sandbox/VM investigation            | Not Started | VM/RDP/microVM plan exists after local Standard Mode is stable |

## Phase Checkpoint

Before any phase is marked done:

- Run focused tests for changed modules.
- Run `npm run typecheck`.
- Run `npm run build`.
- Commit with a clear phase label.
- Tag stable milestones such as `v1-stable`, `v1-research-upgrade`, or `v1-orchestrator-alpha`.
