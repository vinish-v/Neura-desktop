You are Codex GPT-5.5 working in D:/new-neura/neura-main-desktop on Neura Main Desktop.

MISSION: Implement the next focused Manus-level slice: honest research/work-product claim validation and evidence surfacing. Neura must not claim a task is done unless the run has verifiable evidence.

CRITICAL SAFETY:
- Preserve all existing uncommitted work. Do NOT reset, revert, delete unrelated files, clean, or discard changes.
- This repo already has large local modifications from prior Manus-upgrade slices. Build on them.
- Keep scope focused. Do not rewrite the whole app.
- Do not add secrets or credentials.

CURRENT VERIFIED STATE BEFORE THIS RUN:
- `npm test -- --run src/shared/multimodalReadiness.test.ts src/shared/intentClassification.test.ts src/main/services/sourceQuality.test.ts src/main/services/taskRunRegistry.test.ts` passes: 13/13.
- `npm run typecheck` passes.
- `npm run build` compiles main/preload/renderer and packages app, then times out only during Squirrel distributable creation after packaging.
- Multimodal readiness exists at `apps/neura/src/shared/multimodalReadiness.ts` and tests ensure provider setup honesty.

PRODUCT BAR:
The user wants Manus AI-level quality: enterprise reliability, polished creator outputs, simple consumer UX, strong browser/research autonomy, connector ecosystem, and honest completion claims. This slice is specifically about honest completion claims + evidence.

IMPLEMENTATION GOAL:
Add a small, durable claim/evidence validation layer that can be used by task runs, research outputs, and artifact outputs.

Suggested implementation path:
1. Add a shared/main-safe service such as `apps/neura/src/shared/taskEvidence.ts` or main service if better:
   - Types for evidence: citation/source evidence, file artifact evidence, browser snapshot evidence, command/test evidence, connector evidence.
   - A validator/scorer that returns:
     - `completionStatus`: `blocked` | `needs_verification` | `verified`
     - `confidence`: number 0-1
     - `missingEvidence`: human readable list
     - `agentFacingMessage`: short instruction that Neura must say to user when evidence is missing.
   - Secret-safe serialization: never include apiKey/token/password/secret values.
2. Integrate with existing task run registry/panel if straightforward:
   - task run summary should expose evidence/checklist fields or validation status.
   - UI should show “Verified”, “Needs verification”, or “Blocked” instead of vague success.
   - Do not break existing task runs.
3. Add tests:
   - Verified when required evidence exists.
   - Needs verification/blocked when evidence missing.
   - Secret redaction test.
   - If integrated with registry, add/extend registry tests.
4. Update docs roadmap briefly with this completed/partial slice.

QUALITY GATES TO RUN:
- `npm test -- --run src/shared/taskEvidence.test.ts src/main/services/taskRunRegistry.test.ts` (adjust paths if you choose different test file names)
- `npm test -- --run src/shared/multimodalReadiness.test.ts src/shared/intentClassification.test.ts src/main/services/sourceQuality.test.ts src/main/services/taskRunRegistry.test.ts`
- `npm run typecheck`

EXIT REQUIREMENT:
Stop when the focused slice is implemented and the above gates pass. Print a concise summary with files changed and any remaining blockers. If you get stuck, do not loop printing diffs; explain the blocker and exit.
