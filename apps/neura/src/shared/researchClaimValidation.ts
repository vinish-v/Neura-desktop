/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  EvidenceCompletionStatus,
  TaskEvidence,
} from './taskEvidence';

export type ResearchClaimType =
  | 'factual'
  | 'numeric'
  | 'recommendation'
  | 'speculative';

export type ClaimSupportStatus =
  | 'supported'
  | 'weakly_supported'
  | 'unsupported'
  | 'contradicted';

export type ClaimEvidenceRelationship =
  | 'supports'
  | 'contradicts'
  | 'mentions';

export type ResearchClaim = {
  id: string;
  text: string;
  type: ResearchClaimType;
  sourceText?: string;
  metadata?: Record<string, unknown>;
};

export type ClaimEvidenceLink = {
  claimId: string;
  evidenceId: string;
  relationship: ClaimEvidenceRelationship;
  domain?: string;
  url?: string;
  quote?: string;
  sourceQualityScore?: number;
  sourceQualityTier?: 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
};

export type ClaimValidationItem = {
  claim: ResearchClaim;
  status: ClaimSupportStatus;
  requiredIndependentSources: number;
  supportingLinks: ClaimEvidenceLink[];
  contradictingLinks: ClaimEvidenceLink[];
  independentSupportCount: number;
  missingEvidence: string[];
};

export type ClaimValidationResult = {
  completionStatus: EvidenceCompletionStatus;
  confidence: number;
  overallStatus: ClaimSupportStatus;
  claims: ClaimValidationItem[];
  missingEvidence: string[];
  safeEvidenceLinks: ClaimEvidenceLink[];
  checkedAt: number;
};

export type ClaimValidationInput = {
  finalAnswer?: string;
  claims?: Array<Partial<ResearchClaim> & { text: string }>;
  evidence: TaskEvidence[];
  evidenceLinks?: ClaimEvidenceLink[];
};

const SECRET_KEY_PATTERN =
  /(api[-_]?key|token|password|passwd|secret|authorization|cookie|session|credential|client[-_]?secret)/i;
const SECRET_VALUE_PATTERN =
  /\b(api[-_]?key|token|password|passwd|secret|authorization|cookie|client[-_]?secret)\s*[:=]\s*["']?[^"',\s}]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const NUMBER_PATTERN =
  /(?:\b\d+(?:[.,]\d+)*(?:\.\d+)?\b|[$€£]\s*\d+|\b\d+\s*(?:%|percent|million|billion|trillion|k|m|bn)\b)/i;
const RECOMMENDATION_PATTERN =
  /\b(should|recommend|recommendation|best|better|top|rank|choose|prefer|must|worth|avoid)\b/i;
const SPECULATIVE_PATTERN =
  /\b(may|might|could|possibly|likely|unlikely|estimate|forecast|projected|projection|expected|appears|suggests)\b/i;
const WORD_PATTERN = /[a-z0-9]{4,}/gi;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const redactString = (value: string) =>
  value
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_VALUE_PATTERN, '$1=[REDACTED]');

const redactClaimValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactClaimValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactClaimValue(item),
      ]),
    );
  }
  return value;
};

const hostnameFromUrl = (url?: string) => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

export const classifyResearchClaim = (text: string): ResearchClaimType => {
  if (RECOMMENDATION_PATTERN.test(text)) {
    return 'recommendation';
  }
  if (NUMBER_PATTERN.test(text)) {
    return 'numeric';
  }
  if (SPECULATIVE_PATTERN.test(text)) {
    return 'speculative';
  }
  return 'factual';
};

const normalizeClaim = (
  claim: Partial<ResearchClaim> & { text: string },
  index: number,
): ResearchClaim => ({
  id: claim.id || `claim-${index + 1}`,
  text: String(redactClaimValue(claim.text)).trim(),
  type: claim.type || classifyResearchClaim(claim.text),
  sourceText: claim.sourceText,
  metadata: redactClaimValue(claim.metadata || {}) as Record<string, unknown>,
});

const sentenceClaimsFromAnswer = (finalAnswer?: string): ResearchClaim[] =>
  (finalAnswer || '')
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.replace(/^[-*]\s*/, '').trim())
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => !/^(source|sources|citation|citations):?$/i.test(sentence))
    .slice(0, 12)
    .map((text, index) => normalizeClaim({ text }, index));

const wordsFor = (text: string) =>
  new Set((text.toLowerCase().match(WORD_PATTERN) || []).slice(0, 80));

const lexicalOverlap = (left: string, right: string) => {
  const leftWords = wordsFor(left);
  if (leftWords.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const word of wordsFor(right)) {
    if (leftWords.has(word)) {
      matches += 1;
    }
  }
  return matches / leftWords.size;
};

const sourceQualityConfidence = (link: ClaimEvidenceLink) => {
  if (typeof link.sourceQualityScore === 'number') {
    return clamp01(link.sourceQualityScore / 100);
  }
  if (link.sourceQualityTier === 'high') {
    return 0.9;
  }
  if (link.sourceQualityTier === 'medium') {
    return 0.7;
  }
  if (link.sourceQualityTier === 'low') {
    return 0.4;
  }
  return 0.55;
};

const isMediumOrBetterLink = (link: ClaimEvidenceLink) =>
  link.sourceQualityTier === 'high' ||
  link.sourceQualityTier === 'medium' ||
  sourceQualityConfidence(link) >= 0.54;

const requiredIndependentSourcesFor = (claim: ResearchClaim) =>
  claim.type === 'numeric' || claim.type === 'recommendation' ? 2 : 1;

const autoLinkEvidence = (
  claims: ResearchClaim[],
  evidence: TaskEvidence[],
): ClaimEvidenceLink[] => {
  const links: ClaimEvidenceLink[] = [];
  const citationEvidence = evidence.filter(
    (item) => item.kind === 'citation_source' && item.status !== 'failed',
  );

  for (const claim of claims) {
    for (const item of citationEvidence) {
      const searchable = [
        item.summary,
        item.title,
        item.sourceName,
        item.excerpt,
        item.url,
        item.metadata ? JSON.stringify(redactClaimValue(item.metadata)) : '',
      ]
        .filter(Boolean)
        .join('\n');
      const explicitClaimIds =
        item.metadata &&
        Array.isArray((item.metadata as Record<string, unknown>).claimIds)
          ? ((item.metadata as Record<string, unknown>).claimIds as unknown[])
          : [];
      const explicitlyLinked = explicitClaimIds.includes(claim.id);
      const overlap = lexicalOverlap(claim.text, searchable);

      if (explicitlyLinked || overlap >= 0.32) {
        links.push({
          claimId: claim.id,
          evidenceId: item.id,
          relationship: 'supports',
          domain: hostnameFromUrl(item.url),
          url: item.url,
          quote: item.excerpt,
          sourceQualityScore: item.sourceQualityScore,
          sourceQualityTier: item.sourceQualityTier,
          metadata: {
            autoLinked: !explicitlyLinked,
            overlap: Number(overlap.toFixed(2)),
          },
        });
      }
    }
  }

  return links;
};

const sanitizeEvidenceLink = (link: ClaimEvidenceLink): ClaimEvidenceLink => ({
  ...link,
  domain: link.domain || hostnameFromUrl(link.url),
  quote:
    typeof link.quote === 'string'
      ? (redactClaimValue(link.quote) as string)
      : undefined,
  metadata: redactClaimValue(link.metadata || {}) as Record<string, unknown>,
});

const chooseOverallStatus = (
  items: ClaimValidationItem[],
): ClaimSupportStatus => {
  if (items.some((item) => item.status === 'contradicted')) {
    return 'contradicted';
  }
  if (items.some((item) => item.status === 'unsupported')) {
    return 'unsupported';
  }
  if (items.some((item) => item.status === 'weakly_supported')) {
    return 'weakly_supported';
  }
  return 'supported';
};

const completionStatusFor = (
  overallStatus: ClaimSupportStatus,
): EvidenceCompletionStatus => {
  if (overallStatus === 'contradicted') {
    return 'blocked';
  }
  if (overallStatus === 'supported') {
    return 'verified';
  }
  return 'needs_verification';
};

export const validateResearchClaims = ({
  finalAnswer,
  claims: explicitClaims,
  evidence,
  evidenceLinks,
}: ClaimValidationInput): ClaimValidationResult => {
  const claims = explicitClaims?.length
    ? explicitClaims.map(normalizeClaim)
    : sentenceClaimsFromAnswer(finalAnswer);
  const safeEvidenceLinks = [
    ...(evidenceLinks || []),
    ...autoLinkEvidence(claims, evidence),
  ].map(sanitizeEvidenceLink);

  const validationItems: ClaimValidationItem[] = claims.map((claim) => {
    const linksForClaim = safeEvidenceLinks.filter(
      (link) => link.claimId === claim.id,
    );
    const supportingLinks = linksForClaim.filter(
      (link) => link.relationship === 'supports',
    );
    const contradictingLinks = linksForClaim.filter(
      (link) => link.relationship === 'contradicts',
    );
    const requiredIndependentSources = requiredIndependentSourcesFor(claim);
    const independentDomains = new Set(
      supportingLinks
        .filter(isMediumOrBetterLink)
        .map((link) => link.domain || link.evidenceId)
        .filter(Boolean),
    );
    const independentSupportCount = independentDomains.size;
    const missingEvidence: string[] = [];
    let status: ClaimSupportStatus = 'supported';

    if (contradictingLinks.length > 0) {
      status = 'contradicted';
      missingEvidence.push(
        `Claim "${claim.text}" has contradictory evidence and needs correction.`,
      );
    } else if (supportingLinks.length === 0) {
      status = 'unsupported';
      missingEvidence.push(
        `Claim "${claim.text}" has no linked citation evidence.`,
      );
    } else if (independentSupportCount < requiredIndependentSources) {
      status = 'weakly_supported';
      missingEvidence.push(
        `Claim "${claim.text}" needs ${requiredIndependentSources} independent medium-or-better source${
          requiredIndependentSources === 1 ? '' : 's'
        }; found ${independentSupportCount}.`,
      );
    }

    return {
      claim,
      status,
      requiredIndependentSources,
      supportingLinks,
      contradictingLinks,
      independentSupportCount,
      missingEvidence,
    };
  });

  const missingEvidence = validationItems.flatMap(
    (item) => item.missingEvidence,
  );
  const overallStatus =
    validationItems.length === 0
      ? 'unsupported'
      : chooseOverallStatus(validationItems);
  if (validationItems.length === 0) {
    missingEvidence.push('No user-facing research claims were available to validate.');
  }

  const completionStatus = completionStatusFor(overallStatus);
  const supportConfidence =
    validationItems.length > 0
      ? validationItems.reduce((sum, item) => {
          if (item.status === 'supported') {
            return sum + 0.9;
          }
          if (item.status === 'weakly_supported') {
            return sum + 0.55;
          }
          return sum;
        }, 0) / validationItems.length
      : 0;
  const confidence =
    completionStatus === 'verified'
      ? Math.max(0.7, supportConfidence)
      : completionStatus === 'needs_verification'
        ? Math.min(0.69, supportConfidence)
        : 0;

  return {
    completionStatus,
    confidence: Number(clamp01(confidence).toFixed(2)),
    overallStatus,
    claims: validationItems,
    missingEvidence,
    safeEvidenceLinks,
    checkedAt: Date.now(),
  };
};
