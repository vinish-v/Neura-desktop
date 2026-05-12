/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { logger } from '@main/logger';
import { StatusEnum } from '@neura-desktop/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@neura-desktop/sdk';
import { UTIOService } from '@main/services/utio';
import { NutJSElectronOperator } from '../agent/operator';
import {
  createRemoteBrowserOperator,
  RemoteComputerOperator,
} from '../remote/operators';
import { RemoteBrowserOperator } from '@neura-desktop/operator-browser';
import { SettingStore } from '@main/store/setting';
import { AppState, Operator } from '@main/store/types';
import { GUIAgentManager } from '../ipcRoutes/agent';
import {
  getModelVersion,
  getSpByModelVersion,
  beforeAgentRun,
  afterAgentRun,
} from '../utils/agent';
import { FREE_MODEL_BASE_URL } from '../remote/shared';
import { getAuthHeader } from '../remote/auth';
import { ProxyClient } from '../remote/proxyClient';
import { NeuraModelConfig } from '@neura-desktop/sdk/core';
import { routeIntent } from './intentRouter';
import { validateCompletionProof } from './completionValidation';
import { inferInitialBrowserUrl } from './initialBrowserNavigation';
import {
  getAgentMemoryHint,
  rememberPreferenceFromInstruction,
} from './agentMemory';
import { runAutonomousBrowserAgent } from './autonomousBrowserRunner';
import { runLocalComputerActorAgent } from './localComputerActorRunner';
import { runLocalWorkflowAgent } from './localWorkflowRunner';
import { createTaskRun, TaskRunRegistry } from './taskRunRegistry';
import { ComputerRuntimeController } from './computerRuntimeController';
import { ElectronBrowserOperator } from './electronBrowserOperator';
import { runQuickEmbeddedBrowserTask } from './quickEmbeddedBrowserTask';
import {
  isEmbeddedResearchTask,
  runEmbeddedBrowserResearchTask,
} from './embeddedBrowserResearchTask';

const INTERNAL_AGENT_FEEDBACK_PATTERN =
  /previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|continue autonomously: take a fresh screenshot\/DOM map|do not finish with this recovery message|element id was stale|Could not (?:type into|click) that DOM element|Refresh the DOM map|visible current DOM element|regex|pattern|validator|validated \d+ local computer actor|command output contains|planner checklist|planner step|predictionParsed/i;

const isInternalAgentFeedback = (value?: string) =>
  Boolean(value && INTERNAL_AGENT_FEEDBACK_PATTERN.test(value));

const extractFinalAnswer = (messages: ConversationWithSoM[]) => {
  for (const message of [...messages].reverse()) {
    const finished = message.predictionParsed?.find(
      (prediction) => prediction.action_type === 'finished',
    );
    const content = finished?.action_inputs?.content;
    if (
      typeof content === 'string' &&
      content.trim() &&
      !isInternalAgentFeedback(content)
    ) {
      return content.trim();
    }
    if (
      message.from === 'gpt' &&
      message.value?.trim() &&
      !isInternalAgentFeedback(message.value)
    ) {
      return message.value.trim();
    }
  }
  return '';
};

const getPageUrlFromConversation = (message?: ConversationWithSoM) => {
  const domText = message?.domText || '';
  return domText.match(/^URL:\s*(.+)$/m)?.[1]?.trim();
};

const toScreenshotDataUrl = (base64?: string, mime = 'image/jpeg') => {
  const value = base64?.trim();
  if (!value) {
    return undefined;
  }
  if (/^data:image\//i.test(value)) {
    return value;
  }
  return `data:${mime};base64,${value.replace(/^data:[^,]+,/i, '')}`;
};

const getBrowserInstructionHint = (operatorType: 'computer' | 'browser') => {
  if (operatorType !== 'browser') {
    return '';
  }

  return `\n\n## Browser Routing Hint\n- This task is being executed with Neura's Browser Operator.\n- Use browser actions for web pages.\n- Use extract_page(format='markdown|text|html|links|tables|json') when the current page contains the requested information and you need a structured answer instead of more clicking.\n- Use download_url or save_page_screenshot for direct browser artifacts.\n- Do not switch to desktop/computer actions unless the task explicitly needs a local file or application.\n- When the requested answer is found, use finished(content='...') or extract_page(...) if extraction itself answers the task.`;
};

const composeSystemPrompt = (
  basePrompt: string,
  browserHint: string,
  operatorType: 'computer' | 'browser',
  memoryHint = '',
) => {
  const authorizationHint = `\n\n## Authorized Use\n- The user explicitly asked Neura to operate this browser/computer session.\n- The task is benign UI automation on the user's own machine/session.\n- Do not refuse normal web navigation, reading public pages, typing user-provided search terms, or clicking ordinary page controls.\n- Refuse only requests involving credentials theft, malware, evasion, destructive actions, or other clearly harmful behavior.\n- If allowed, always produce one executable Action line.`;
  const autonomyHint = `\n\n## Autonomy & Completion Contract\n- You are an acting agent, not a chat assistant. Do not say you will do something unless the Action line actually does it now.\n- In Thought, use a compact public structure: Observation: ... Progress: ... Next: ... Keep it short and do not reveal hidden chain-of-thought.\n- For local app tasks, first open/focus the target app if needed, then type/click/save as requested. Do not finish after merely drafting text in Thought.\n- Before using finished(content='...'), verify from the current screenshot/DOM that the user's requested outcome is actually complete.\n- When finishing, give a complete user-facing sentence with the minimum useful context visible on screen; do not return a bare one-word answer unless the user explicitly asked for only the value.\n- For a brief latest-news request, visible search Top Stories/news cards are enough when they show source, headline, and recency; summarize them and finish.\n- If the user asked for a web article, top result, detailed summary, verification, extraction, or source-backed answer, a search results page is not enough. Click/open a relevant result, inspect the destination page, and only then finish.\n- If the state does not change after an action, choose a different strategy: use another DOM element, scroll, navigate directly, use search, go back, or call_user only when truly blocked.`;
  const routingHint =
    operatorType === 'browser'
      ? browserHint
      : `\n\n## Computer Routing Hint\n- This task is being executed with Neura's Computer Operator.\n- Use native file/document/process/monitor tools for local files, Office-style artifacts, folders, servers, background jobs, and webpage monitors.\n- Use desktop actions for local apps, OS controls, and visible UI when a native tool cannot complete the job.\n- Use run_command(command='...', cwd='') only for explicit terminal or short shell command requests.\n- Use start_process(command='...', cwd='') for servers, watchers, dev commands, and long-running jobs so the loop does not freeze.\n- Do not use run_command for casual chat, explanations, or web lookup tasks.`;
  const insertedHints = `${authorizationHint}${routingHint}${autonomyHint}${memoryHint}\n\n`;

  return basePrompt.replace(
    '## User Instruction\n',
    `${insertedHints}## User Instruction\n`,
  );
};

const runInitialBrowserNavigation = async (
  operator: ElectronBrowserOperator | RemoteBrowserOperator,
  instructions: string,
  searchEngine = SettingStore.getStore().searchEngineForBrowser,
) => {
  const initialUrl = inferInitialBrowserUrl(instructions, searchEngine);
  if (!initialUrl) {
    return;
  }

  logger.info('[runAgent] initial browser navigation', initialUrl);
  await operator.execute({
    screenWidth: 1,
    screenHeight: 1,
    parsedPrediction: {
      reflection: null,
      thought: `Navigate directly to ${initialUrl}.`,
      action_type: 'navigate',
      action_inputs: {
        content: initialUrl,
      },
    },
  });
};

export const runAgent = async (
  setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  logger.info('runAgent');
  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  const language = settings.language ?? 'en';
  rememberPreferenceFromInstruction(instructions);
  const intentDecision = await routeIntent({
    configuredOperator: settings.operator,
    instructions,
    settings,
  });

  if (intentDecision.runMode === 'direct') {
    const content = /thank/i.test(instructions)
      ? "You're welcome."
      : 'Hi. What would you like Neura to do?';
    const taskState = {
      ...createTaskRun(instructions, 'direct'),
      status: 'completed' as const,
      finalAnswer: content,
      validationStatus: 'valid' as const,
      completionProof: {
        kind: 'local_action' as const,
        summary: 'Direct response completed without tool execution.',
        evidence: [content],
        verifiedAt: Date.now(),
      },
      completedAt: Date.now(),
    };
    TaskRunRegistry.upsert(taskState);
    ComputerRuntimeController.reset();
    setState({
      ...getState(),
      status: StatusEnum.END,
      messages: [
        ...(getState().messages || []),
        {
          from: 'gpt',
          value: content,
        },
      ],
      taskState,
    });
    return;
  }

  if (intentDecision.runMode === 'executor_browser') {
    await runAutonomousBrowserAgent({
      instructions,
      settings,
      setState,
      getState,
      abortController,
    });
    return;
  }

  if (
    intentDecision.runMode === 'wide_research' ||
    intentDecision.runMode === 'website_builder' ||
    intentDecision.runMode === 'artifact_workflow' ||
    intentDecision.runMode === 'multimodal_workflow'
  ) {
    await runLocalWorkflowAgent({
      instructions,
      runMode: intentDecision.runMode,
      setState,
      getState,
    });
    return;
  }

  if (
    (intentDecision.runMode === 'gui_browser' ||
      intentDecision.taskType === 'browser_navigation' ||
      intentDecision.taskType === 'browser_research' ||
      intentDecision.requiredTools.includes('browser'))
  ) {
    const isResearch = isEmbeddedResearchTask(instructions);
    logger.info(
      isResearch
        ? '[runAgent] using embedded browser research task'
        : '[runAgent] using quick embedded browser task',
      intentDecision,
    );
    const handled = isResearch
      ? await runEmbeddedBrowserResearchTask({
          instructions,
          settings,
          searchEngine: settings.searchEngineForBrowser,
          setState,
          getState,
        })
      : await runQuickEmbeddedBrowserTask({
          instructions,
          searchEngine: settings.searchEngineForBrowser,
          setState,
          getState,
        });
    if (handled) {
      return;
    }
  }

  if (
    intentDecision.runMode === 'gui_computer' &&
    intentDecision.operator === Operator.LocalComputer
  ) {
    const handled = await runLocalComputerActorAgent({
      instructions,
      settings,
      setState,
      getState,
    });
    if (handled) {
      return;
    }
  }

  const activeOperator = intentDecision.operator;
  const guiTaskState = {
    ...createTaskRun(instructions, intentDecision.runMode),
    validationStatus: intentDecision.verificationRequired
      ? ('pending' as const)
      : undefined,
  };
  TaskRunRegistry.upsert(guiTaskState);
  TaskRunRegistry.setActiveRunId(guiTaskState.runId);

  setState({
    ...getState(),
    taskState: guiTaskState,
  });
  ComputerRuntimeController.start({
    mode:
      activeOperator === Operator.LocalBrowser ||
      activeOperator === Operator.RemoteBrowser
        ? 'browser'
        : 'desktop',
    subtitle:
      activeOperator === Operator.LocalBrowser ||
      activeOperator === Operator.RemoteBrowser
        ? 'Browser'
        : 'Desktop',
    display:
      activeOperator === Operator.LocalBrowser ||
      activeOperator === Operator.RemoteBrowser
        ? 'Browser'
        : 'Local desktop',
    activity: 'Starting task',
  });

  logger.info('settings.operator', settings.operator);
  logger.info('[IntentRouter] activeOperator', activeOperator, intentDecision);

  if (
    activeOperator !== settings.operator &&
    (activeOperator === Operator.LocalBrowser ||
      activeOperator === Operator.LocalComputer)
  ) {
    SettingStore.set('operator', activeOperator);
  }

  const handleData: GUIAgentConfig<NutJSElectronOperator>['onData'] = async ({
    data,
  }) => {
    const { status, conversations, ...restUserData } = data;
    logger.info('[onGUIAgentData] status', status, conversations.length);

    const conversationsWithSoM: ConversationWithSoM[] = conversations;
    const latestConversation =
      conversationsWithSoM?.[conversationsWithSoM.length - 1];

    const { screenshotBase64, predictionParsed, screenshotContext, ...rest } =
      latestConversation || {};
    logger.info(
      '[onGUIAgentData] ======data======\n',
      predictionParsed,
      screenshotContext,
      rest,
      status,
      '\n========',
    );

    if (screenshotBase64 || screenshotContext?.size) {
      const mime = screenshotContext?.mime || 'image/jpeg';
      ComputerRuntimeController.frame({
        dataUrl: toScreenshotDataUrl(screenshotBase64, mime),
        mime,
        width: screenshotContext?.size?.width,
        height: screenshotContext?.size?.height,
        scaleFactor: screenshotContext?.scaleFactor,
      });
    }
    const url = getPageUrlFromConversation(latestConversation);
    const latestAction = predictionParsed?.[predictionParsed.length - 1];
    ComputerRuntimeController.update({
      status:
        status === StatusEnum.RUNNING
          ? 'running'
          : status === StatusEnum.PAUSE
            ? 'paused'
            : status === StatusEnum.CALL_USER
              ? 'waiting'
            : status === StatusEnum.ERROR
              ? 'failed'
              : status === StatusEnum.END
                ? 'completed'
                : undefined,
      currentUrl: url,
      display: url,
      activity: latestAction?.action_type
        ? latestAction.action_type.replace(/_/g, ' ')
        : undefined,
    });

    setState({
      ...getState(),
      status,
      restUserData,
      taskState: getState().taskState,
      messages: [...(getState().messages || []), ...conversationsWithSoM],
    });
  };

  let operatorType: 'computer' | 'browser' = 'computer';
  let operator:
    | NutJSElectronOperator
    | ElectronBrowserOperator
    | RemoteComputerOperator
    | RemoteBrowserOperator;

  switch (activeOperator) {
    case Operator.LocalComputer:
      operator = new NutJSElectronOperator();
      operatorType = 'computer';
      break;
    case Operator.LocalBrowser:
      logger.info('[runAgent] creating embedded browser operator', {
        operator: activeOperator,
      });
      operator = new ElectronBrowserOperator();
      logger.info('[runAgent] embedded browser operator ready');
      operatorType = 'browser';
      break;
    case Operator.RemoteComputer:
      operator = await RemoteComputerOperator.create();
      operatorType = 'computer';
      break;
    case Operator.RemoteBrowser:
      operator = await createRemoteBrowserOperator();
      operatorType = 'browser';
      break;
    default:
      break;
  }

  if (
    operatorType === 'browser' &&
    (activeOperator === Operator.LocalBrowser ||
      activeOperator === Operator.RemoteBrowser)
  ) {
    await runInitialBrowserNavigation(
      operator! as ElectronBrowserOperator | RemoteBrowserOperator,
      instructions,
      settings.searchEngineForBrowser,
    ).catch((error) => {
      logger.warn('[runAgent] initial browser navigation skipped', error);
    });
  }

  let modelVersion = getModelVersion(settings.vlmProvider);
  let modelConfig: NeuraModelConfig = {
    baseURL: settings.vlmBaseUrl,
    apiKey: settings.vlmApiKey,
    model: settings.vlmModelName,
    max_tokens: settings.vlmProvider === 'NVIDIA NIM' ? 512 : undefined,
    timeout: settings.modelTimeoutInMs || 240_000,
    useResponsesApi: settings.useResponsesApi,
  };
  let plannerModelConfig: NeuraModelConfig | undefined =
    settings.usePlannerModel !== false && settings.plannerModelName?.trim()
      ? {
          baseURL: settings.plannerBaseUrl || settings.vlmBaseUrl,
          apiKey: settings.plannerApiKey || settings.vlmApiKey,
          model: settings.plannerModelName,
          max_tokens: 512,
          temperature: 0.2,
          top_p: 0.9,
          timeout: settings.plannerTimeoutInMs || 90_000,
          useResponsesApi: false,
        }
      : undefined;
  let modelAuthHdrs: Record<string, string> = {};

  if (
    activeOperator === Operator.RemoteComputer ||
    activeOperator === Operator.RemoteBrowser
  ) {
    const useResponsesApi = await ProxyClient.getRemoteVLMResponseApiSupport();
    modelConfig = {
      baseURL: FREE_MODEL_BASE_URL,
      apiKey: '',
      model: '',
      useResponsesApi,
    };
    plannerModelConfig = undefined;
    modelAuthHdrs = await getAuthHeader();
    modelVersion = await ProxyClient.getRemoteVLMProvider();
  }

  if (operatorType === 'browser') {
    plannerModelConfig = undefined;
  }

  if (!modelAuthHdrs.Authorization && !modelConfig.apiKey?.trim()) {
    const message =
      'NVIDIA NIM API key is missing. Open Neura settings and add the API key before running a local browser or computer task.';
    logger.error('[runAgent] missing model API key', {
      provider: settings.vlmProvider,
      operator: activeOperator,
      model: modelConfig.model,
    });
    setState({
      ...getState(),
      status: StatusEnum.ERROR,
      errorMsg: message,
    });
    ComputerRuntimeController.fail(message);
    return;
  }

  const systemPrompt = composeSystemPrompt(
    getSpByModelVersion(modelVersion, language, operatorType),
    getBrowserInstructionHint(operatorType),
    operatorType,
    getAgentMemoryHint(settings),
  );

  const guiAgent = new GUIAgent({
    model: modelConfig,
    plannerModel: plannerModelConfig,
    systemPrompt: systemPrompt,
    logger,
    signal: abortController?.signal,
    operator: operator!,
    onData: handleData,
    onError: (params) => {
      const { error } = params;
      logger.error(
        '[onGUIAgentError]',
        { ...settings, vlmApiKey: settings.vlmApiKey ? '<redacted>' : '' },
        error,
      );
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: JSON.stringify({
          status: error?.status,
          message: error?.message,
          stack: error?.stack,
        }),
      });
    },
    retry: {
      model: {
        maxRetries: operatorType === 'browser' ? 0 : 5,
      },
      screenshot: {
        maxRetries: 5,
      },
      execute: {
        maxRetries: 1,
      },
    },
    maxLoopCount: settings.maxLoopCount,
    loopIntervalInMs: settings.loopIntervalInMs,
    neuraModelVersion: modelVersion,
  });

  GUIAgentManager.getInstance().setAgent(guiAgent);
  UTIOService.getInstance().sendInstruction(instructions);

  const { sessionHistoryMessages } = getState();

  beforeAgentRun(activeOperator);

  const startTime = Date.now();

  await guiAgent
    .run(instructions, sessionHistoryMessages, modelAuthHdrs)
    .catch((e) => {
      logger.error('[runAgentLoop error]', e);
      const currentTask = getState().taskState;
      if (currentTask) {
        const failedTask = {
          ...currentTask,
          status: 'failed' as const,
          error: e.message,
          completedAt: Date.now(),
        };
        TaskRunRegistry.upsert(failedTask);
        setState({
          ...getState(),
          taskState: failedTask,
        });
      }
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: e.message,
      });
      ComputerRuntimeController.fail(e.message);
    });

  const currentTask = getState().taskState;
  const currentStatus = getState().status;
  if (currentTask?.status === 'running' && currentStatus === StatusEnum.END) {
    const finalAnswer = extractFinalAnswer(getState().messages || []);
    const evidence = [
      ...currentTask.sourcesVisited,
      ...currentTask.artifacts.map((artifact) => artifact.path),
      finalAnswer,
    ].filter(Boolean);
    const validation = validateCompletionProof({
      originalGoal: currentTask.originalGoal,
      runMode: currentTask.runMode,
      answerText: finalAnswer,
      evidence,
      artifactCount: currentTask.artifacts.length,
    });
    if (!validation.isValid) {
      const failedTask = {
        ...currentTask,
        status: 'failed' as const,
        validationStatus: 'invalid' as const,
        error: validation.reason,
        completedAt: Date.now(),
      };
      TaskRunRegistry.upsert(failedTask);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: validation.reason,
        taskState: failedTask,
      });
      ComputerRuntimeController.fail(validation.reason);
      logger.warn('[runAgent] completion proof rejected', validation);
      return;
    }
    const completedTask = {
      ...currentTask,
      status: 'completed' as const,
      finalAnswer,
      validationStatus: 'valid' as const,
      completionProof: currentTask.completionProof || {
        kind:
          currentTask.runMode === 'gui_browser'
            ? ('browser_terminal_page' as const)
            : ('local_action' as const),
        summary: validation.reason,
        evidence: evidence.slice(0, 20),
        verifiedAt: Date.now(),
      },
      completedAt: Date.now(),
    };
    TaskRunRegistry.upsert(completedTask);
    setState({
      ...getState(),
      taskState: completedTask,
    });
    ComputerRuntimeController.complete('Task completed');
  } else if (
    currentTask?.status === 'running' &&
    currentStatus === StatusEnum.USER_STOPPED
  ) {
    const cancelledTask = {
      ...currentTask,
      status: 'cancelled' as const,
      completedAt: Date.now(),
    };
    TaskRunRegistry.upsert(cancelledTask);
    setState({
      ...getState(),
      taskState: cancelledTask,
    });
    ComputerRuntimeController.update({
      status: 'completed',
      activity: 'Task stopped',
      takeoverEnabled: false,
    });
  }

  logger.info('[runAgent Totoal cost]: ', (Date.now() - startTime) / 1000, 's');

  GUIAgentManager.getInstance().clearAgent();
  afterAgentRun(activeOperator);
};
