/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SearchEngineForSettings } from '@main/store/types';

export const inferInitialBrowserUrl = (
  instructions: string,
  _searchEngine?: SearchEngineForSettings,
): string | null => {
  const normalized = instructions.trim();
  const explicitUrl = normalized.match(/\bhttps?:\/\/[^\s"'<>]+/i)?.[0];
  if (explicitUrl) {
    return explicitUrl;
  }

  const domain = normalized.match(
    /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\.[a-z]{2,})(?:\/[^\s"'<>]*)?/i,
  )?.[0];
  if (domain) {
    return domain;
  }

  const targetMatch = normalized.match(
    /\b(?:go to|open|navigate to|visit)\s+([a-z0-9][a-z0-9\s-]{1,60}?)(?=\s+(?:and|then|find|search|look|tell|show|check|give|get|with|for|in|on)\b|[.!?]|$)/i,
  );
  const target = targetMatch?.[1]
    ?.toLowerCase()
    .replace(/\b(?:website|site|page|app)\b/g, '')
    .replace(/[^a-z0-9-]+/g, '')
    .trim();

  if (target) {
    if (target.length < 2 || target.length > 40) {
      return null;
    }

    if (
      ['browser', 'internet', 'web', 'website', 'google', 'search'].includes(
        target,
      )
    ) {
      return target === 'google' ? 'google.com' : null;
    }

    return `${target}.com`;
  }

  return null;
};
