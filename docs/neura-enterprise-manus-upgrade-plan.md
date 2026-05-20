# Neura Enterprise Manus Upgrade Plan

Local-first roadmap for moving Neura Main Desktop toward Manus-class reliability, finished work quality, and user trust.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` complete.

## North Star Acceptance

Neura can be considered Manus-level only when a non-technical user can launch common outcomes, watch a recoverable local browser/computer session, receive polished artifacts, inspect citations and proof, connect approved tools, retry failed work, and continue from prior task state without hidden mock behavior or required hosted infrastructure.

## Phase 1: Consumer Launcher And Intent Contract

- [x] Add Manus-style launcher actions for slides, websites, app development, design, Wide Research, Browser Operator, and Connectors/Automations.
- [x] Define a typed semantic intent contract with task type, required tools, risk level, expected artifacts, approval expectation, and completion proof requirement.
- [x] Feed the semantic contract into the desktop runtime prompt and routing decision.
- [x] Add model-assisted intent arbitration behind the deterministic safety contract.

Acceptance: launch actions produce explicit, routable prompts and every task run carries a clear contract for tools, risk, artifacts, and proof.

## Phase 2: Browser And Computer Reliability

- [x] Preserve a local browser automation profile for better session continuity.
- [x] Surface browser/runtime failure, retry, takeover, and recovery actions in the cockpit.
- [x] Add per-run browser/computer recovery evidence with failure class, attempted action, next action, and secret-safe metadata.
- [x] Add per-run browser restore snapshots with last URL, title, backend, takeover state, CDP URL, and profile health.
- [x] Add automatic browser restart when CDP disconnects and no user takeover is active.
- [x] Add health checks for local browser executable, profile writability, profile lock state, CDP port reachability, and bridge status.
- [x] Add browser action audit records with URL/title before and after, duration, status, and failure class.
- [x] Add browser timing metrics and slow-step diagnostics for launch, navigation, click/action, extraction, download, login wait, and recovery phases.
- [x] Add a local browser performance report artifact for real browser runs.
- [x] Expand browser recovery classes for stale DOM, download failure, network timeout, captcha/paywall/login blocks, selector miss, permission denial, and browser crash.
- [x] Add warm local browser session aging and bounded CDP restart policy so recovery refreshes stale sessions and does not loop forever.
- [x] Add explicit browser search policy: prefer the configured Google/Bing/Baidu provider, keep DuckDuckGo opt-in only, switch source once on search-provider verification walls, and surface Firefox as a real CDP/Playwright adapter gap instead of pretending support.

Acceptance: a browser task can recover from page crashes, stale CDP connections, and app restarts with clear user controls and no hidden hosted dependency.

## Phase 3: Wide Research Depth

- [x] Score every recorded source for quality using local deterministic metadata.
- [x] Include source quality and multi-source validation notes in completion proof.
- [x] Validate user-facing research claims against citation evidence links.
- [x] Require two independent medium-or-better sources for numeric and recommendation claims when marking research verified.
- [x] Downgrade unsupported claims to needs-verification and block contradictory claim evidence.
- [x] Persist structured citation records with URL, title, source name, excerpt, visible published date where available, quality, and claim IDs.
- [x] Create persisted Wide Research worker records with independent retry state and worker-to-source attribution.
- [x] Add an explicit retry path for failed Wide Research workers that routes a single subtask back through Hermes and records new sources against that worker.
- [x] Run independent browser-grounded Hermes worker sessions per subtask before the final synthesis instead of only labeling workers inside a single run.
- [x] Add dedicated local browser profiles for Wide Research worker Hermes sessions so workers do not share the takeover browser profile.

Acceptance: research answers cite source records with quality labels, enough independent validation, and honest uncertainty when sources conflict.

## Phase 4: Finished Artifact Quality

- [x] Add visible artifact proof, preview, reveal, open, export summary, and refinement affordances.
- [x] Add artifact-specific refinement templates for deck polish, spreadsheet cleanup, website QA, report editing, and media reuse.
- [x] Add readable local previews for DOCX/PPTX/XLSX and ZIP containers by extracting safe text/entry summaries from the real archive contents.
- [x] Render visual thumbnails for PPTX/DOCX/XLSX where local rendering tooling is available.
- [x] Add export validation for file existence, size, readable preview, and expected format.
- [x] Require claimed artifact kind to match the local file format so media/text mismatches cannot be registered as valid exports.

Acceptance: created work is reviewable, refineable, exportable, and validated as a real file before Neura marks the run complete.

## Phase 5: Connector Ecosystem

- [x] Productize connector status, permissions, secure credential storage, enablement, and audit logs.
- [x] Add explicit connector test actions that never write externally and report setup gaps honestly.
- [x] Add write-connector approval proof for agent-infra Slack/GitHub-style connector calls.
- [x] Add audit entries for connector connect, update, OAuth start/complete, and local revoke lifecycle changes.
- [x] Add MCP connector health checks and tool discovery diagnostics.
- [x] Add local scheduled task create, edit, pause, delete, run-now, and history persistence through the Hermes-backed background task queue.
- [x] Add connector-specific revoke at provider API level where providers support token revocation; local credential revoke is implemented.

Acceptance: users can enable, test, revoke, and audit connectors without exposing secrets or enabling accidental external writes.

## Phase 6: Multimodal Creation

- [x] Keep image, TTS, STT, video, and design providers optional and honest about missing configuration.
- [x] Add provider readiness checks and launch actions that explain missing provider setup without claiming output was created.
- [x] Refuse video-analysis placeholder artifacts until a real video upload/analysis adapter is implemented.
- [x] Add media artifact preview, reuse, and refinement loops for websites/slides.
- [x] Add local export checks for generated audio/image/video artifacts.

Acceptance: multimodal flows create real local artifacts only when providers are configured, and missing providers are reported as setup gaps.

## Phase 7: Autonomy, Resume, And Proof

- [~] Continue moving work through plan -> act -> observe -> validate with persistent checkpoints.
- [x] Add resumable run snapshots with next-action suggestions.
- [x] Add project-scoped run context with persisted project instructions, knowledge-file metadata, pinned projects, run history, and project memory.
- [x] Add local `neura://task?goal=...` and `neura://run?goal=...` deep-link task intake that queues through the real background Hermes runtime.
- [x] Add a localhost-only local task API with bearer-token auth, hashed token storage, task create/list/status, and run status endpoints.
- [x] Harden local task API and deep-link task intake with explicit JSON-only requests, constant-time token comparison, and overlong-goal rejection.
- [x] Add local task API token-integrity recovery so corrupt enabled settings do not start an API with an unknowable generated token.
- [x] Add local task API port-conflict recovery so Desktop startup surfaces a setup gap instead of crashing the app.
- [x] Add secure Gmail subject-prefix task intake that is disabled by default, uses the real read-only Gmail connector, and queues only explicit `[Neura Task]` messages.
- [x] Add Gmail intake sender allowlist, dedupe-safe skipped-message handling, last-run timestamp, and visible audit events.
- [x] Add focused browser/computer failure classification for navigation timeout, selector miss, login/captcha block, permission denial, browser crash, and unknown recovery.
- [x] Add broader failure classification: user approval needed, provider config, tool error, validation error, and connector auth error.
- [x] Add completion proof validators per task type.
- [x] Add focused regression tests for launcher routing, source proof, artifact refinement, and browser recovery.

Evidence: focused browser tests passed with `npm.cmd --prefix apps/neura run test -- --run src/shared/browserAutomationRecovery.test.ts src/shared/taskEvidence.test.ts src/main/services/hermesBrowserBridge.test.ts src/main/services/taskRunRegistry.test.ts src/main/services/task-manager.test.ts` (5 files, 26 tests); node/web typechecks passed with `npm.cmd --prefix apps/neura run typecheck:node` and `npm.cmd --prefix apps/neura run typecheck:web`; production build passed with `npm.cmd --prefix apps/neura run build:dist`.

Acceptance: Neura never silently marks brittle work complete; users see what happened, what remains, and how to resume.

## Current Honesty Check

The desktop app is materially closer after this slice, but it is not honest to call the current build Manus-level yet. Neura remains intentionally local-first with no required cloud browser, hosted worker, or paid remote sandbox dependency. Remaining gaps are extended real-world endurance under very long browser tasks, broader connector marketplace/provider coverage, richer provider-specific refresh/revoke support beyond implemented paths, and production-grade mail intake features beyond current read-only Gmail subject-prefix queueing.
