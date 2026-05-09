/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { VLMProviderV2 } from './types';

describe('VLMProviderV2', () => {
  it('should have correct values for each provider', () => {
    const cases = [
      [VLMProviderV2.neura_1_0, 'Hugging Face for Neura-1.0'],
      [VLMProviderV2.neura_1_5, 'Hugging Face for Neura-1.5'],
      [VLMProviderV2.doubao_1_5, 'VolcEngine Ark for Doubao-1.5-Neura'],
      [VLMProviderV2.nvidia_nim, 'NVIDIA NIM'],
      [
        VLMProviderV2.doubao_1_5_vl,
        'VolcEngine Ark for Doubao-1.5-thinking-vision-pro',
      ],
    ];

    cases.forEach(([provider, expected]) => {
      expect(provider).toBe(expected);
    });
  });
  it('should have correct value for Doubao provider', () => {
    expect(VLMProviderV2.doubao_1_5).toBe(
      'VolcEngine Ark for Doubao-1.5-Neura',
    );
  });

  it('should contain exactly five providers', () => {
    const providerCount = Object.keys(VLMProviderV2).length;
    expect(providerCount).toBe(5);
  });
});
