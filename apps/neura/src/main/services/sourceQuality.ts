/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TaskSourceQuality, TaskSourceRecord } from '@main/store/types';

const TRUSTED_SUFFIXES = ['.gov', '.edu'];
const STRONG_DOMAINS = [
  'who.int',
  'nih.gov',
  'sec.gov',
  'federalreserve.gov',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'github.com',
  'docs.github.com',
  'learn.microsoft.com',
  'developer.mozilla.org',
];
const WEAK_PATTERNS = [
  /utm_/i,
  /click|tracking|affiliate|referral/i,
  /\/amp\/?$/i,
];

const hostnameFromUrl = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

const clampScore = (score: number) => Math.max(0, Math.min(100, score));

export const scoreSourceQuality = (
  source: Pick<TaskSourceRecord, 'url' | 'title' | 'sourceName' | 'excerpt'>,
): TaskSourceQuality => {
  const reasons: string[] = [];
  const domain = hostnameFromUrl(source.url);
  let score = 45;

  if (/^https:\/\//i.test(source.url)) {
    score += 10;
    reasons.push('secure url');
  }
  if (domain) {
    score += 8;
    reasons.push(`domain: ${domain}`);
  }
  if (
    domain &&
    (TRUSTED_SUFFIXES.some((suffix) => domain.endsWith(suffix)) ||
      STRONG_DOMAINS.some(
        (strongDomain) =>
          domain === strongDomain || domain.endsWith(`.${strongDomain}`),
      ))
  ) {
    score += 22;
    reasons.push('institutional or developer source');
  }
  if (source.title?.trim()) {
    score += 6;
    reasons.push('title captured');
  }
  if (source.sourceName?.trim()) {
    score += 5;
    reasons.push('publisher captured');
  }
  if ((source.excerpt || '').trim().length >= 80) {
    score += 9;
    reasons.push('substantive excerpt');
  }
  if (WEAK_PATTERNS.some((pattern) => pattern.test(source.url))) {
    score -= 15;
    reasons.push('tracking or low-signal url pattern');
  }

  const normalizedScore = clampScore(score);
  return {
    score: normalizedScore,
    tier:
      normalizedScore >= 72
        ? 'high'
        : normalizedScore >= 54
          ? 'medium'
          : 'low',
    reasons,
    domain,
  };
};

export const summarizeSourceQuality = (sources: TaskSourceRecord[]) => {
  const quality = sources
    .map((source) => source.quality || scoreSourceQuality(source))
    .filter(Boolean);
  const sourceCount = quality.length;
  const scoreTotal = quality.reduce((sum, item) => sum + item.score, 0);
  return {
    sourceCount,
    highQualityCount: quality.filter((item) => item.tier === 'high').length,
    mediumOrBetterCount: quality.filter((item) => item.tier !== 'low').length,
    averageScore: sourceCount ? Math.round(scoreTotal / sourceCount) : 0,
    domains: [
      ...new Set(
        quality
          .map((item) => item.domain)
          .filter((domain): domain is string => Boolean(domain)),
      ),
    ].slice(0, 12),
  };
};
