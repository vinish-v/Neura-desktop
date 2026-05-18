import { describe, expect, it } from 'vitest';

import {
  redactEvidenceSecrets,
  sanitizeTaskEvidence,
  validateTaskEvidence,
} from './taskEvidence';

describe('task evidence validation', () => {
  it('verifies a claim when required source and artifact evidence exists', () => {
    const result = validateTaskEvidence({
      claim: 'The report was researched and saved.',
      evidence: [
        {
          id: 'source-1',
          kind: 'citation_source',
          summary: 'SEC filing page',
          status: 'completed',
          url: 'https://sec.gov/example',
          sourceQualityTier: 'high',
          sourceQualityScore: 92,
        },
        {
          id: 'artifact-1',
          kind: 'file_artifact',
          summary: 'Saved research report',
          status: 'completed',
          path: 'C:\\Users\\HP\\Neura-Projects\\report.md',
          artifactKind: 'report',
        },
      ],
      requirements: {
        requireCitationSource: true,
        minimumMediumConfidenceSources: 1,
        requireFileArtifact: true,
        acceptedArtifactKinds: ['report'],
      },
    });

    expect(result.completionStatus).toBe('verified');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.missingEvidence).toEqual([]);
  });

  it('requires verification when required evidence is missing', () => {
    const result = validateTaskEvidence({
      claim: 'The latest pricing was checked.',
      evidence: [],
      requirements: {
        requireCitationSource: true,
        minimumCitationSources: 2,
      },
    });

    expect(result.completionStatus).toBe('needs_verification');
    expect(result.missingEvidence).toEqual(
      expect.arrayContaining([
        'Attach at least one source, artifact, browser, command, or connector evidence record.',
        'Record at least 2 citation/source evidence items.',
      ]),
    );
    expect(result.agentFacingMessage).toContain(
      'Do not say the task is complete yet.',
    );
  });

  it('blocks completion when the final claim or command proof failed', () => {
    const result = validateTaskEvidence({
      claim: '',
      evidence: [
        {
          id: 'test-1',
          kind: 'command_test',
          summary: 'npm test',
          status: 'failed',
          command: 'npm test',
        },
      ],
      requirements: {
        requireCommandTest: true,
      },
    });

    expect(result.completionStatus).toBe('blocked');
    expect(result.missingEvidence.join(' ')).toContain(
      'A user-facing completion claim or final answer is missing.',
    );
    expect(result.missingEvidence.join(' ')).toContain(
      'Recorded evidence failed',
    );
  });

  it('redacts secrets from serialized evidence and blocker text', () => {
    const evidence = sanitizeTaskEvidence({
      id: 'connector-1',
      kind: 'connector_action',
      summary: 'Called connector with token=abc123',
      status: 'completed',
      connectorName: 'github',
      metadata: {
        apiKey: 'sk-live-secret',
        nested: {
          Authorization: 'Bearer secret-token',
          url: 'https://example.com?token=abc123',
        },
      },
    });
    const result = validateTaskEvidence({
      claim: 'Connector action completed.',
      evidence: [evidence],
      requirements: {
        requireConnectorEvidence: true,
      },
      knownFailures: ['password=hunter2 was rejected'],
    });

    expect(JSON.stringify(evidence)).not.toContain('sk-live-secret');
    expect(JSON.stringify(evidence)).not.toContain('secret-token');
    expect(JSON.stringify(evidence)).not.toContain('abc123');
    expect(JSON.stringify(redactEvidenceSecrets(result))).not.toContain(
      'hunter2',
    );
  });
});
