import { describe, expect, it } from 'vitest';

import type { TaskEvidence } from './taskEvidence';
import {
  classifyResearchClaim,
  validateResearchClaims,
} from './researchClaimValidation';

const source = (
  id: string,
  url: string,
  excerpt: string,
  sourceQualityTier: TaskEvidence['sourceQualityTier'] = 'high',
): TaskEvidence => ({
  id,
  kind: 'citation_source',
  summary: excerpt,
  status: 'completed',
  url,
  excerpt,
  sourceQualityTier,
  sourceQualityScore: sourceQualityTier === 'high' ? 90 : 68,
});

describe('research claim validation', () => {
  it('supports a factual claim with one source', () => {
    const result = validateResearchClaims({
      finalAnswer:
        'Neura records source quality evidence before marking research complete.',
      evidence: [
        source(
          'source-1',
          'https://docs.neura.local/research',
          'Neura records source quality evidence before marking research complete.',
        ),
      ],
    });

    expect(classifyResearchClaim(result.claims[0].claim.text)).toBe('factual');
    expect(result.completionStatus).toBe('verified');
    expect(result.claims[0]).toEqual(
      expect.objectContaining({
        status: 'supported',
        independentSupportCount: 1,
      }),
    );
  });

  it('requires two independent quality sources for numeric and recommendation claims', () => {
    const numericClaim = {
      id: 'claim-1',
      text: 'The market grew by 12 percent in 2025.',
    };
    const weakResult = validateResearchClaims({
      claims: [numericClaim],
      evidence: [
        source(
          'source-1',
          'https://example.com/report-a',
          'The market grew by 12 percent in 2025.',
        ),
        source(
          'source-2',
          'https://www.example.com/report-b',
          'The market grew by 12 percent in 2025.',
        ),
      ],
      evidenceLinks: [
        {
          claimId: 'claim-1',
          evidenceId: 'source-1',
          relationship: 'supports',
          domain: 'example.com',
          sourceQualityTier: 'high',
        },
        {
          claimId: 'claim-1',
          evidenceId: 'source-2',
          relationship: 'supports',
          domain: 'example.com',
          sourceQualityTier: 'high',
        },
      ],
    });

    expect(weakResult.completionStatus).toBe('needs_verification');
    expect(weakResult.claims[0].status).toBe('weakly_supported');

    const supportedResult = validateResearchClaims({
      claims: [
        {
          id: 'claim-2',
          text: 'Neura should use two independent sources for recommendations.',
        },
      ],
      evidence: [
        source(
          'source-1',
          'https://example.com/recommendation',
          'Neura should use two independent sources for recommendations.',
        ),
        source(
          'source-2',
          'https://research.example.org/recommendation',
          'Neura should use two independent sources for recommendations.',
        ),
      ],
      evidenceLinks: [
        {
          claimId: 'claim-2',
          evidenceId: 'source-1',
          relationship: 'supports',
          domain: 'example.com',
          sourceQualityTier: 'high',
        },
        {
          claimId: 'claim-2',
          evidenceId: 'source-2',
          relationship: 'supports',
          domain: 'research.example.org',
          sourceQualityTier: 'medium',
        },
      ],
    });

    expect(supportedResult.claims[0].claim.type).toBe('recommendation');
    expect(supportedResult.completionStatus).toBe('verified');
    expect(supportedResult.claims[0].independentSupportCount).toBe(2);
  });

  it('marks unsupported claims as needing verification', () => {
    const result = validateResearchClaims({
      claims: [
        {
          id: 'claim-1',
          text: 'The product launched in 2026.',
        },
      ],
      evidence: [],
    });

    expect(result.completionStatus).toBe('needs_verification');
    expect(result.overallStatus).toBe('unsupported');
    expect(result.missingEvidence.join(' ')).toContain(
      'has no linked citation evidence',
    );
  });

  it('blocks contradictory claim evidence', () => {
    const result = validateResearchClaims({
      claims: [
        {
          id: 'claim-1',
          text: 'The trial is complete.',
        },
      ],
      evidence: [
        source(
          'source-1',
          'https://example.edu/trial',
          'The trial is still recruiting participants.',
        ),
      ],
      evidenceLinks: [
        {
          claimId: 'claim-1',
          evidenceId: 'source-1',
          relationship: 'contradicts',
          domain: 'example.edu',
          sourceQualityTier: 'high',
        },
      ],
    });

    expect(result.completionStatus).toBe('blocked');
    expect(result.overallStatus).toBe('contradicted');
    expect(result.claims[0].status).toBe('contradicted');
  });

  it('redacts secrets from claim evidence metadata', () => {
    const result = validateResearchClaims({
      claims: [
        {
          id: 'claim-1',
          text: 'The connector call succeeded.',
          metadata: {
            apiKey: 'sk-secret',
          },
        },
      ],
      evidence: [
        source(
          'source-1',
          'https://example.com/connector',
          'The connector call succeeded.',
        ),
      ],
      evidenceLinks: [
        {
          claimId: 'claim-1',
          evidenceId: 'source-1',
          relationship: 'supports',
          domain: 'example.com',
          quote: 'Authorization: Bearer abc123',
          sourceQualityTier: 'high',
          metadata: {
            token: 'ghp_secret',
            nested: 'password=hunter2',
          },
        },
      ],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('ghp_secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('[REDACTED]');
  });
});
