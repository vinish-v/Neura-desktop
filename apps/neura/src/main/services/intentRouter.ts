/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI from 'openai';

import { logger } from '@main/logger';
import {
  AgentRunMode,
  LocalStore,
  Operator,
  TaskComplexity,
} from '@main/store/types';
import { classifyUserIntent } from '@shared/intentClassification';

export type IntentRouteMode = 'browser' | 'computer' | 'mixed';
export type IntentTaskType =
  | 'chat'
  | 'browser_research'
  | 'browser_navigation'
  | 'local_file'
  | 'local_app'
  | 'process'
  | 'artifact'
  | 'website'
  | 'multimodal'
  | 'connector'
  | 'mixed';
export type IntentRiskLevel = 'low' | 'medium' | 'high';

export type IntentRouteDecision = {
  mode: IntentRouteMode;
  operator: Operator;
  runMode: AgentRunMode;
  requiresValidation: boolean;
  complexity: TaskComplexity;
  taskType: IntentTaskType;
  requiredTools: string[];
  riskLevel: IntentRiskLevel;
  verificationRequired: boolean;
  expectedArtifacts: string[];
  confidence: number;
  reason: string;
  source: 'rules' | 'llm' | 'configured';
};

type BaseIntentDecision = Omit<
  IntentRouteDecision,
  | 'runMode'
  | 'requiresValidation'
  | 'complexity'
  | 'taskType'
  | 'requiredTools'
  | 'riskLevel'
  | 'verificationRequired'
  | 'expectedArtifacts'
>;

const complexBrowserPattern =
  /\b(latest|current|today|tonight|tomorrow|now|live|news|weather|forecast|research|summari[sz]e|compare|comparison|extract|scrape|source-backed|sources?|top result|top\s+\d+|best|popular|trending|article|ranking|ranked|details?|verify|price|prices|stock|stocks|crypto|score|scores|results?|official|review|reviews|table|tables|dataset|data|near me|available|book|tickets?)\b/i;

const executorBrowserPattern =
  /\b(research|summari[sz]e|compare|comparison|extract|scrape|source-backed|sources?|top result|top\s+\d+|best|popular|trending|article|ranking|ranked|details?|verify|official|review|reviews|table|tables|dataset|data|near me|available|book|tickets?)\b/i;

const wideResearchPattern =
  /\b(wide research|parallel research|research\s+\d+|analy[sz]e\s+(all|these|\d+)|compare\s+(all|these|\d+)|batch research|lead generation|prospects|competitors list)\b/i;

const websiteBuilderPattern =
  /\b(build|create|generate|make)\b.*\b(website|web app|landing page|vite app|react app|full-stack app|frontend app)\b/i;

const artifactWorkflowPattern =
  /\b(create|generate|make|build)\b.*\b(deck|slides?|pptx|presentation|report|pdf|docx|spreadsheet|xlsx|dashboard)\b/i;

const multimodalWorkflowPattern =
  /\b(generate image|create image|image generation|transcribe|speech to text|text to speech|voiceover|analy[sz]e video|video understanding)\b/i;

const localFilePattern =
  /\b(read|write|edit|create|make|save|delete|move|copy|zip|unzip|inspect)\b.*\b(file|folder|directory|docx|pdf|xlsx|csv|pptx|spreadsheet|document|downloads|desktop)\b/i;

const processPattern =
  /\b(run|start|stop|restart|install|build|test|serve|server|watcher|process|terminal|command|shell|npm|pnpm|docker)\b/i;

const connectorPattern =
  /\b(github|slack|google drive|drive|mcp|connector|issue|pull request|repository|repo)\b/i;

const destructivePattern =
  /\b(delete|remove|overwrite|move|reset|format|shutdown|destroy|wipe)\b/i;

function initialOperatorForMode(mode: IntentRouteMode) {
  return mode === 'computer' ? Operator.LocalComputer : Operator.LocalBrowser;
}

function modeFromSharedSurface(
  surface: ReturnType<typeof classifyUserIntent>['surface'],
): IntentRouteMode {
  return surface === 'browser'
    ? 'browser'
    : surface === 'mixed'
      ? 'mixed'
      : 'computer';
}

function operatorFromSharedFirstOperator(
  firstOperator: ReturnType<typeof classifyUserIntent>['firstOperator'],
) {
  return firstOperator === 'browser'
    ? Operator.LocalBrowser
    : Operator.LocalComputer;
}

function inferRunMetadata(
  instructions: string,
  mode: IntentRouteMode,
  operator: Operator,
): Pick<IntentRouteDecision, 'runMode' | 'requiresValidation' | 'complexity'> {
  const normalized = instructions.trim();
  const sharedIntent = classifyUserIntent(normalized);

  if (sharedIntent.surface === 'direct') {
    return {
      runMode: 'direct',
      requiresValidation: false,
      complexity: 'simple',
    };
  }

  if (
    operator === Operator.RemoteBrowser ||
    operator === Operator.RemoteComputer
  ) {
    return {
      runMode:
        operator === Operator.RemoteBrowser ? 'gui_browser' : 'gui_computer',
      requiresValidation: false,
      complexity: mode === 'mixed' ? 'multi_step' : 'simple',
    };
  }

  if (
    operator === Operator.LocalComputer &&
    (mode === 'browser' || mode === 'mixed')
  ) {
    const needsValidation = needsResearchVerification(normalized);
    return {
      runMode: 'gui_computer',
      requiresValidation: needsValidation,
      complexity: needsValidation
        ? 'research'
        : mode === 'mixed'
          ? 'multi_step'
          : 'simple',
    };
  }

  if (wideResearchPattern.test(normalized)) {
    return {
      runMode: 'wide_research',
      requiresValidation: true,
      complexity: 'research',
    };
  }

  if (websiteBuilderPattern.test(normalized)) {
    return {
      runMode: 'website_builder',
      requiresValidation: false,
      complexity: 'multi_step',
    };
  }

  if (multimodalWorkflowPattern.test(normalized)) {
    return {
      runMode: 'multimodal_workflow',
      requiresValidation: false,
      complexity: 'multi_step',
    };
  }

  if (artifactWorkflowPattern.test(normalized)) {
    return {
      runMode: 'artifact_workflow',
      requiresValidation: false,
      complexity: 'multi_step',
    };
  }

  if (mode === 'browser' || mode === 'mixed') {
    const needsValidation =
      executorBrowserPattern.test(normalized) ||
      needsResearchVerification(normalized);
    return {
      runMode: 'gui_browser',
      requiresValidation: needsValidation,
      complexity: needsValidation
        ? 'research'
        : mode === 'mixed'
          ? 'multi_step'
          : 'simple',
    };
  }

  return {
    runMode: 'gui_computer',
    requiresValidation: false,
    complexity: 'simple',
  };
}

function inferSemanticIntent(
  instructions: string,
  runMode: AgentRunMode,
  mode: IntentRouteMode,
): Pick<
  IntentRouteDecision,
  | 'taskType'
  | 'requiredTools'
  | 'riskLevel'
  | 'verificationRequired'
  | 'expectedArtifacts'
> {
  const normalized = instructions.trim();
  const expectedArtifacts: string[] = [];
  const requiredTools: string[] = [];
  let taskType: IntentTaskType = mode === 'mixed' ? 'mixed' : 'local_app';

  if (runMode === 'direct') {
    taskType = 'chat';
  } else if (runMode === 'wide_research') {
    taskType = 'browser_research';
    requiredTools.push('planner_model', 'artifact_studio');
    expectedArtifacts.push('report', 'csv', 'xlsx');
  } else if (runMode === 'executor_browser') {
    taskType = 'browser_research';
    requiredTools.push('browser', 'extract_page');
  } else if (
    runMode === 'gui_browser' ||
    (runMode === 'gui_computer' && (mode === 'browser' || mode === 'mixed'))
  ) {
    taskType = needsResearchVerification(normalized)
      ? 'browser_research'
      : 'browser_navigation';
    requiredTools.push('browser');
  } else if (runMode === 'artifact_workflow') {
    taskType = 'artifact';
    requiredTools.push('artifact_studio');
    expectedArtifacts.push('report', 'presentation', 'spreadsheet');
  } else if (runMode === 'website_builder') {
    taskType = 'website';
    requiredTools.push('website_builder');
    expectedArtifacts.push('website', 'archive');
  } else if (runMode === 'multimodal_workflow') {
    taskType = 'multimodal';
    requiredTools.push('multimodal_provider');
    expectedArtifacts.push('media');
  } else if (connectorPattern.test(normalized)) {
    taskType = 'connector';
    requiredTools.push('connector');
  } else if (processPattern.test(normalized)) {
    taskType = 'process';
    requiredTools.push('process');
  } else if (localFilePattern.test(normalized)) {
    taskType = 'local_file';
    requiredTools.push('file');
  }

  return {
    taskType,
    requiredTools,
    riskLevel: destructivePattern.test(normalized)
      ? 'high'
      : connectorPattern.test(normalized)
        ? 'medium'
        : 'low',
    verificationRequired:
      runMode === 'executor_browser' ||
      runMode === 'wide_research' ||
      needsResearchVerification(normalized) ||
      expectedArtifacts.length > 0,
    expectedArtifacts,
  };
}

function needsResearchVerification(instructions: string) {
  return complexBrowserPattern.test(instructions);
}

function enrichDecision(
  instructions: string,
  decision: BaseIntentDecision,
): IntentRouteDecision {
  const metadata = inferRunMetadata(
    instructions,
    decision.mode,
    decision.operator,
  );

  return {
    ...decision,
    ...metadata,
    ...inferSemanticIntent(instructions, metadata.runMode, decision.mode),
  };
}

function deterministicRuleDecision(instructions: string): BaseIntentDecision {
  const sharedIntent = classifyUserIntent(instructions);

  if (sharedIntent.surface === 'direct') {
    return {
      mode: 'computer',
      operator: Operator.LocalComputer,
      confidence: sharedIntent.confidence,
      source: 'rules',
      reason: sharedIntent.reason,
    };
  }

  const mode = modeFromSharedSurface(sharedIntent.surface);
  return {
    mode,
    operator: operatorFromSharedFirstOperator(sharedIntent.firstOperator),
    confidence: sharedIntent.confidence,
    source: 'rules',
    reason: sharedIntent.reason,
  };
}

function applySafetyOverrides(
  instructions: string,
  decision: BaseIntentDecision,
) {
  const sharedIntent = classifyUserIntent(instructions);

  if (sharedIntent.surface === 'direct') {
    return {
      mode: 'computer' as const,
      operator: Operator.LocalComputer,
      confidence: Math.max(decision.confidence, sharedIntent.confidence),
      source: decision.source,
      reason: `${decision.reason}; direct-answer override`,
    };
  }

  if (sharedIntent.confidence >= 0.86) {
    return {
      ...decision,
      mode: modeFromSharedSurface(sharedIntent.surface),
      operator: operatorFromSharedFirstOperator(sharedIntent.firstOperator),
      confidence: Math.max(decision.confidence, sharedIntent.confidence),
      reason: `${decision.reason}; deterministic override: ${sharedIntent.reason}`,
    };
  }

  if (
    localFilePattern.test(instructions) ||
    processPattern.test(instructions)
  ) {
    return {
      ...decision,
      mode: 'computer' as const,
      operator: Operator.LocalComputer,
      reason: `${decision.reason}; safety override to local computer tools`,
    };
  }

  return decision;
}

function operatorFromFirstOperator(
  firstOperator: unknown,
  fallbackMode: IntentRouteMode,
) {
  if (typeof firstOperator !== 'string') {
    return initialOperatorForMode(fallbackMode);
  }

  if (firstOperator.toLowerCase() === 'computer') {
    return Operator.LocalComputer;
  }

  if (firstOperator.toLowerCase() === 'browser') {
    return Operator.LocalBrowser;
  }

  return initialOperatorForMode(fallbackMode);
}

function parseLlmDecision(raw: string): Partial<BaseIntentDecision> | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const mode =
      parsed.mode === 'browser' ||
      parsed.mode === 'computer' ||
      parsed.mode === 'mixed'
        ? parsed.mode
        : null;

    if (!mode) {
      return null;
    }

    return {
      mode,
      operator: operatorFromFirstOperator(parsed.first_operator, mode),
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.65,
      reason:
        typeof parsed.reason === 'string'
          ? parsed.reason
          : 'LLM classifier decision',
      source: 'llm',
    };
  } catch (error) {
    logger.warn('[IntentRouter] failed to parse LLM JSON:', raw, error);
    return null;
  }
}

async function classifyWithLlm(
  instructions: string,
  settings: LocalStore,
): Promise<BaseIntentDecision | null> {
  const usePlanner =
    settings.usePlannerModel !== false && !!settings.plannerModelName?.trim();
  const apiKey =
    (usePlanner ? settings.plannerApiKey : settings.vlmApiKey) ||
    settings.vlmApiKey ||
    settings.plannerApiKey;
  const baseURL =
    (usePlanner ? settings.plannerBaseUrl : settings.vlmBaseUrl) ||
    settings.vlmBaseUrl ||
    settings.plannerBaseUrl;
  const model =
    (usePlanner ? settings.plannerModelName : settings.vlmModelName) ||
    settings.vlmModelName ||
    settings.plannerModelName;

  if (!apiKey?.trim() || !baseURL || !model) {
    return null;
  }

  try {
    const openai = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 0,
    });

    const completion = await openai.chat.completions.create(
      {
        model,
        temperature: 0,
        max_tokens: 256,
        messages: [
          {
            role: 'system',
            content: [
              'Classify the user task for an autonomous desktop agent.',
              'Return only JSON with keys mode, confidence, reason, first_operator, task_type, required_tools, risk_level, verification_required, expected_artifacts.',
              'mode must be browser, computer, or mixed.',
              'browser means web navigation/search/forms/current online information.',
              'computer means local OS/app/file/window/shell control.',
              'mixed means both are likely needed.',
              'first_operator must be browser or computer.',
              'Evaluate the full intent of the user task and avoid shallow keyword matching.',
              'Examples:',
              '- "summarize the latest AI news": mode=browser, first_operator=browser',
              '- "open a terminal and run a dev server": mode=computer, first_operator=computer',
              '- "research competitors and save it to a local CSV": mode=mixed, first_operator=browser',
              '- "find a cool image of a cat online and set it as my desktop background": mode=mixed, first_operator=browser',
              '- "write a python script to sort my downloads": mode=computer, first_operator=computer',
              'If the user asks to type/write/paste into Notepad, Word, a local file, a local app, or a desktop window, choose computer.',
              'If the user asks for latest/news/price/search/open website without a local app target, choose browser.',
              'If the user asks to read, write, edit, create, zip, unzip, or inspect local files/documents, choose computer so native file tools can run.',
              'If the user asks to start a server, watcher, background job, or manage a process, choose computer so process tools can run.',
              'If the user asks to scrape/extract/download/monitor a webpage, choose browser unless a local file artifact is the main first step.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `User task: ${instructions}`,
          },
        ],
        stream: false,
      },
      { timeout: Math.min(settings.plannerTimeoutInMs || 15_000, 20_000) },
    );

    const message = completion.choices?.[0]?.message;
    const content =
      message?.content ||
      // Some NVIDIA reasoning models expose useful text in this provider field.
      (message as { reasoning_content?: string } | undefined)
        ?.reasoning_content ||
      '';
    const parsed = parseLlmDecision(content);

    if (!parsed?.mode) {
      return null;
    }

    return applySafetyOverrides(instructions, {
      mode: parsed.mode,
      operator: parsed.operator ?? initialOperatorForMode(parsed.mode),
      confidence: parsed.confidence ?? 0.65,
      reason: parsed.reason ?? 'LLM classifier decision',
      source: 'llm',
    });
  } catch (error) {
    logger.warn('[IntentRouter] LLM classifier failed.', error);
    return null;
  }
}

export async function routeIntent({
  configuredOperator,
  instructions,
  settings,
}: {
  configuredOperator: Operator;
  instructions: string;
  settings: LocalStore;
}): Promise<IntentRouteDecision> {
  if (
    configuredOperator === Operator.RemoteBrowser ||
    configuredOperator === Operator.RemoteComputer
  ) {
    const mode =
      configuredOperator === Operator.RemoteBrowser ? 'browser' : 'computer';
    return {
      ...enrichDecision(instructions, {
        mode,
        operator: configuredOperator,
        confidence: 1,
        source: 'configured',
        reason: 'remote operator explicitly configured',
      }),
      runMode:
        configuredOperator === Operator.RemoteBrowser
          ? 'gui_browser'
          : 'gui_computer',
      requiresValidation: false,
    };
  }

  const ruleDecision = deterministicRuleDecision(instructions);
  if (ruleDecision.source === 'rules' && ruleDecision.confidence >= 0.86) {
    const enriched = enrichDecision(instructions, ruleDecision);
    logger.info('[IntentRouter] deterministic decision', enriched);
    return enriched;
  }

  const llmDecision = await classifyWithLlm(instructions, settings);
  if (llmDecision) {
    const enriched = enrichDecision(instructions, llmDecision);
    logger.info('[IntentRouter] llm decision', enriched);
    return enriched;
  }

  // Fallback if LLM fails or is not configured
  const enriched = enrichDecision(instructions, ruleDecision);
  logger.info('[IntentRouter] fallback decision', enriched);
  return enriched;
}
