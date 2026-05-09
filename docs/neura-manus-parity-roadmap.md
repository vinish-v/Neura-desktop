# Neura Manus-Parity Roadmap

Local-first implementation tracker for the Manus-parity gaps selected by the team.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` complete.

## Phase 0: Persistent Task Tracker

- [x] Create this persistent roadmap document.
- [x] Add sections for phases 1-7 with task checkboxes and acceptance criteria.
- [x] Update this tracker after every completed implementation task.

Acceptance: this document exists in the repo and can be updated as features land.

## Phase 1: Agent Task Foundation

- [x] Extend task/run state so Neura can track run id, run mode, progress, sources, artifacts, errors, and completion status.
- [x] Add a local run registry persisted through Electron storage.
- [x] Add reusable artifact metadata.
- [x] Add UI support for task progress, completed artifacts, and failed tasks.
- [x] Keep v1 local-first with no cloud worker dependency.

Acceptance: every advanced workflow can create a local run record and attach artifacts.

## Phase 2: Wide Research / Parallel Agents

- [x] Add `wide_research` run mode.
- [x] Build a task decomposer for item lists.
- [x] Run subtasks through a bounded local worker pool, default concurrency `4`.
- [x] Collect per-worker facts, sources, confidence, and errors with model-backed workers when planner/chat settings are configured.
- [x] Add synthesis output plus optional CSV/XLSX artifact.
- [x] Show per-item status in the UI.

Acceptance: a 20-item research task completes with independent worker records and synthesized report/data artifacts. Browser-grounded retrieval and source quality scoring remain the next depth upgrade.

## Phase 3: Integrations Ecosystem

- [x] Add local Connector Center foundation.
- [x] Support custom MCP servers first.
- [x] Add GitHub issue/file export, Slack webhook, and Google Drive-compatible export placeholder.
- [x] Expose connector tools only when enabled.
- [x] Add permission/confirmation UI for external writes.

Acceptance: enabled GitHub/Slack/MCP connectors can be used, disabled connectors are refused, and permission events are visible. Full GitHub OAuth and Google Drive upload remain marketplace-phase work.

## Phase 4: Finished Artifact Quality

- [x] Add Artifact Studio service.
- [x] Upgrade PPTX generation with themes, layouts, charts, notes, and metadata.
- [x] Upgrade XLSX/CSV generation with formatting, charts where feasible, and summary sheets.
- [x] Add report generation path from research/data to DOCX/PDF/PPTX.
- [x] Add artifact gallery actions.

Acceptance: one prompt creates a usable research-backed deck and formatted spreadsheet.

## Phase 5: Website/App Builder Flow

- [x] Add `website_builder` run mode.
- [x] Generate local app projects into a default or chosen workspace folder.
- [x] Use Vite + React + TypeScript for v1 apps.
- [x] Add preview flow using existing process tools.
- [x] Add static export/zip artifact as v1 deployment output.

Acceptance: prompt -> local project -> running preview -> build/export artifact.

## Phase 6: Multimodal Creation

- [x] Add provider settings for image generation, speech-to-text, text-to-speech, and video understanding.
- [x] Add native tools: `generate_image`, `transcribe_audio`, `synthesize_speech`, `analyze_video`.
- [x] Store generated images, speech output, transcripts, and video-analysis request files as run artifacts.
- [x] Allow media artifacts in slides and websites through `image_path` / `asset_path` inputs.

Acceptance: Neura can generate images and speech, transcribe audio through configured OpenAI-compatible providers, and attach outputs to a task. Video upload analysis is still a provider-specific follow-up; the current tool records an explicit request artifact instead of pretending analysis is complete.

## Phase 7: Product Polish And Trust Workflow

- [x] Add Projects view grouping runs, artifacts, sources, and generated files.
- [x] Add run history with replay-friendly event records.
- [x] Add source/citation panel for research/browser tasks.
- [x] Add stop/resume/retry controls for long tasks.
- [x] Add approval gates for external writes, destructive local actions, and connector actions.
- [x] Add share/export flow for completed task summaries and artifacts.

Acceptance: users can inspect what happened, what was created, which sources were used, and which actions were approved.

## Phase 8: Orchestration, Semantic Routing, And Verification

- [x] Add semantic-first intent contract fields: task type, required tools, risk level, verification requirement, and expected artifacts.
- [x] Keep deterministic safety overrides for local files, processes, and destructive-looking tasks.
- [x] Add persistent completion proof metadata to task runs.
- [x] Add structural completion-proof validation for browser research and artifact workflows.
- [x] Attach artifact completion proofs for Wide Research, Artifact Studio, Website Builder, and Multimodal workflows.
- [x] Attach browser terminal-page proof for autonomous browser workflows.
- [x] Add a local computer Planner -> Executor -> Validator actor runner for native file/process/connector tasks.
- [x] Move visual desktop-app GUI tasks into the same actor graph.
- [~] Add browser-grounded retrieval/source-quality scoring to Wide Research.

Acceptance: complex workflows can no longer be marked complete without source, artifact, or action evidence. Native and visual local-computer tasks now enter an actor plan; browser-grounded retrieval/source-quality scoring is the remaining Phase 8 gap.
