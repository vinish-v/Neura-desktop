You are Codex GPT-5.5 working in D:/new-neura/neura-main-desktop on Neura Main Desktop.

MISSION: Implement the next focused Manus-level slice: browser/computer automation resilience and recovery evidence.

CRITICAL SAFETY:
- Preserve all existing uncommitted work. Do NOT reset, revert, clean, delete unrelated files, or discard changes.
- Build on the already implemented Manus-upgrade slices.
- Keep scope focused. Do not rewrite the whole app.
- Do not add secrets or credentials.

EXPECTED PRIOR STATE:
- Claim/evidence validation slice should already exist and tests/typecheck should pass before this starts.
- Multimodal readiness, intent classification, source quality, and task registry tests should already pass.

PRODUCT BAR:
Neura should approach Manus-level browser/computer autonomy: reliable browser sessions, visible recovery state, honest failure/blocked messages, and evidence of what was tried.

IMPLEMENTATION GOAL:
Add a small, production-safe browser/computer recovery layer that helps Neura recover from common automation failures and shows evidence instead of vague errors.

Suggested implementation path:
1. Inspect existing files first:
   - `apps/neura/src/main/services/hermesBrowserBridge.ts`
   - `apps/neura/src/main/services/nativeComputerTools.ts`
   - `apps/neura/src/main/services/taskRunRegistry.ts`
   - UI panels under `apps/neura/src/renderer/src/components/RunMessages/`
2. Add or improve a recovery/evidence module:
   - classify browser/computer failures: navigation timeout, selector not found, blocked/captcha/login required, permission denied, browser crashed, unknown.
   - recommend recovery steps: retry navigation, capture screenshot/snapshot, ask user for login/captcha, relaunch browser, fallback to manual handoff.
   - generate task evidence entries where possible: browser snapshot, screenshot path, attempted URL/action, recovery status.
   - secret-safe: do not store cookies/tokens/passwords/raw auth headers.
3. Integrate lightly:
   - task run messages/panel can show recovery state and next action.
   - automation tool failures should return useful blocked/needs-verification messages instead of fake completion.
4. Add tests:
   - classification tests for common failure strings.
   - recovery recommendation tests.
   - secret redaction test.
   - if integrated with registry, add one registry/panel-safe data test.
5. Update docs roadmap briefly.

QUALITY GATES TO RUN:
- Add the new focused test file(s), then run them.
- Also run:
  `npm test -- --run src/shared/taskEvidence.test.ts src/shared/multimodalReadiness.test.ts src/shared/intentClassification.test.ts src/main/services/sourceQuality.test.ts src/main/services/taskRunRegistry.test.ts`
- `npm run typecheck`

EXIT REQUIREMENT:
Stop when this focused slice is implemented and gates pass. Print concise summary with files changed and blockers. If stuck, do not loop printing diffs; explain and exit.
