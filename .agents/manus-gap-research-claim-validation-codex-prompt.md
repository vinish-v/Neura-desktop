You are Codex GPT-5.5 working in D:/new-neura/neura-main-desktop on Neura Main Desktop.

MISSION: Next focused Manus-level slice: deep research citation graph and claim cross-checking.

SAFETY:
- Preserve all uncommitted work. Do NOT reset/revert/clean/delete unrelated files.
- Build on existing slices: taskEvidence, browserAutomationRecovery, sourceQuality, intentClassification, multimodalReadiness.
- Keep this slice focused and testable. No secrets.

CURRENT VERIFIED GATES BEFORE THIS RUN:
- `npm test -- --run src/shared/browserAutomationRecovery.test.ts src/shared/taskEvidence.test.ts src/shared/multimodalReadiness.test.ts src/shared/intentClassification.test.ts src/main/services/sourceQuality.test.ts src/main/services/taskRunRegistry.test.ts` passed: 24/24.
- `npm run typecheck` passed.

GOAL:
Improve Wide Research toward Manus-level: map user-facing claims to evidence, require independent support for strong claims, expose unsupported claims as needs_verification instead of confident completion.

IMPLEMENTATION SUGGESTION:
1. Inspect:
   - `apps/neura/src/main/services/sourceQuality.ts`
   - `apps/neura/src/shared/taskEvidence.ts`
   - `apps/neura/src/main/services/task-manager.ts`
   - `apps/neura/src/main/services/taskRunRegistry.ts`
   - research-related message/run UI if relevant.
2. Add shared/main-safe module, e.g. `apps/neura/src/shared/researchClaimValidation.ts`:
   - Types: ResearchClaim, ClaimEvidenceLink, ClaimValidationResult.
   - classify claims: factual, numeric, recommendation, speculative.
   - require evidence: factual >=1 source, numeric/recommendation >=2 independent quality sources where available.
   - statuses: supported, weakly_supported, unsupported, contradicted.
   - produce overall evidence status compatible with taskEvidence completion statuses.
   - redact secrets in evidence metadata.
3. Integrate lightly with source quality/task evidence if straightforward:
   - convert claim validation results into task evidence/checklist or run progress metadata.
   - do not break existing runs.
4. Tests:
   - supported factual claim with one source.
   - numeric/recommendation claim needs two independent sources.
   - unsupported claim becomes needs_verification.
   - contradictory evidence becomes blocked or unsupported/contradicted.
   - secret redaction.
5. Update roadmap docs briefly.

QUALITY GATES:
- New focused tests.
- Existing gate:
  `npm test -- --run src/shared/researchClaimValidation.test.ts src/shared/browserAutomationRecovery.test.ts src/shared/taskEvidence.test.ts src/shared/multimodalReadiness.test.ts src/shared/intentClassification.test.ts src/main/services/sourceQuality.test.ts src/main/services/taskRunRegistry.test.ts`
- `npm run typecheck`

EXIT:
Stop after focused slice and gates. Print concise summary. If stuck, exit with blocker; do not loop printing diffs.
