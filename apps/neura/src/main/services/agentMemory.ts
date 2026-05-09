/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SettingStore } from '@main/store/setting';
import { LocalStore } from '@main/store/types';

const rememberPattern = /\bremember\s+(?:that\s+)?(.{3,240})/i;

export function getAgentMemoryHint(settings: LocalStore) {
  const preferences = settings.agentMemory?.preferences || {};
  const entries = Object.entries(preferences).filter(
    ([, value]) => typeof value === 'string' && value.trim(),
  );

  if (!entries.length) {
    return '';
  }

  return [
    '\n\n## User Memory',
    '- Use these lightweight user preferences when relevant.',
    ...entries.slice(-12).map(([key, value]) => `- ${key}: ${value}`),
  ].join('\n');
}

export function rememberPreferenceFromInstruction(instructions: string) {
  const match = instructions.match(rememberPattern);
  if (!match?.[1]) {
    return;
  }

  const value = match[1].trim().replace(/[.。]\s*$/, '');
  if (!value) {
    return;
  }

  const settings = SettingStore.getStore();
  const preferences = settings.agentMemory?.preferences || {};
  SettingStore.set('agentMemory', {
    preferences: {
      ...preferences,
      [`note_${Date.now()}`]: value,
    },
    updatedAt: Date.now(),
  });
}
