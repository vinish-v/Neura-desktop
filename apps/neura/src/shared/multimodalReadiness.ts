/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export type MultimodalProviderKey =
  | 'image'
  | 'speechToText'
  | 'textToSpeech'
  | 'video';

export type MultimodalProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
};

export type MultimodalProvidersConfig = Partial<
  Record<MultimodalProviderKey, MultimodalProviderConfig>
>;

export type MultimodalProviderReadiness = {
  key: MultimodalProviderKey;
  title: string;
  toolName: string;
  configured: boolean;
  missingFields: string[];
  setupMessage: string;
  readyMessage: string;
};

export const MULTIMODAL_PROVIDER_DEFINITIONS: Array<{
  key: MultimodalProviderKey;
  title: string;
  toolName: string;
  requiredFields: Array<keyof MultimodalProviderConfig>;
}> = [
  {
    key: 'image',
    title: 'Image generation',
    toolName: 'generate_image',
    requiredFields: ['baseUrl', 'apiKey', 'model'],
  },
  {
    key: 'speechToText',
    title: 'Speech to text',
    toolName: 'transcribe_audio',
    requiredFields: ['baseUrl', 'apiKey', 'model'],
  },
  {
    key: 'textToSpeech',
    title: 'Text to speech',
    toolName: 'synthesize_speech',
    requiredFields: ['baseUrl', 'apiKey', 'model'],
  },
  {
    key: 'video',
    title: 'Video understanding',
    toolName: 'analyze_video',
    requiredFields: ['baseUrl', 'apiKey', 'model'],
  },
];

const FIELD_LABELS: Record<keyof MultimodalProviderConfig, string> = {
  baseUrl: 'Base URL',
  apiKey: 'API key',
  model: 'Model',
  voice: 'Voice',
};

const clean = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const joinHumanList = (items: string[]) => {
  if (items.length <= 1) {
    return items[0] || '';
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

export const getMultimodalProviderReadiness = (
  providers: MultimodalProvidersConfig = {},
): MultimodalProviderReadiness[] =>
  MULTIMODAL_PROVIDER_DEFINITIONS.map((definition) => {
    const config = providers[definition.key] || {};
    const missingFields = definition.requiredFields
      .filter((field) => !clean(config[field]))
      .map((field) => FIELD_LABELS[field]);
    const configured = missingFields.length === 0;
    const missingText = joinHumanList(missingFields);

    return {
      key: definition.key,
      title: definition.title,
      toolName: definition.toolName,
      configured,
      missingFields,
      readyMessage: `${definition.title} is ready for ${definition.toolName}.`,
      setupMessage: configured
        ? `${definition.title} is ready for ${definition.toolName}.`
        : `${definition.title} is not configured. Add ${missingText} in Settings > Multimodal before using ${definition.toolName}. Neura will not claim a media artifact was created until a configured provider returns real output.`,
    };
  });

export const getMultimodalToolReadiness = (
  toolName: string,
  providers: MultimodalProvidersConfig = {},
) => {
  const readiness = getMultimodalProviderReadiness(providers).find(
    (item) => item.toolName === toolName,
  );
  if (!readiness) {
    throw new Error(`Unknown multimodal tool: ${toolName}`);
  }
  return readiness;
};

export const formatMultimodalReadinessReport = (
  providers: MultimodalProvidersConfig = {},
) =>
  getMultimodalProviderReadiness(providers)
    .map((item) => {
      const status = item.configured ? 'ready' : 'needs setup';
      return `${item.title}: ${status}. ${
        item.configured ? item.readyMessage : item.setupMessage
      }`;
    })
    .join('\n');
