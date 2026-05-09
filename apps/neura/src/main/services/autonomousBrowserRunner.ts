/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ChatOpenAI } from '@langchain/openai';
import {
  Actors,
  BrowserContext,
  EventType,
  ExecutionState,
  Executor,
  type AgentEvent,
} from '@agent-infra/browser-use';
import { StatusEnum } from '@neura-desktop/shared/types';

import { logger } from '@main/logger';
import { AppState, LocalStore } from '@main/store/types';
import { getAgentMemoryHint } from './agentMemory';
import { AgentOrchestrator, TaskProgressEvent } from './agentOrchestrator';
import { validateCompletionProof } from './completionValidation';

type RunnerArgs = {
  instructions: string;
  settings: LocalStore;
  setState: (state: AppState) => void;
  getState: () => AppState;
  abortController?: AbortController | null;
};

type Role = 'planner' | 'navigator' | 'validator';

const DIRECT_URL_PATTERN =
  /\bhttps?:\/\/|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|dev|in|co|gov|edu|news|app)\b/i;

const SEARCH_TASK_PATTERN =
  /\b(search|google|look up|find|latest|news|headline|headlines|today|current|recent|top\s+\d+|price|weather|who is|what is|where is|when is|compare|review|reviews)\b/i;

export const buildInitialBrowserUrl = (instructions: string) => {
  const trimmed = instructions.replace(/\s+/g, ' ').trim();
  if (!trimmed || DIRECT_URL_PATTERN.test(trimmed)) {
    return 'https://www.google.com/';
  }

  if (!SEARCH_TASK_PATTERN.test(trimmed)) {
    return 'https://www.google.com/';
  }

  const query = trimmed
    .replace(
      /^(please\s+)?(can you\s+)?(give me|show me|get me|find|search for|look up|google|tell me about)\s+(the\s+)?/i,
      '',
    )
    .replace(
      /\b(on|in|using)\s+(google|the browser|browser|web|internet)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

  return `https://www.google.com/search?q=${encodeURIComponent(query || trimmed)}`;
};

const taskPrefix = (instructions: string, settings: LocalStore) => {
  return [
    'You are Neura running an autonomous browser research workflow.',
    'Maintain the original goal, keep a concise checklist, open source pages for research/news/detail tasks, extract useful facts, validate the answer, and stop immediately once the answer is ready.',
    'For brief latest-news requests, visible Top Stories/news cards on a search page are enough if they show source, headline, and recency. Compile those visible items and finish.',
    'For brief factual lookups, a visible search result can be enough when it clearly shows the requested value and context. For article summaries, detailed extraction, verification, comparisons, or explicitly source-backed answers, do not finish from a search page. Open a relevant source page and read it first.',
    'Final answers should be complete user-facing sentences with the minimum useful context from the visible page or source.',
    'If the answer is already visible, compile it and use the done action instead of wandering through more links.',
    getAgentMemoryHint(settings),
    `Original user goal: ${instructions}`,
  ]
    .filter(Boolean)
    .join('\n\n');
};

const createExecutorModel = (settings: LocalStore, role: Role) => {
  const preferPlanner =
    role !== 'navigator' &&
    settings.usePlannerModel !== false &&
    !!settings.plannerModelName?.trim();
  const apiKey =
    (preferPlanner ? settings.plannerApiKey : settings.vlmApiKey) ||
    settings.vlmApiKey ||
    settings.plannerApiKey ||
    '';
  const baseURL =
    (preferPlanner ? settings.plannerBaseUrl : settings.vlmBaseUrl) ||
    settings.vlmBaseUrl ||
    settings.plannerBaseUrl;
  const model =
    (preferPlanner ? settings.plannerModelName : settings.vlmModelName) ||
    settings.vlmModelName ||
    settings.plannerModelName ||
    '';

  return new ChatOpenAI({
    apiKey,
    configuration: {
      baseURL,
    },
    model,
    temperature: role === 'navigator' ? 0.2 : 0,
    maxTokens: role === 'navigator' ? 1024 : 1536,
    timeout:
      role === 'navigator'
        ? settings.modelTimeoutInMs || 240_000
        : settings.plannerTimeoutInMs || 90_000,
    maxRetries: 0,
  });
};

export function executorEventToProgress(
  event: AgentEvent,
): TaskProgressEvent | null {
  const actor = event.actor;
  const details = event.data.details || '';
  const step = event.data.step + 1;
  const maxSteps = event.data.maxSteps;

  if (event.state === ExecutionState.TASK_START) {
    return {
      type: 'task.started',
      title: 'Autonomous browser task started',
      detail: details,
      status: 'in_progress',
    };
  }

  if (actor === Actors.PLANNER) {
    if (event.state === ExecutionState.STEP_START) {
      return {
        type: 'step.started',
        title: `Planner step ${step}/${maxSteps}`,
        detail: details || 'Creating or refreshing the task plan.',
        status: 'in_progress',
      };
    }
    if (event.state === ExecutionState.STEP_OK) {
      return {
        type: 'plan.updated',
        title: 'Planner checklist updated',
        detail: details,
        status: 'done',
      };
    }
  }

  if (actor === Actors.NAVIGATOR) {
    if (event.state === ExecutionState.STEP_START) {
      return {
        type: 'step.started',
        title: 'Navigator choosing next action',
        detail:
          details ||
          'Reading the current page and selecting the next browser action.',
        status: 'in_progress',
      };
    }
    if (event.state === ExecutionState.ACT_START) {
      return {
        type: 'step.started',
        title: 'Browser action',
        detail: details,
        status: 'in_progress',
      };
    }
    if (event.state === ExecutionState.ACT_OK) {
      return {
        type: 'step.completed',
        title: 'Browser action completed',
        detail: details,
        status: 'done',
      };
    }
    if (event.state === ExecutionState.ACT_FAIL) {
      return {
        type: 'step.failed',
        title: 'Browser action failed',
        detail: details,
        status: 'failed',
      };
    }
  }

  if (actor === Actors.VALIDATOR) {
    if (event.state === ExecutionState.STEP_START) {
      return {
        type: 'step.started',
        title: 'Validator is checking the result',
        detail: details,
        status: 'in_progress',
      };
    }
    if (event.state === ExecutionState.STEP_OK) {
      return {
        type: 'validation.completed',
        title: 'Validation passed',
        detail: details,
        status: 'done',
      };
    }
    if (event.state === ExecutionState.STEP_FAIL) {
      return {
        type: 'validation.completed',
        title: 'Validation requested more work',
        detail: details,
        status: 'failed',
      };
    }
  }

  return null;
}

export async function runAutonomousBrowserAgent({
  instructions,
  settings,
  setState,
  getState,
  abortController,
}: RunnerArgs) {
  const orchestrator = new AgentOrchestrator({ getState, setState });
  orchestrator.begin(instructions, 'executor_browser');

  if (!settings.vlmApiKey?.trim() && !settings.plannerApiKey?.trim()) {
    orchestrator.fail(
      'NVIDIA NIM API key is missing. Add a model API key before running autonomous browser tasks.',
    );
    return;
  }

  const homePageUrl = buildInitialBrowserUrl(instructions);
  const browserContext = new BrowserContext({
    homePageUrl,
    browserWindowSize: { width: 1280, height: 900 },
    highlightElements: true,
    viewportExpansion: 500,
  });
  browserContext.updateCurrentTabId(homePageUrl);

  if (homePageUrl.includes('/search?')) {
    orchestrator.emit({
      type: 'step.completed',
      title: 'Search results opened',
      detail: homePageUrl,
      status: 'done',
    });
  }

  const navigatorLLM = createExecutorModel(settings, 'navigator');
  const plannerLLM = createExecutorModel(settings, 'planner');
  const validatorLLM = createExecutorModel(settings, 'validator');
  const browserMaxSteps = Math.max(settings.maxLoopCount || 60, 60);
  const executor = new Executor(
    taskPrefix(instructions, settings),
    `${Date.now()}`,
    browserContext,
    navigatorLLM,
    {
      plannerLLM,
      validatorLLM,
      extractorLLM: validatorLLM,
      agentOptions: {
        planningInterval: 5,
        validateOutput: true,
        maxSteps: browserMaxSteps,
        maxActionsPerStep: 8,
        maxFailures: 8,
        useVision: true,
        useVisionForPlanner: false,
      },
    },
  );

  let lastActionName = '';
  let finalAnswer = '';
  let taskFailed = '';

  const abort = () => executor.cancel().catch((error) => logger.warn(error));
  abortController?.signal.addEventListener('abort', abort, { once: true });

  executor.subscribeExecutionEvents(async (event) => {
    if (event.type !== EventType.EXECUTION) {
      return;
    }

    const progress = executorEventToProgress(event);
    if (progress) {
      orchestrator.emit(progress);
    }

    const details = event.data.details || '';
    if (event.data.browserState?.url) {
      orchestrator.addSource(event.data.browserState.url);
    }
    if (
      event.actor === Actors.NAVIGATOR &&
      event.state === ExecutionState.ACT_START
    ) {
      lastActionName = details;
    }
    if (
      event.actor === Actors.NAVIGATOR &&
      event.state === ExecutionState.ACT_OK
    ) {
      orchestrator.addFact(details);
      if (lastActionName === 'done') {
        finalAnswer = details;
      }
    }
    if (event.state === ExecutionState.TASK_FAIL) {
      taskFailed = details || 'Autonomous browser task failed.';
    }
  });

  try {
    await executor.execute();
    abortController?.signal.removeEventListener('abort', abort);

    if (abortController?.signal.aborted) {
      setState({
        ...getState(),
        status: StatusEnum.USER_STOPPED,
      });
      return;
    }

    if (taskFailed) {
      orchestrator.fail(taskFailed);
      return;
    }

    const currentPage = await browserContext.getCurrentPage().catch(() => null);
    const currentUrl = currentPage?.url?.() || '';
    const evidence = [
      currentUrl,
      ...(getState().taskState?.sourcesVisited || []),
    ].filter(Boolean);
    const validation = validateCompletionProof({
      originalGoal: instructions,
      runMode: 'executor_browser',
      currentUrl,
      answerText: finalAnswer,
      evidence,
    });

    orchestrator.emit({
      type: 'validation.completed',
      title: validation.isValid ? 'Validation passed' : 'Validation failed',
      detail: validation.reason,
      status: validation.isValid ? 'done' : 'failed',
    });

    if (!validation.isValid) {
      orchestrator.fail(validation.reason);
      return;
    }

    orchestrator.emit({
      type: 'task.completed',
      title: 'Done',
      detail: finalAnswer || 'The browser task completed successfully.',
      status: 'done',
    });
    orchestrator.setCompletionProof({
      kind: 'browser_terminal_page',
      summary:
        finalAnswer ||
        'The autonomous browser workflow reached a validated terminal page.',
      evidence,
      verifiedAt: Date.now(),
    });
    orchestrator.complete(finalAnswer);
  } catch (error) {
    logger.error('[runAutonomousBrowserAgent error]', error);
    orchestrator.fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browserContext.cleanup().catch((error) => logger.warn(error));
  }
}
