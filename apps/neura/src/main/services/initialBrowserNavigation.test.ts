/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import { SearchEngineForSettings } from '@main/store/types';
import { inferInitialBrowserUrl } from './initialBrowserNavigation';

describe('inferInitialBrowserUrl', () => {
  it('opens generic lookup tasks directly on the configured search engine', () => {
    expect(
      inferInitialBrowserUrl('find the latest tn election news'),
    ).toBe('https://www.google.com/search?q=latest%20tn%20election%20news');
    expect(
      inferInitialBrowserUrl(
        'latest NVIDIA stock price',
        SearchEngineForSettings.BING,
      ),
    ).toBe('https://www.bing.com/search?q=latest%20NVIDIA%20stock%20price');
    expect(inferInitialBrowserUrl('search about india')).toBe(
      'https://www.google.com/search?q=india',
    );
  });

  it('keeps explicit sites as direct navigation targets', () => {
    expect(inferInitialBrowserUrl('open github and search neura')).toBe(
      'github.com',
    );
    expect(inferInitialBrowserUrl('visit https://example.com/docs')).toBe(
      'https://example.com/docs',
    );
  });

  it('does not infer unrelated local computer tasks', () => {
    expect(inferInitialBrowserUrl('rename the file on my desktop')).toBeNull();
  });
});
