import { describe, expect, it } from 'vitest';

import { SearchEngineForSettings } from '@main/store/types';

import {
  buildBrowserSearchPolicy,
  getHermesRunTimingAbortReason,
} from './hermesRuntime';

describe('Hermes runtime timing guard', () => {
  it('does not abort while the runtime is making timely progress', () => {
    expect(
      getHermesRunTimingAbortReason({
        now: 10_000,
        startedAt: 0,
        lastActivityAt: 9_000,
        stallTimeoutMs: 5_000,
        maxRunMs: 60_000,
      }),
    ).toBe('');
  });

  it('aborts stalled local runs before they can hang indefinitely', () => {
    expect(
      getHermesRunTimingAbortReason({
        now: 20_000,
        startedAt: 0,
        lastActivityAt: 10_000,
        stallTimeoutMs: 5_000,
        maxRunMs: 60_000,
      }),
    ).toContain('no observable progress');
  });

  it('enforces an absolute local run budget', () => {
    expect(
      getHermesRunTimingAbortReason({
        now: 70_000,
        startedAt: 0,
        lastActivityAt: 69_000,
        stallTimeoutMs: 5_000,
        maxRunMs: 60_000,
      }),
    ).toContain('exceeded the local run limit');
  });
});

describe('Hermes browser search policy', () => {
  it('defaults browser research to Google with Bing/source fallback', () => {
    const policy = buildBrowserSearchPolicy();

    expect(policy).toContain('Google Search first');
    expect(policy).toContain('Bing');
    expect(policy).toContain('Do not use DuckDuckGo unless the user explicitly asks');
    expect(policy).toContain('Never attempt to bypass or solve CAPTCHA');
  });

  it('respects the configured browser search engine while keeping DuckDuckGo opt-in', () => {
    const policy = buildBrowserSearchPolicy(SearchEngineForSettings.BING);

    expect(policy).toContain('use Bing first');
    expect(policy).toContain('try Google Search once');
    expect(policy).toContain('Do not use DuckDuckGo unless the user explicitly asks');
  });
});
