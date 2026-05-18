/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ArtifactKind,
  HermesTaskMode,
} from '@main/store/types';
import { LocalStore } from '@main/store/validate';
import {
  IntentRiskLevel,
  SemanticIntentContract,
  SemanticTaskType,
} from '@shared/intentClassification';

import {
  classifyHermesTask,
  HermesTaskRoute,
} from './hermesTaskRouter';

type PlannerArbitrationProposal = {
  taskType?: SemanticTaskType;
  requiredTools?: SemanticIntentContract['requiredTools'];
  expectedArtifacts?: string[];
  riskLevel?: IntentRiskLevel;
  needsApproval?: boolean;
  verificationRequired?: boolean;
  completionProof?: SemanticIntentContract['completionProof'];
  reason?: string;
};

export type IntentArbitrationStatus =
  | {
      status: 'disabled' | 'not_configured' | 'skipped';
      usedModel: false;
      reason: string;
    }
  | {
      status: 'accepted' | 'rejected' | 'failed';
      usedModel: boolean;
      reason: string;
      proposedTaskType?: SemanticTaskType;
    };

const TASK_TYPE_TO_MODE: Partial<Record<SemanticTaskType, HermesTaskMode>> = {
  browser_operator: 'research',
  wide_research: 'research',
  shell_or_process: 'code',
  artifact_creation: 'general',
  slide_creation: 'general',
  website_build: 'code',
  app_development: 'code',
  connector_workflow: 'general',
  automation: 'scheduled_job',
};

const TASK_TYPE_TO_ARTIFACTS: Partial<Record<SemanticTaskType, ArtifactKind[]>> =
  {
    artifact_creation: ['document', 'report', 'data'],
    slide_creation: ['presentation'],
    website_build: ['website', 'archive', 'report', 'other'],
    app_development: ['website', 'archive', 'report', 'other'],
    multimodal_creation: ['image', 'audio', 'video'],
  };

const RISK_ORDER: Record<IntentRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const COMPLETION_PROOF_ORDER: Record<
  SemanticIntentContract['completionProof'],
  number
> = {
  none: 0,
  final_answer: 1,
  sources: 2,
  local_action: 2,
  connector_audit: 3,
  artifacts: 3,
  mixed: 4,
};

const MODEL_UPGRADABLE_TASK_TYPES: SemanticTaskType[] = [
  'browser_operator',
  'wide_research',
  'local_computer',
  'shell_or_process',
  'artifact_creation',
  'slide_creation',
  'website_build',
  'app_development',
  'design_creation',
  'multimodal_creation',
  'connector_workflow',
  'automation',
  'mixed_workflow',
];

const unique = <T>(items: T[]) => [...new Set(items)];

const hasPlannerConfig = (settings: LocalStore) => {
  const baseUrl = (settings.plannerBaseUrl || settings.vlmBaseUrl || '').trim();
  const apiKey = (settings.plannerApiKey || settings.vlmApiKey || '').trim();
  const model = (
    settings.usePlannerModel !== false && settings.plannerModelName?.trim()
      ? settings.plannerModelName
      : settings.vlmModelName
  )?.trim();
  return { baseUrl, apiKey, model };
};

const normalizeCompletionProof = (value: unknown) => {
  const text = typeof value === 'string' ? value : '';
  return text in COMPLETION_PROOF_ORDER
    ? (text as SemanticIntentContract['completionProof'])
    : undefined;
};

const normalizeRisk = (value: unknown) => {
  const text = typeof value === 'string' ? value : '';
  return text in RISK_ORDER ? (text as IntentRiskLevel) : undefined;
};

const normalizeTaskType = (value: unknown) => {
  const text = typeof value === 'string' ? value : '';
  return [
    'conversation',
    'answer',
    ...MODEL_UPGRADABLE_TASK_TYPES,
  ].includes(text)
    ? (text as SemanticTaskType)
    : undefined;
};

const parseJsonObject = (text: string) => {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed)?.[1];
  const candidate = fenced || trimmed;
  const objectText = /\{[\s\S]*\}/u.exec(candidate)?.[0] || candidate;
  return JSON.parse(objectText) as Record<string, unknown>;
};

const callPlanner = async (
  goal: string,
  deterministic: HermesTaskRoute,
  settings: LocalStore,
): Promise<PlannerArbitrationProposal> => {
  const { baseUrl, apiKey, model } = hasPlannerConfig(settings);
  if (!baseUrl || !apiKey || !model) {
    throw new Error('Planner model is not configured.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    settings.plannerTimeoutInMs || 90_000,
  );
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You arbitrate Neura Desktop task intent. Return only JSON. Never hide setup gaps. Prefer tool use when the user asks for current web data, local files/apps, connectors, automations, artifacts, or external writes.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              goal,
              deterministic: {
                taskMode: deterministic.taskMode,
                runMode: deterministic.runMode,
                contract: deterministic.semanticContract,
                requiredArtifactKinds: deterministic.requiredArtifactKinds,
                requiresSource: deterministic.requiresSource,
                requiresBrowser: deterministic.requiresBrowser,
              },
              schema: {
                taskType:
                  'conversation|answer|browser_operator|wide_research|local_computer|shell_or_process|artifact_creation|slide_creation|website_build|app_development|design_creation|multimodal_creation|connector_workflow|automation|mixed_workflow',
                requiredTools:
                  'array of browser|shell|files|local_app|documents|website|multimodal|connectors|scheduler',
                expectedArtifacts: 'array of strings',
                riskLevel: 'low|medium|high',
                needsApproval: 'boolean',
                verificationRequired: 'boolean',
                completionProof:
                  'none|final_answer|sources|artifacts|local_action|connector_audit|mixed',
                reason: 'short reason',
              },
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `Planner arbitration failed with HTTP ${response.status}: ${raw.slice(0, 500)}`,
      );
    }
    const parsed = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Planner arbitration returned no message content.');
    }
    const proposal = parseJsonObject(content);
    return {
      taskType: normalizeTaskType(proposal.taskType),
      requiredTools: Array.isArray(proposal.requiredTools)
        ? (proposal.requiredTools.filter((item) =>
            [
              'browser',
              'shell',
              'files',
              'local_app',
              'documents',
              'website',
              'multimodal',
              'connectors',
              'scheduler',
            ].includes(String(item)),
          ) as SemanticIntentContract['requiredTools'])
        : undefined,
      expectedArtifacts: Array.isArray(proposal.expectedArtifacts)
        ? proposal.expectedArtifacts
            .map((item) => String(item).trim())
            .filter(Boolean)
        : undefined,
      riskLevel: normalizeRisk(proposal.riskLevel),
      needsApproval:
        typeof proposal.needsApproval === 'boolean'
          ? proposal.needsApproval
          : undefined,
      verificationRequired:
        typeof proposal.verificationRequired === 'boolean'
          ? proposal.verificationRequired
          : undefined,
      completionProof: normalizeCompletionProof(proposal.completionProof),
      reason:
        typeof proposal.reason === 'string' ? proposal.reason.trim() : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const isSafeTaskTypeUpgrade = (
  current: SemanticTaskType,
  proposed?: SemanticTaskType,
) => {
  if (!proposed || proposed === current) {
    return false;
  }
  if (current === 'conversation' || current === 'answer') {
    return MODEL_UPGRADABLE_TASK_TYPES.includes(proposed);
  }
  if (current === 'browser_operator') {
    return ['wide_research', 'mixed_workflow'].includes(proposed);
  }
  if (current === 'artifact_creation') {
    return ['slide_creation', 'website_build', 'mixed_workflow'].includes(
      proposed,
    );
  }
  return proposed === 'mixed_workflow';
};

const mergeContract = (
  deterministic: SemanticIntentContract,
  proposal: PlannerArbitrationProposal,
) => {
  const acceptedTaskType: SemanticTaskType = proposal.taskType && isSafeTaskTypeUpgrade(
    deterministic.taskType,
    proposal.taskType,
  )
    ? proposal.taskType
    : deterministic.taskType;
  const proposedRisk = proposal.riskLevel || deterministic.riskLevel;
  const proposedProof = proposal.completionProof || deterministic.completionProof;
  return {
    ...deterministic,
    taskType: acceptedTaskType,
    requiredTools: unique([
      ...deterministic.requiredTools,
      ...(proposal.requiredTools || []),
    ]),
    expectedArtifacts: unique([
      ...deterministic.expectedArtifacts,
      ...(proposal.expectedArtifacts || []),
    ]),
    riskLevel:
      RISK_ORDER[proposedRisk] > RISK_ORDER[deterministic.riskLevel]
        ? proposedRisk
        : deterministic.riskLevel,
    needsApproval: deterministic.needsApproval || proposal.needsApproval === true,
    verificationRequired:
      deterministic.verificationRequired ||
      proposal.verificationRequired === true,
    completionProof:
      COMPLETION_PROOF_ORDER[proposedProof] >
      COMPLETION_PROOF_ORDER[deterministic.completionProof]
        ? proposedProof
        : deterministic.completionProof,
  } satisfies SemanticIntentContract;
};

const routeForContract = (
  route: HermesTaskRoute,
  contract: SemanticIntentContract,
) => {
  const taskMode = TASK_TYPE_TO_MODE[contract.taskType] || route.taskMode;
  const requiredArtifactKinds = unique([
    ...route.requiredArtifactKinds,
    ...(TASK_TYPE_TO_ARTIFACTS[contract.taskType] || []),
  ]);
  return {
    ...route,
    taskMode,
    runMode:
      contract.taskType === 'wide_research'
        ? 'wide_research'
        : route.runMode,
    requiredArtifactKinds,
    requiresSource:
      route.requiresSource ||
      contract.completionProof === 'sources' ||
      contract.completionProof === 'mixed' ||
      contract.taskType === 'wide_research' ||
      contract.taskType === 'browser_operator',
    requiresBrowser:
      route.requiresBrowser ||
      contract.requiredTools.includes('browser') ||
      contract.taskType === 'browser_operator' ||
      contract.taskType === 'wide_research',
    semanticContract: contract,
    riskLevel: contract.riskLevel,
  } satisfies HermesTaskRoute;
};

export const classifyHermesTaskWithArbitration = async (
  goal: string,
  settings: LocalStore,
  overrideRunMode?: HermesTaskRoute['runMode'],
  overrideToolsets?: string[],
): Promise<HermesTaskRoute> => {
  const deterministic = classifyHermesTask(
    goal,
    settings,
    overrideRunMode,
    overrideToolsets,
  );
  if (overrideRunMode || overrideToolsets?.length) {
    return {
      ...deterministic,
      intentArbitration: {
        status: 'skipped',
        usedModel: false,
        reason: 'Explicit run-mode or toolset override was supplied.',
      },
    };
  }
  if (settings.usePlannerModel === false) {
    return {
      ...deterministic,
      intentArbitration: {
        status: 'disabled',
        usedModel: false,
        reason: 'Planner model use is disabled in settings.',
      },
    };
  }
  const config = hasPlannerConfig(settings);
  if (!config.baseUrl || !config.apiKey || !config.model) {
    return {
      ...deterministic,
      intentArbitration: {
        status: 'not_configured',
        usedModel: false,
        reason:
          'Planner model arbitration skipped because base URL, API key, or model is missing.',
      },
    };
  }

  try {
    const proposal = await callPlanner(goal, deterministic, settings);
    const mergedContract = mergeContract(
      deterministic.semanticContract,
      proposal,
    );
    const accepted =
      JSON.stringify(mergedContract) !==
      JSON.stringify(deterministic.semanticContract);
    const routed = routeForContract(deterministic, mergedContract);
    return {
      ...routed,
      promptDirectives: [
        ...routed.promptDirectives,
        accepted
          ? `Planner intent arbitration accepted: ${proposal.reason || 'raised routing/proof requirements safely'}.`
          : `Planner intent arbitration rejected unsafe or redundant changes: ${proposal.reason || 'no safe upgrade proposed'}.`,
      ],
      intentArbitration: {
        status: accepted ? 'accepted' : 'rejected',
        usedModel: true,
        reason: proposal.reason || 'Planner response processed.',
        proposedTaskType: proposal.taskType,
      },
    };
  } catch (error) {
    return {
      ...deterministic,
      promptDirectives: [
        ...deterministic.promptDirectives,
        `Planner intent arbitration failed; deterministic safety route is being used. ${error instanceof Error ? error.message : String(error)}`,
      ],
      intentArbitration: {
        status: 'failed',
        usedModel: true,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
