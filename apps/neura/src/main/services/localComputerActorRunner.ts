/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI from 'openai';
import { type ActionInputs, StatusEnum } from '@neura-desktop/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@neura-desktop/sdk';
import { NeuraModelConfig } from '@neura-desktop/sdk/core';

import { logger } from '@main/logger';
import {
  type AppState,
  type LocalStore,
  Operator,
  type TaskArtifact,
} from '@main/store/types';
import { NATIVE_COMPUTER_TOOLS } from '@main/shared/toolRegistry';
import { type ConversationWithSoM } from '@main/shared/types';
import { NutJSElectronOperator } from '../agent/operator';
import { GUIAgentManager } from '../ipcRoutes/agent';
import {
  afterAgentRun,
  beforeAgentRun,
  getModelVersion,
  getSpByModelVersion,
} from '../utils/agent';
import { UTIOService } from './utio';
import { getAgentMemoryHint } from './agentMemory';
import { AgentOrchestrator } from './agentOrchestrator';
import { validateCompletionProof } from './completionValidation';
import { executeNativeComputerTool } from './nativeComputerTools';
import { TaskRunRegistry } from './taskRunRegistry';
import { ComputerRuntimeController } from './computerRuntimeController';

type RunnerArgs = {
  instructions: string;
  settings: LocalStore;
  setState: (state: AppState) => void;
  getState: () => AppState;
};

export type LocalComputerActor =
  | 'planner'
  | 'file_worker'
  | 'process_worker'
  | 'connector_worker'
  | 'visual_worker'
  | 'validator';

export type LocalComputerPlanStep = {
  id: string;
  actor: Exclude<LocalComputerActor, 'planner'>;
  tool: string;
  inputs: ActionInputs;
  purpose: string;
  verification: string;
};

export type LocalComputerPlan = {
  canHandle: boolean;
  reason: string;
  steps: LocalComputerPlanStep[];
};

const allowedNativeTools = new Set([
  ...NATIVE_COMPUTER_TOOLS.map((tool) => tool.name),
  'run_command',
  'gui_agent',
]);

const visualAppPattern =
  /\b(click|type|press|focus|send|message|text|dm|open|launch|start|desktop window|screen|visible|mouse|\.exe\b)\b/i;

const localAppRequestPattern =
  /\b(open|launch|start|focus)\s+(.+?)(?:\s+(?:and|then|to|for|with)\b|$)/i;

const extractSimpleMessageTask = (instructions: string) => {
  const openThenSendMatch = instructions.match(
    /\b(?:open|launch|start|focus)\s+(.+?)\s+(?:and|then)\s+(?:send|message|text|dm)\s+(.+?)\s+to\s+(.+?)(?:\s+(?:on|via|using)\s+(.+))?$/i,
  );
  if (openThenSendMatch) {
    return {
      appName: (openThenSendMatch[4] || openThenSendMatch[1])
        .trim()
        .replace(/^["']|["']$/g, ''),
      message: openThenSendMatch[2].trim().replace(/^["']|["']$/g, ''),
      recipient: openThenSendMatch[3].trim().replace(/^["']|["']$/g, ''),
    };
  }

  const match = instructions.match(
    /\b(?:send|message|text|dm)\s+(.+?)\s+to\s+(.+?)(?:\s+(?:on|via|using)\s+(.+))?$/i,
  );
  if (!match) {
    return null;
  }
  return {
    message: match[1].trim().replace(/^["']|["']$/g, ''),
    recipient: match[2].trim().replace(/^["']|["']$/g, ''),
    appName: (match[3] || '').trim(),
  };
};

const psSingleQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

const extractRequestedAppName = (instructions: string) => {
  const messageTask = extractSimpleMessageTask(instructions);
  if (messageTask?.appName) {
    return messageTask.appName;
  }

  const match = instructions.match(localAppRequestPattern);
  const appName = match?.[2]?.trim().replace(/^["']|["']$/g, '');
  if (
    !appName ||
    /\b(file|folder|directory|desktop|downloads?|documents?)\b/i.test(appName)
  ) {
    return null;
  }
  return appName;
};

const buildLocalAppLaunchCommand = (appName: string) =>
  [
    `$raw = ${psSingleQuote(appName)}`,
    "$tokens = $raw -split '\\s+' | Where-Object { $_.Length -ge 2 -and $_ -notin @('app','application','desktop','open','launch','start') }",
    'if (-not $tokens) { $tokens = @($raw) }',
    'if (Test-Path -LiteralPath $raw) { Start-Process -FilePath $raw } else {',
    "  $apps = Get-StartApps | ForEach-Object { $score = 0; foreach ($token in $tokens) { if ($_.Name -like \"*$token*\") { $score++ } }; [pscustomobject]@{ Name = $_.Name; AppID = $_.AppID; Score = $score } } | Where-Object { $_.Score -gt 0 } | Sort-Object -Property @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'Name'; Ascending = $true } | Select-Object -First 1",
    '  if ($apps) { Start-Process -FilePath "shell:AppsFolder\\$($apps.AppID)" } else {',
    '    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs", "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs") | Where-Object { $_ }',
    "    $exe = Get-ChildItem -Path $roots -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object { $score = 0; foreach ($token in $tokens) { if ($_.BaseName -like \"*$token*\") { $score++ } }; [pscustomobject]@{ FullName = $_.FullName; Score = $score } } | Where-Object { $_.Score -gt 0 } | Sort-Object -Property @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'FullName'; Ascending = $true } | Select-Object -First 1",
    '    if ($exe) { Start-Process -FilePath $exe.FullName } else { Write-Output "No installed app match found for \'$raw\'. Visual worker should use Windows search or report blocked." }',
    '  }',
    '}',
    'Start-Sleep -Seconds 3',
    '"Launch/focus requested: $raw"',
  ].join('\n');

const buildLocalAppVisualInstruction = (
  instructions: string,
  appName?: string | null,
) => {
  const parsed = extractSimpleMessageTask(instructions);
  if (parsed) {
    const targetApp =
      appName || parsed.appName || 'the requested messaging app';
    return [
      `Use ${targetApp} to send exactly "${parsed.message}" to "${parsed.recipient}".`,
      `${targetApp} should already be launching, but if it is not visible, open or focus it first.`,
      `Search/select the chat or contact for "${parsed.recipient}" before typing.`,
      `Only type "${parsed.message}" after the chat input for "${parsed.recipient}" is visibly focused.`,
      'If the app/contact is not visible or cannot be found, call_user instead of typing anywhere else.',
    ].join('\n');
  }

  return [
    instructions,
    appName
      ? `The requested app is "${appName}". It should already be launching; if it is not visible, open or focus it first.`
      : 'Before typing or clicking, make sure the intended local app/window is visible and focused.',
    'Do not type user content while only the desktop wallpaper or an unrelated window is focused.',
    'If the target app cannot be opened or found, call_user instead of pretending the task is complete.',
  ].join('\n');
};

const quotedValue = (value: string) =>
  value.match(/["']([^"']+)["']/)?.[1]?.trim();

const cleanFolderName = (value: string) =>
  value
    .replace(/\b(on|in|at)\s+(?:my\s+)?(?:desktop|downloads?|documents?)\b.*$/i, '')
    .replace(/^(?:called|named)\s+/i, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '');

const extractRequestedFolderName = (value: string) => {
  const quoted = quotedValue(value);
  if (quoted) {
    return cleanFolderName(quoted);
  }

  const named = value.match(
    /\b(?:called|named)\s+([a-z0-9][\w .-]{0,120})/i,
  )?.[1];
  if (named) {
    return cleanFolderName(named);
  }

  const afterFolder = value.match(
    /\b(?:folder|directory|dir)\s+(?:called|named)?\s*([a-z0-9][\w .-]{0,120})/i,
  )?.[1];
  if (!afterFolder) {
    return '';
  }

  const cleaned = cleanFolderName(afterFolder);
  return /^(?:on|in|at|my|please)$/i.test(cleaned) ? '' : cleaned;
};

const knownFolderPath = (value: string) => {
  if (/\bdownloads?\b/i.test(value)) {
    return '~/Downloads';
  }
  if (/\bdocuments?\b/i.test(value)) {
    return '~/Documents';
  }
  if (/\bdesktop\b/i.test(value)) {
    return '~/Desktop';
  }
  return null;
};

const folderPath = (basePath: string, folderName: string) =>
  `${basePath}/${folderName}`;

const extractFinalAnswer = (messages: ConversationWithSoM[]) => {
  for (const message of [...messages].reverse()) {
    const finished = message.predictionParsed?.find(
      (prediction) => prediction.action_type === 'finished',
    );
    const content = finished?.action_inputs?.content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (message.from === 'gpt' && message.value?.trim()) {
      return message.value.trim();
    }
  }
  return '';
};

const getLatestRunState = (runId?: string) =>
  runId ? TaskRunRegistry.list().find((run) => run.runId === runId) : null;

const buildLocalCompletionAnswer = ({
  artifacts,
  evidence,
  fallback,
}: {
  artifacts: TaskArtifact[];
  evidence: string[];
  fallback: string;
}) => {
  const createdFiles = artifacts
    .map((artifact) => `- ${artifact.title}: ${artifact.path}`)
    .join('\n');
  const verification = evidence
    .filter((item) => item.trim())
    .slice(-4)
    .map((item) => `- ${item.trim()}`)
    .join('\n');

  if (createdFiles) {
    return [
      'Completed. Created the requested file output:',
      createdFiles,
      verification ? `Verification:\n${verification}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const terminalAnswer = extractTerminalAnswer(evidence);
  if (terminalAnswer) {
    return terminalAnswer;
  }

  return evidence
    .filter(Boolean)
    .map((item) => item.trim())
    .filter((item) => !/^Validated \d+ local computer actor step/i.test(item))
    .join('\n\n') || fallback;
};

const extractTerminalAnswer = (evidence: string[]) => {
  const latest = [...evidence].reverse().find((item) => /stdout:/i.test(item));
  const stdout = latest
    ?.match(/\nstdout:\n([\s\S]*?)(?:\n\nstderr:|\nstderr:|$)/i)?.[1]
    ?.trim();
  if (!stdout) {
    return '';
  }
  return stdout;
};

const composeVisualComputerPrompt = (
  basePrompt: string,
  memoryHint: string,
) => {
  const actorHint = `\n\n## Visual Computer Actor Contract\n- You are the Executor actor inside Neura's local computer Planner -> Executor -> Validator graph.\n- Use visible desktop UI actions only when native file/process tools cannot complete the step.\n- Each turn must perform exactly one executable GUI action or finish with concrete evidence visible in the latest screenshot.\n- In Thought, use compact public structure: Observation: ... Progress: ... Next: ... Do not reveal hidden chain-of-thought.\n- For local app requests, first make the named target app visible/focused. Never type user content while only the desktop wallpaper or an unrelated window is focused.\n- For messaging tasks, open/focus the messaging app, search/select the requested contact/chat, then type/send the exact requested message. If the app/contact is not visible or cannot be found, call_user.\n- Do not finish after only saying what you will do. Finish only after the current screenshot proves the requested UI state or local app action is complete.\n- If a click/type action did not change visible state, choose a different target, hotkey, wait, or call_user if blocked.\n${memoryHint}\n\n`;

  return basePrompt.replace(
    '## User Instruction\n',
    `${actorHint}## User Instruction\n`,
  );
};

const validateVisualMessagingEvidence = (
  instructions: string,
  evidence: string[],
) => {
  if (!/\b(send|message|text|dm)\b/i.test(instructions)) {
    return;
  }

  const actionEvidence = evidence.filter((item) =>
    /^(click|left_double|hotkey|type|wait|finished|call_user):/i.test(item),
  );
  const firstTypeIndex = actionEvidence.findIndex((item) =>
    /^type:/i.test(item),
  );
  if (firstTypeIndex < 0) {
    return;
  }

  const hasTargetingBeforeType = actionEvidence
    .slice(0, firstTypeIndex)
    .some((item) => /^(click|left_double|hotkey|wait):/i.test(item));
  if (!hasTargetingBeforeType) {
    throw new Error(
      'The visual worker typed before the target app/contact selection was visible. It must open/focus the requested app and select the target before typing.',
    );
  }
};

const createVisualModelConfig = (settings: LocalStore): NeuraModelConfig => ({
  baseURL: settings.vlmBaseUrl,
  apiKey: settings.vlmApiKey,
  model: settings.vlmModelName,
  max_tokens: settings.vlmProvider === 'NVIDIA NIM' ? 512 : undefined,
  timeout: settings.modelTimeoutInMs || 240_000,
  useResponsesApi: settings.useResponsesApi,
});

const createPlannerModelConfig = (
  settings: LocalStore,
): NeuraModelConfig | undefined =>
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

export function buildDeterministicLocalComputerPlan(
  instructions: string,
): LocalComputerPlan | null {
  const normalized = instructions.trim();

  if (
    /\b(time|date)\b/i.test(normalized) &&
    /\b(check|get|show|tell|run|execute|shell|command|terminal|powershell|cmd)\b/i.test(
      normalized,
    )
  ) {
    const command =
      process.platform === 'win32'
        ? "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"
        : "date '+%Y-%m-%d %H:%M:%S'";
    return {
      canHandle: true,
      reason: 'Deterministic local date/time command.',
      steps: [
        {
          id: 'check-date-time',
          actor: 'process_worker',
          tool: 'run_command',
          inputs: { command },
          purpose: 'Retrieve the current system time and date.',
          verification: 'Command returns the current date/time without errors.',
        },
      ],
    };
  }

  if (/check\s+(python|node|npm|pnpm|git)\s+version/i.test(normalized)) {
    const tool = normalized.match(/python|node|npm|pnpm|git/i)?.[0] || 'node';
    return {
      canHandle: true,
      reason: `Deterministic process check for ${tool}.`,
      steps: [
        {
          id: 'check-version',
          actor: 'process_worker',
          tool: 'run_command',
          inputs: { command: `${tool.toLowerCase()} --version` },
          purpose: `Check ${tool} version.`,
          verification: 'Command returns version output.',
        },
      ],
    };
  }

  if (/\bcreate\b.*\bfolder\b/i.test(normalized)) {
    const folderName = extractRequestedFolderName(normalized) || 'New Folder';
    const basePath = knownFolderPath(normalized);
    if (folderName && basePath) {
      return {
        canHandle: true,
        reason: 'Deterministic folder creation.',
        steps: [
          {
            id: 'create-folder',
            actor: 'file_worker',
            tool: 'create_folder',
            inputs: { path: folderPath(basePath, folderName) },
            purpose: `Create folder ${folderName}.`,
            verification: 'Folder creation tool succeeds.',
          },
        ],
      };
    }
  }

  if (/\blist\b.*\b(processes|neura-started processes)\b/i.test(normalized)) {
    return {
      canHandle: true,
      reason: 'Deterministic process listing.',
      steps: [
        {
          id: 'list-processes',
          actor: 'process_worker',
          tool: 'list_processes',
          inputs: {},
          purpose: 'List processes started by Neura.',
          verification: 'Process list tool returns status.',
        },
      ],
    };
  }

  return null;
}

const getPlannerConfig = (settings: LocalStore) => {
  const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl;
  const apiKey = settings.plannerApiKey || settings.vlmApiKey;
  const model =
    settings.usePlannerModel !== false && settings.plannerModelName
      ? settings.plannerModelName
      : settings.vlmModelName;

  if (!baseURL || !apiKey || !model) {
    return null;
  }

  return {
    baseURL,
    apiKey,
    model,
    timeout: settings.plannerTimeoutInMs || 90_000,
  };
};

const extractPlanJson = (value: string): LocalComputerPlan => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || value;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Planner returned no JSON object.');
  }
  const parsed = JSON.parse(
    candidate.slice(start, end + 1),
  ) as LocalComputerPlan;
  return {
    canHandle: Boolean(parsed.canHandle),
    reason:
      typeof parsed.reason === 'string' ? parsed.reason : 'Planner decision.',
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
  };
};

async function buildModelLocalComputerPlan(
  instructions: string,
  settings: LocalStore,
): Promise<LocalComputerPlan | null> {
  const config = getPlannerConfig(settings);
  if (!config) {
    return null;
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
  });
  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are Neura local-computer Planner.',
            'Return only JSON: { "canHandle": boolean, "reason": string, "steps": [...] }.',
            'Only canHandle=true when the task can be completed with native tools, not visual GUI clicks.',
            'Each step must have id, actor, tool, inputs, purpose, verification.',
            `Allowed tools: ${[...allowedNativeTools].join(', ')}`,
            'Allowed actors: file_worker, process_worker, connector_worker, validator.',
            'Use run_command only for explicit short command/version/test requests. Use start_process for servers/watchers.',
            'Do not invent file paths. If the user did not provide a needed path/name, canHandle=false.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: instructions,
        },
      ],
      stream: false,
    },
    { timeout: config.timeout },
  );

  const content = completion.choices?.[0]?.message?.content?.trim();
  return content ? extractPlanJson(content) : null;
}

export async function buildLocalComputerPlan(
  instructions: string,
  settings: LocalStore,
): Promise<LocalComputerPlan> {
  const deterministic = buildDeterministicLocalComputerPlan(instructions);
  if (deterministic) {
    return deterministic;
  }

  if (visualAppPattern.test(instructions)) {
    const appName = extractRequestedAppName(instructions);
    const visualStep: LocalComputerPlanStep = {
      id: 'visual-gui-execution',
      actor: 'visual_worker',
      tool: 'gui_agent',
      inputs: {
        content: buildLocalAppVisualInstruction(instructions, appName),
      },
      purpose:
        'Use the local computer vision/action executor for visible UI work.',
      verification:
        'Validator requires a finished action with visible-screen evidence or a blocked/error state.',
    };

    return {
      canHandle: true,
      reason: appName
        ? `Open or focus ${appName}, then complete the visible app action.`
        : 'Task requires visual desktop/app interaction.',
      steps: appName
        ? [
            {
              id: 'launch-local-app',
              actor: 'process_worker',
              tool: 'run_command',
              inputs: { command: buildLocalAppLaunchCommand(appName) },
              purpose: `Open or focus ${appName} before visual interaction.`,
              verification:
                'Launch/focus command returns and the visual worker verifies the screen state.',
            },
            visualStep,
          ]
        : [visualStep],
    };
  }

  const modelPlan = await buildModelLocalComputerPlan(
    instructions,
    settings,
  ).catch((error) => {
    logger.warn('[LocalComputerActorRunner] planner failed', error);
    return null;
  });
  return (
    modelPlan || {
      canHandle: false,
      reason: 'No deterministic or model-backed native-tool plan available.',
      steps: [],
    }
  );
}

const validatePlan = (plan: LocalComputerPlan) => {
  if (!plan.canHandle) {
    return;
  }
  if (!plan.steps.length) {
    throw new Error('Local computer plan has no executable steps.');
  }
  for (const step of plan.steps) {
    if (!allowedNativeTools.has(step.tool)) {
      throw new Error(`Planner selected unsupported native tool: ${step.tool}`);
    }
  }
};

const getComputerRuntimeModeForPlan = (
  plan: LocalComputerPlan,
): 'desktop' | 'terminal' => {
  if (plan.steps.some((step) => step.tool === 'gui_agent')) {
    return 'desktop';
  }
  if (
    plan.steps.some((step) =>
      ['run_command', 'start_process', 'read_process', 'stop_process'].includes(
        step.tool,
      ),
    )
  ) {
    return 'terminal';
  }
  return 'terminal';
};

async function runVisualGuiExecutor({
  instructions,
  settings,
  orchestrator,
  setState,
  getState,
}: RunnerArgs & { orchestrator: AgentOrchestrator }) {
  const modelConfig = createVisualModelConfig(settings);
  if (!modelConfig.apiKey?.trim()) {
    throw new Error(
      'NVIDIA NIM API key is missing. Open Neura settings and add the API key before running a local computer task.',
    );
  }

  const language = settings.language ?? 'en';
  const modelVersion = getModelVersion(settings.vlmProvider);
  const operator = new NutJSElectronOperator();
  const systemPrompt = composeVisualComputerPrompt(
    getSpByModelVersion(modelVersion, language, 'computer'),
    getAgentMemoryHint(settings),
  );
  const evidence: string[] = [];
  let actionCount = 0;

  const handleData: GUIAgentConfig<NutJSElectronOperator>['onData'] = async ({
    data,
  }) => {
    const { status, conversations, ...restUserData } = data;
    const conversationsWithSoM: ConversationWithSoM[] = conversations;

    setState({
      ...getState(),
      status,
      restUserData,
      taskState: getState().taskState,
      messages: [...(getState().messages || []), ...conversationsWithSoM],
    });

    for (const conversation of conversationsWithSoM) {
      if (
        conversation.screenshotBase64 &&
        conversation.screenshotContext?.size
      ) {
        evidence.push(
          `Screenshot observed: ${conversation.screenshotContext.size.width}x${conversation.screenshotContext.size.height}`,
        );
      }
      for (const prediction of conversation.predictionParsed || []) {
        const actionType = prediction.action_type;
        if (!actionType) {
          continue;
        }
        actionCount += 1;
        const target =
          prediction.action_inputs?.content ||
          prediction.action_inputs?.key ||
          prediction.action_inputs?.start_box ||
          prediction.action_inputs?.start_coords ||
          '';
        const detail = target
          ? `${actionType}: ${JSON.stringify(target).slice(0, 160)}`
          : actionType;
        evidence.push(detail);
        orchestrator.emit({
          type:
            actionType === 'finished'
              ? 'validation.completed'
              : 'step.completed',
          title:
            actionType === 'finished'
              ? 'Visual validator observed finish'
              : `visual_worker: ${actionType}`,
          detail,
          status: 'done',
        });
      }
      if (conversation.value?.trim() && conversation.from === 'gpt') {
        orchestrator.addFact(conversation.value.trim());
      }
    }
  };

  const guiAgent = new GUIAgent({
    model: modelConfig,
    plannerModel: createPlannerModelConfig(settings),
    systemPrompt,
    logger,
    signal: getState().abortController?.signal,
    operator,
    onData: handleData,
    onError: ({ error }) => {
      logger.error(
        '[LocalComputerActorRunner] visual GUI executor error',
        error,
      );
    },
    retry: {
      model: {
        maxRetries: 5,
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
  beforeAgentRun(Operator.LocalComputer);
  try {
    await guiAgent.run(instructions, getState().sessionHistoryMessages);
  } finally {
    afterAgentRun(Operator.LocalComputer);
  }

  const currentTask = getState().taskState;
  const currentStatus = getState().status;
  if (currentStatus === StatusEnum.USER_STOPPED) {
    throw new Error('User stopped the visual computer task.');
  }
  if (currentStatus === StatusEnum.ERROR) {
    throw new Error(getState().errorMsg || 'Visual computer task failed.');
  }

  const finalAnswer = extractFinalAnswer(getState().messages || []);
  const proofEvidence = evidence.filter(Boolean).slice(-20);
  validateVisualMessagingEvidence(instructions, proofEvidence);
  const validation = validateCompletionProof({
    originalGoal: currentTask?.originalGoal || instructions,
    runMode: 'gui_computer',
    answerText: finalAnswer,
    evidence: proofEvidence,
    artifactCount: currentTask?.artifacts.length || 0,
  });
  if (!validation.isValid) {
    throw new Error(validation.reason);
  }

  orchestrator.setCompletionProof({
    kind: 'local_action',
    summary: `Visual computer actor completed with ${actionCount} observed GUI action${actionCount === 1 ? '' : 's'}.`,
    evidence: proofEvidence,
    verifiedAt: Date.now(),
  });
  return finalAnswer || validation.reason;
}

export async function runLocalComputerActorAgent({
  instructions,
  settings,
  setState,
  getState,
}: RunnerArgs) {
  const plan = await buildLocalComputerPlan(instructions, settings);
  if (!plan.canHandle) {
    logger.info('[LocalComputerActorRunner] falling back to GUI loop', plan);
    return false;
  }

  validatePlan(plan);
  const orchestrator = new AgentOrchestrator({ getState, setState });
  orchestrator.begin(instructions, 'gui_computer');
  const runtimeMode = getComputerRuntimeModeForPlan(plan);
  ComputerRuntimeController.start({
    mode: runtimeMode,
    subtitle: runtimeMode === 'terminal' ? 'Terminal' : 'Desktop',
    display: runtimeMode === 'terminal' ? 'Local terminal' : 'Local desktop',
    activity: plan.reason,
  });
  orchestrator.emit({
    type: 'plan.updated',
    title: 'Local computer actor plan',
    detail: plan.reason,
    status: 'done',
  });

  const evidence: string[] = [];
  try {
    for (const step of plan.steps) {
      orchestrator.emit({
        type: 'step.started',
        title: `${step.actor}: ${step.tool}`,
        detail: step.purpose,
        status: 'in_progress',
      });
      let stepResultMessage = step.verification;
      if (step.tool === 'gui_agent') {
        const result = await runVisualGuiExecutor({
          instructions: step.inputs.content || instructions,
          settings,
          orchestrator,
          setState,
          getState,
        });
        stepResultMessage = result;
        evidence.push(result);
        orchestrator.addFact(result);
      } else {
        const result = await executeNativeComputerTool(step.tool, step.inputs);
        stepResultMessage = result.message;
        evidence.push(result.message);
        orchestrator.addFact(result.message);
        const refreshedRun = getLatestRunState(getState().taskState?.runId);
        if (refreshedRun) {
          setState({
            ...getState(),
            taskState: refreshedRun,
          });
        }
        if (result.status === StatusEnum.USER_STOPPED) {
          throw new Error(result.message);
        }
        if (result.status === StatusEnum.ERROR) {
          throw new Error(result.message);
        }
      }
      ComputerRuntimeController.update({
        status: 'running',
        activity: step.verification || stepResultMessage,
      });
      orchestrator.emit({
        type: 'step.completed',
        title: `${step.tool} completed`,
        detail: step.verification || stepResultMessage,
        status: 'done',
      });
    }

    const current =
      getLatestRunState(getState().taskState?.runId) || getState().taskState;
    const artifactPaths =
      current?.artifacts.map((artifact) => artifact.path) || [];
    const proofEvidence = [...artifactPaths, ...evidence].filter(Boolean);
    orchestrator.emit({
      type: 'validation.completed',
      title: 'Task verified',
      detail: `Completed ${plan.steps.length} computer step${plan.steps.length === 1 ? '' : 's'}.`,
      status: 'done',
    });
    if (!current?.completionProof) {
      orchestrator.setCompletionProof({
        kind: artifactPaths.length ? 'artifact' : 'local_action',
        summary: `Local computer actor plan completed ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}.`,
        evidence: proofEvidence.slice(0, 20),
        verifiedAt: Date.now(),
      });
    }
    orchestrator.complete(
      buildLocalCompletionAnswer({
        artifacts: current?.artifacts || [],
        evidence,
        fallback: `Validated ${plan.steps.length} local computer actor step${plan.steps.length === 1 ? '' : 's'}.`,
      }),
    );
    ComputerRuntimeController.complete('Local computer task completed');
    return true;
  } catch (error) {
    orchestrator.fail(error instanceof Error ? error.message : String(error));
    setState({
      ...getState(),
      status: StatusEnum.ERROR,
    });
    ComputerRuntimeController.fail(
      error instanceof Error ? error.message : String(error),
    );
    return true;
  }
}
