import { describe, expect, it } from 'vitest';

import {
  scoreSourceQuality,
  summarizeSourceQuality,
} from './sourceQuality';

describe('source quality scoring', () => {
  it('scores institutional https sources above generic low-signal links', () => {
    const official = scoreSourceQuality({
      url: 'https://www.nih.gov/news-events/research',
      title: 'Research update',
      sourceName: 'NIH',
      excerpt:
        'A long enough excerpt that captures the relevant claim and gives Neura useful citation evidence.',
    });
    const generic = scoreSourceQuality({
      url: 'http://example.com/amp/?utm_source=ad',
    });

    expect(official.tier).toBe('high');
    expect(official.score).toBeGreaterThan(generic.score);
    expect(generic.tier).toBe('low');
  });

  it('summarizes source quality for completion proofs', () => {
    const summary = summarizeSourceQuality([
      {
        id: 'source-1',
        url: 'https://developer.mozilla.org/en-US/docs/Web/API',
        title: 'MDN Web APIs',
        capturedAt: 1,
      },
      {
        id: 'source-2',
        url: 'https://example.com/page',
        capturedAt: 1,
      },
    ]);

    expect(summary.sourceCount).toBe(2);
    expect(summary.mediumOrBetterCount).toBeGreaterThanOrEqual(1);
    expect(summary.domains).toContain('developer.mozilla.org');
  });
});
