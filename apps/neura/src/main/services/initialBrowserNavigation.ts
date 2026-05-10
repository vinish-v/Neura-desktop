/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SearchEngineForSettings } from '@main/store/types';

const LOCAL_COMPUTER_TASK_PATTERN =
  /\b(desktop|downloads?|documents?|folder|directory|file|notepad|vs\s*code|visual studio code|terminal|shell|command|powershell|cmd|\.exe)\b/i;

const WEB_LOOKUP_PATTERN =
  /\b(search|look\s+up|lookup|find online|google|bing|latest|current|today|now|news|weather|price|stock|score|top\s+\d+|top|best|popular|trending|review|reviews|article|source|sources)\b/i;

const buildSearchUrl = (
  query: string,
  searchEngine = SearchEngineForSettings.GOOGLE,
) => {
  const encoded = encodeURIComponent(query.trim());
  if (!encoded) {
    return null;
  }

  switch (searchEngine) {
    case SearchEngineForSettings.BING:
      return `https://www.bing.com/search?q=${encoded}`;
    case SearchEngineForSettings.BAIDU:
      return `https://www.baidu.com/s?wd=${encoded}`;
    case SearchEngineForSettings.GOOGLE:
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
};

const normalizeLookupQuery = (instructions: string) =>
  instructions
    .replace(/^\s*please\s+/i, '')
    .replace(
      /^\s*(?:search(?:\s+(?:for|about))?|look\s+up|lookup|find(?:\s+(?:me|the))?|google|bing|give(?:\s+me)?|show(?:\s+me)?|tell(?:\s+me)?|open\s+(?:a\s+)?browser\s+and)\s+/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

export const inferInitialBrowserUrl = (
  instructions: string,
  searchEngine?: SearchEngineForSettings,
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

  if (
    WEB_LOOKUP_PATTERN.test(normalized) &&
    !LOCAL_COMPUTER_TASK_PATTERN.test(normalized)
  ) {
    return buildSearchUrl(normalizeLookupQuery(normalized), searchEngine);
  }

  return null;
};
