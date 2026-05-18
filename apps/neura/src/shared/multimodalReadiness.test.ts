import { describe, expect, it } from 'vitest';

import {
  formatMultimodalReadinessReport,
  getMultimodalProviderReadiness,
  getMultimodalToolReadiness,
} from './multimodalReadiness';

describe('multimodal provider readiness', () => {
  it('reports missing setup without exposing provider secrets', () => {
    const readiness = getMultimodalProviderReadiness({
      image: {
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'secret-image-key',
      },
    });

    const image = readiness.find((item) => item.key === 'image');

    expect(image?.configured).toBe(false);
    expect(image?.missingFields).toEqual(['Model']);
    expect(image?.setupMessage).toContain('Settings > Multimodal');
    expect(JSON.stringify(readiness)).not.toContain('secret-image-key');
  });

  it('marks providers ready only when all required launch fields are present', () => {
    const readiness = getMultimodalToolReadiness('synthesize_speech', {
      textToSpeech: {
        baseUrl: 'https://audio.example.test/v1',
        apiKey: 'tts-key',
        model: 'voice-model',
      },
    });

    expect(readiness.configured).toBe(true);
    expect(readiness.missingFields).toEqual([]);
    expect(readiness.readyMessage).toContain('synthesize_speech');
  });

  it('formats an honest setup report for agent-visible checks', () => {
    const report = formatMultimodalReadinessReport({
      image: {
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'image-key',
        model: 'image-model',
      },
    });

    expect(report).toContain('Image generation: ready');
    expect(report).toContain('Speech to text: needs setup');
    expect(report).toContain(
      'Neura will not claim a media artifact was created',
    );
    expect(report).not.toContain('image-key');
  });
});
