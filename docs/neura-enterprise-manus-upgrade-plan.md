# Neura Enterprise Manus Upgrade Plan

Local-first roadmap for moving Neura Main Desktop toward Manus-class reliability, finished work quality, and user trust.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` complete.

## North Star Acceptance

Neura can be considered Manus-level only when a non-technical user can launch common outcomes, watch a recoverable local browser/computer session, receive polished artifacts, inspect citations and proof, connect approved tools, retry failed work, and continue from prior task state without hidden mock behavior or required hosted infrastructure.

## Phase 1: Consumer Launcher And Intent Contract

- [x] Add Manus-style launcher actions for slides, websites, app development, design, Wide Research, Browser Operator, and Connectors/Automations.
- [x] Define a typed semantic intent contract with task type, required tools, risk level, expected artifacts, approval expectation, and completion proof requirement.
- [x] Feed the semantic contract into the desktop runtime prompt and routing decision.
- [ ] Add model-assisted intent arbitration behind the deterministic safety contract.

Acceptance: launch actions produce explicit, routable prompts and every task run carries a clear contract for tools, risk, artifacts, and proof.

## Phase 2: Browser And Computer Reliability

- [x] Preserve a local browser automation profile for better session continuity.
- [x] Surface browser/runtime failure, retry, takeover, and recovery actions in the cockpit.
- [x] Add per-run browser/computer recovery evidence with failure class, attempted action, next action, and secret-safe metadata.
- [ ] Add per-run browser restore snapshots with last URL, title, and profile health.
- [ ] Add automatic browser restart when CDP disconnects and no user takeover is active.
- [ ] Add health checks for local browser executable, permissions, and profile lock state.

Acceptance: a browser task can recover from page crashes, stale CDP connections, and app restarts with clear user controls and no hidden hosted dependency.

## Phase 3: Wide Research Depth

- [x] Score every recorded source for quality using local deterministic metadata.
- [x] Include source quality and multi-source validation notes in completion proof.
- [x] Validate user-facing research claims against citation evidence links.
- [x] Require two independent medium-or-better sources for numeric and recommendation claims when marking research verified.
- [x] Downgrade unsupported claims to needs-verification and block contradictory claim evidence.
- [ ] Fetch and persist structured citation records with visible published dates where available.

Acceptance: research answers cite source records with quality labels, enough independent validation, and honest uncertainty when sources conflict.

## Phase 4: Finished Artifact Quality

- [x] Add visible artifact proof, preview, reveal, open, export summary, and refinement affordances.
- [ ] Add artifact-specific refinement templates for deck polish, spreadsheet cleanup, website QA, and report editing.
- [ ] Render preview thumbnails for PPTX/DOCX/XLSX where local tooling is available.
- [ ] Add export validation for file existence, size, readable preview, and expected format.

Acceptance: created work is reviewable, refineable, exportable, and validated as a real file before Neura marks the run complete.

## Phase 5: Connector Ecosystem

- [~] Productize connector status, permissions, secure credential storage, enablement, and audit logs.
- [ ] Add explicit connector test actions that do not write externally without approval.
- [ ] Add Drive export and Slack/GitHub write flows with per-action permission proof.
- [ ] Add MCP connector health checks and tool discovery diagnostics.

Acceptance: users can enable, test, revoke, and audit connectors without exposing secrets or enabling accidental external writes.

## Phase 6: Multimodal Creation

- [~] Keep image, TTS, STT, video, and design providers optional and honest about missing configuration.
- [ ] Add provider readiness checks and launch actions that explain missing provider setup without claiming output was created.
- [ ] Add media artifact preview, reuse, and refinement loops for websites/slides.
- [ ] Add local export checks for generated audio/image/video artifacts.

Acceptance: multimodal flows create real local artifacts only when providers are configured, and missing providers are reported as setup gaps.

## Phase 7: Autonomy, Resume, And Proof

- [~] Continue moving work through plan -> act -> observe -> validate with persistent checkpoints.
- [ ] Add resumable run snapshots with next-action suggestions.
- [x] Add focused browser/computer failure classification for navigation timeout, selector miss, login/captcha block, permission denial, browser crash, and unknown recovery.
- [ ] Add broader failure classification: user approval needed, provider config, tool error, validation error.
- [ ] Add completion proof validators per task type.
- [ ] Add focused regression tests for launcher routing, source proof, artifact refinement, and browser recovery.

Acceptance: Neura never silently marks brittle work complete; users see what happened, what remains, and how to resume.

## Current Honesty Check

The desktop app is materially closer after this slice, but it is not honest to call the current build Manus-level yet. The remaining gap is full reliability under long-running real browser tasks, consistently polished artifacts across all formats, deep source-grounded research, and a fully tested connector marketplace.
