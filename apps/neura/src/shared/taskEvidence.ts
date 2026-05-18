/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ClaimValidationResult } from './researchClaimValidation';
import { validateResearchClaims } from './researchClaimValidation';

export type TaskEvidenceKind =
  | 'citation_source'
  | 'file_artifact'
  | 'browser_snapshot'
  | 'command_test'
  | 'connector_action';

export type EvidenceCompletionStatus =
  | 'blocked'
  | 'needs_verification'
  | 'verified';

export type TaskEvidenceStatus = 'pending' | 'completed' | 'failed';

export type TaskEvidence = {
  id: string;
  kind: TaskEvidenceKind;
  summary: string;
  status?: TaskEvidenceStatus;
  confidence?: number;
  capturedAt?: number;
  url?: string;
  title?: string;
  sourceName?: string;
  excerpt?: string;
  sourceQualityScore?: number;
  sourceQualityTier?: 'high' | 'medium' | 'low';
  path?: string;
  artifactKind?: string;
  command?: string;
  connectorName?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
};

export type TaskEvidenceRequirements = {
  requireEvidence?: boolean;
  requireCitationSource?: boolean;
  minimumCitationSources?: number;
  minimumMediumConfidenceSources?: number;
  validateResearchClaims?: boolean;
  requireFileArtifact?: boolean;
  acceptedArtifactKinds?: string[];
  requireBrowserSnapshot?: boolean;
  requireCommandTest?: boolean;
  requireConnectorEvidence?: boolean;
};

export type TaskEvidenceValidationInput = {
  claim?: string;
  evidence: TaskEvidence[];
  requirements?: TaskEvidenceRequirements;
  knownFailures?: string[];
};

export type TaskEvidenceValidationResult = {
  completionStatus: EvidenceCompletionStatus;
  confidence: number;
  missingEvidence: string[];
  agentFacingMessage: string;
  evidenceChecklist: Array<{
    label: string;
    satisfied: boolean;
    evidenceIds: string[];
  }>;
  safeEvidence: TaskEvidence[];
  claimValidation?: ClaimValidationResult;
  checkedAt: number;
};

const SECRET_KEY_PATTERN =
  /(api[-_]?key|token|password|passwd|secret|authorization|cookie|session|credential|client[-_]?secret)/i;
const SECRET_VALUE_PATTERN =
  /\b(api[-_]?key|token|password|passwd|secret|authorization|cookie|client[-_]?secret)\s*[:=]\s*["']?[^"',\s}]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const redactString = (value: string) =>
  value
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_VALUE_PATTERN, '$1=[REDACTED]');

export const redactEvidenceSecrets = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactEvidenceSecrets(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactEvidenceSecrets(item),
      ]),
    );
  }
  return value;
};

export const sanitizeTaskEvidence = (evidence: TaskEvidence): TaskEvidence => {
  const redacted = redactEvidenceSecrets(evidence) as TaskEvidence;
  return {
    ...redacted,
    confidence:
      typeof redacted.confidence === 'number'
        ? clamp01(redacted.confidence)
        : undefined,
  };
};

const evidenceConfidence = (evidence: TaskEvidence) => {
  if (evidence.status === 'failed') {
    return 0;
  }
  if (typeof evidence.confidence === 'number') {
    return clamp01(evidence.confidence);
  }
  if (typeof evidence.sourceQualityScore === 'number') {
    return clamp01(evidence.sourceQualityScore / 100);
  }
  if (evidence.status === 'pending') {
    return 0.25;
  }
  return 0.8;
};

const isMediumOrBetterSource = (evidence: TaskEvidence) =>
  evidence.kind === 'citation_source' &&
  (evidence.sourceQualityTier === 'high' ||
    evidence.sourceQualityTier === 'medium' ||
    evidenceConfidence(evidence) >= 0.54);

const hasAcceptedArtifactKind = (
  evidence: TaskEvidence,
  acceptedArtifactKinds?: string[],
) =>
  evidence.kind === 'file_artifact' &&
  (!acceptedArtifactKinds?.length ||
    acceptedArtifactKinds.includes(evidence.artifactKind || ''));

const buildAgentFacingMessage = (
  completionStatus: EvidenceCompletionStatus,
  missingEvidence: string[],
) => {
  if (completionStatus === 'verified') {
    return 'Evidence is sufficient. You may state the task is complete and cite the recorded proof.';
  }
  if (completionStatus === 'blocked') {
    return `Do not claim completion. Explain the blocker and ask for a retry or missing evidence: ${missingEvidence.join(
      '; ',
    )}`;
  }
  return `Do not say the task is complete yet. Tell the user which evidence is missing: ${missingEvidence.join(
    '; ',
  )}`;
};

export const validateTaskEvidence = ({
  claim,
  evidence,
  requirements = {},
  knownFailures = [],
}: TaskEvidenceValidationInput): TaskEvidenceValidationResult => {
  const safeEvidence = evidence.map(sanitizeTaskEvidence);
  const claimValidation = requirements.validateResearchClaims
    ? validateResearchClaims({
        finalAnswer: claim,
        evidence: safeEvidence,
      })
    : undefined;
  const missingEvidence: string[] = [];
  const blockingFailures = knownFailures
    .map((failure) => String(redactEvidenceSecrets(failure || '')).trim())
    .filter(Boolean);
  const evidenceChecklist: TaskEvidenceValidationResult['evidenceChecklist'] =
    [];
  const addChecklist = (
    label: string,
    satisfied: boolean,
    matches: TaskEvidence[],
  ) => {
    evidenceChecklist.push({
      label,
      satisfied,
      evidenceIds: matches.map((item) => item.id),
    });
    if (!satisfied) {
      missingEvidence.push(label);
    }
  };

  if (!(claim || '').trim()) {
    blockingFailures.push('A user-facing completion claim or final answer is missing.');
  }

  const completedEvidence = safeEvidence.filter(
    (item) => item.status !== 'failed',
  );
  const failedEvidence = safeEvidence.filter((item) => item.status === 'failed');
  if (failedEvidence.length > 0) {
    blockingFailures.push(
      `Recorded evidence failed: ${failedEvidence
        .map((item) => item.summary || item.toolName || item.id)
        .join(', ')}`,
    );
  }

  if (requirements.requireEvidence !== false) {
    addChecklist(
      'Attach at least one source, artifact, browser, command, or connector evidence record.',
      completedEvidence.length > 0,
      completedEvidence,
    );
  }

  if (requirements.requireCitationSource) {
    const sourceEvidence = completedEvidence.filter(
      (item) => item.kind === 'citation_source',
    );
    const minimum = requirements.minimumCitationSources || 1;
    addChecklist(
      `Record at least ${minimum} citation/source evidence item${
        minimum === 1 ? '' : 's'
      }.`,
      sourceEvidence.length >= minimum,
      sourceEvidence,
    );

    if (requirements.minimumMediumConfidenceSources) {
      const mediumSources = sourceEvidence.filter(isMediumOrBetterSource);
      addChecklist(
        `Record at least ${requirements.minimumMediumConfidenceSources} medium-or-better source evidence item${
          requirements.minimumMediumConfidenceSources === 1 ? '' : 's'
        }.`,
        mediumSources.length >= requirements.minimumMediumConfidenceSources,
        mediumSources,
      );
    }
  }

  if (claimValidation) {
    evidenceChecklist.push({
      label: 'Validate each user-facing research claim against linked citation evidence.',
      satisfied: claimValidation.completionStatus === 'verified',
      evidenceIds: claimValidation.safeEvidenceLinks.map(
        (link) => link.evidenceId,
      ),
    });
    if (claimValidation.completionStatus === 'blocked') {
      blockingFailures.push(...claimValidation.missingEvidence);
    } else if (claimValidation.completionStatus === 'needs_verification') {
      missingEvidence.push(...claimValidation.missingEvidence);
    }
  }

  if (requirements.requireFileArtifact) {
    const artifactEvidence = completedEvidence.filter((item) =>
      hasAcceptedArtifactKind(item, requirements.acceptedArtifactKinds),
    );
    addChecklist(
      requirements.acceptedArtifactKinds?.length
        ? `Save a file artifact matching: ${requirements.acceptedArtifactKinds.join(
            ', ',
          )}.`
        : 'Save a file artifact for the completed work product.',
      artifactEvidence.length > 0,
      artifactEvidence,
    );
  }

  if (requirements.requireBrowserSnapshot) {
    const browserEvidence = completedEvidence.filter(
      (item) => item.kind === 'browser_snapshot',
    );
    addChecklist(
      'Record browser/page evidence for the claim.',
      browserEvidence.length > 0,
      browserEvidence,
    );
  }

  if (requirements.requireCommandTest) {
    const commandEvidence = completedEvidence.filter(
      (item) => item.kind === 'command_test',
    );
    addChecklist(
      'Record a completed command or test result.',
      commandEvidence.length > 0,
      commandEvidence,
    );
  }

  if (requirements.requireConnectorEvidence) {
    const connectorEvidence = completedEvidence.filter(
      (item) => item.kind === 'connector_action',
    );
    addChecklist(
      'Record connector action evidence.',
      connectorEvidence.length > 0,
      connectorEvidence,
    );
  }

  const completionStatus: EvidenceCompletionStatus =
    blockingFailures.length > 0
      ? 'blocked'
      : missingEvidence.length > 0
        ? 'needs_verification'
        : 'verified';
  const usableConfidence = completedEvidence.map(evidenceConfidence);
  const averageConfidence =
    usableConfidence.length > 0
      ? usableConfidence.reduce((sum, value) => sum + value, 0) /
        usableConfidence.length
      : 0;
  const evidenceConfidenceScore =
    completionStatus === 'verified'
      ? Math.max(0.7, averageConfidence)
      : completionStatus === 'needs_verification'
        ? Math.min(0.69, averageConfidence)
        : 0;
  const confidence =
    claimValidation && completionStatus !== 'blocked'
      ? Math.min(evidenceConfidenceScore, claimValidation.confidence)
      : evidenceConfidenceScore;
  const allMissingEvidence = [...blockingFailures, ...missingEvidence];

  return {
    completionStatus,
    confidence: Number(clamp01(confidence).toFixed(2)),
    missingEvidence: allMissingEvidence,
    agentFacingMessage: buildAgentFacingMessage(
      completionStatus,
      allMissingEvidence,
    ),
    evidenceChecklist,
    safeEvidence,
    claimValidation,
    checkedAt: Date.now(),
  };
};
