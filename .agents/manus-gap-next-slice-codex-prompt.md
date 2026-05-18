You are Codex GPT-5.5 in D:/new-neura/neura-main-desktop.

The previous run produced a large compile-green slice, but stalled. Continue with a focused real product improvement only. Do NOT touch apps/neura-ide. Preserve existing uncommitted changes. Do not reset.

Verified by Hermes after previous run:
- Focused tests passed: src/shared/intentClassification.test.ts, src/main/services/sourceQuality.test.ts, src/main/services/taskRunRegistry.test.ts.
- npm run typecheck passed.
- npm run build compiled main/preload/renderer and packaged app; timed out only during Squirrel distributable creation.

YOUR TASK: Implement one concrete missing Manus-level gap from docs/neura-enterprise-manus-upgrade-plan.md, preferably:
1) Provider readiness checks for multimodal tools and clear UI/setup messages, OR
2) Browser restore snapshots with last URL/title/profile health and tests, OR
3) Connector test/health actions that do not write externally without approval.

Requirements:
- Make real code changes, not just docs.
- Add focused tests.
- Run the focused tests and typecheck.
- Exit cleanly with summary. Do not loop printing diffs.
- Keep local-first and honest; no fake generated outputs, no required cloud dependencies, no secrets.

Final output: concise summary, files changed, tests run, remaining gaps.