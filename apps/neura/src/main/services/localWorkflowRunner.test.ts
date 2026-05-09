import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    getStore: vi.fn(() => ({})),
  },
}));

import {
  extractResearchJsonObject,
  parseResearchItems,
  runResearchWorker,
} from './localWorkflowRunner';

describe('wide research helpers', () => {
  it('parses explicit item lists from prompts', () => {
    expect(
      parseResearchItems('wide research these competitors:\n- Acme\n- Globex'),
    ).toEqual(['Acme', 'Globex']);
  });

  it('extracts JSON from fenced model responses', () => {
    expect(
      extractResearchJsonObject(
        '```json\n{"summary":"ok","sources":["https://example.com"],"confidence":0.7}\n```',
      ),
    ).toMatchObject({
      summary: 'ok',
      sources: ['https://example.com'],
      confidence: 0.7,
    });
  });

  it('falls back without a configured model instead of fabricating sources', async () => {
    await expect(
      runResearchWorker({
        item: 'Acme',
        index: 0,
        instructions: 'Research Acme',
        config: null,
      }),
    ).resolves.toMatchObject({
      item: 'Acme',
      worker: 'worker-1',
      sources: '',
      confidence: '0.00',
      status: 'failed',
    });
  });
});
