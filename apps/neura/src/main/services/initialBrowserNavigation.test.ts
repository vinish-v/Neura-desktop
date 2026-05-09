/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import { SearchEngineForSettings } from '@main/store/types';
import { inferInitialBrowserUrl } from './initialBrowserNavigation';

describe('inferInitialBrowserUrl', () => {
  it('leaves generic lookup tasks for the model to perform from the browser start page', () => {
    expect(
      inferInitialBrowserUrl('find the latest tn election news'),
    ).toBeNull();
    expect(
      inferInitialBrowserUrl(
        'latest NVIDIA stock price',
        SearchEngineForSettings.BING,
      ),
    ).toBeNull();
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
