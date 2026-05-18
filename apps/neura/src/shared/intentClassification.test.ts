import { describe, expect, it } from 'vitest';

import { classifyUserIntent } from './intentClassification';

describe('classifyUserIntent semantic contract', () => {
  it('routes launcher-style slide requests to artifact creation with proof', () => {
    const decision = classifyUserIntent(
      'Create slides about AI agents with cited sources and export a PPTX',
    );

    expect(decision.surface).toBe('computer');
    expect(decision.contract.taskType).toBe('slide_creation');
    expect(decision.contract.expectedArtifacts).toContain('presentation');
    expect(decision.contract.completionProof).toBe('mixed');
  });

  it('keeps wide research browser-grounded and verification-heavy', () => {
    const decision = classifyUserIntent(
      'Run Wide Research comparing 20 AI browser operators with sources',
    );

    expect(decision.kind).toBe('browser_research');
    expect(decision.contract.taskType).toBe('wide_research');
    expect(decision.contract.requiredTools).toContain('browser');
    expect(decision.contract.verificationRequired).toBe(true);
  });

  it('marks connector workflows as approval-gated', () => {
    const decision = classifyUserIntent(
      'Use the GitHub connector to create an issue from this report',
    );

    expect(decision.kind).toBe('connector');
    expect(decision.contract.requiredTools).toContain('connectors');
    expect(decision.contract.needsApproval).toBe(true);
    expect(decision.contract.completionProof).toBe('connector_audit');
  });
});
