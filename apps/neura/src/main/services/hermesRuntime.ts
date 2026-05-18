/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import { HermesBrowserBackend, LocalStore } from '@main/store/types';
import {
  HERMES_BRIDGE_EVENT_PREFIX,
  HERMES_BRIDGE_SCRIPT,
} from './hermesBridgeScript';
import {
  releaseHermesBrowserBridge,
  startHermesBrowserBridge,
} from './hermesBrowserBridge';
import { registerExternalTerminalProcess } from './nativeComputerTools';

export type HermesRunResult = {
  finalAnswer: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
};

export type HermesBridgeEvent = {
  type: string;
  time?: number;
  toolName?: string;
  callId?: string;
  preview?: string;
  arguments?: Record<string, unknown>;
  resultPreview?: string;
  duration?: number;
  isError?: boolean;
  stream?: 'stdout' | 'stderr';
  text?: string;
  message?: string;
  channel?: string;
  finalAnswer?: string;
  error?: string;
  traceback?: string;
  cwd?: string;
  model?: string;
  toolsets?: string[];
};

export type HermesRunInput = {
  prompt: string;
  sessionId?: string;
  conversationHistory?: Array<Record<string, unknown>>;
  cwd?: string;
  toolsets?: string[];
  browserBackend?: HermesBrowserBackend;
  keepBrowserAlive?: boolean;
  signal?: AbortSignal;
  onProcessStart?: (event: {
    processId: string;
    command: string;
    cwd: string;
  }) => void;
  onOutput?: (event: {
    command: string;
    cwd: string;
    stdout?: string;
    stderr?: string;
    raw?: string;
    failed: boolean;
  }) => void;
  onEvent?: (event: HermesBridgeEvent) => void;
  onProgress?: (event: {
    title: string;
    detail?: string;
    status?: 'pending' | 'in_progress' | 'done' | 'failed';
  }) => void;
};

const DEFAULT_TOOLSETS = ['hermes-cli'];
const HERMES_BROWSER_TOOLSETS = new Set([
  'all',
  '*',
  'browser',
  'hermes-acp',
  'hermes-api-server',
  'hermes-cli',
  'hermes-cron',
  'hermes-telegram',
  'hermes-discord',
  'hermes-slack',
]);
const MAX_LIVE_OUTPUT = 64_000;
const NEURA_HERMES_SOUL = [
  '# Neura Hermes Profile',
  '',
  'You are the Hermes autonomous runtime inside Neura Desktop.',
  'Neura is the user-facing cockpit. Hermes performs planning, terminal work, browser work, file work, research, memory, and skill-driven execution.',
  'Use persistent memory for durable user preferences, recurring corrections, stable environment facts, and project conventions that will still matter later.',
  'Use session history for temporary task state, recent outputs, completed-work logs, commit hashes, PR numbers, and anything likely to become stale.',
  'Never store passwords, API keys, session tokens, private cookies, credentials, or one-off secrets in memory.',
  'When the user corrects how Neura or Hermes should work, treat the correction as a candidate memory if it is stable and useful across future sessions.',
  'Show useful progress through tools and final answers so Neura can display what happened clearly.',
  '',
].join('\n');

const findWorkspaceRoot = (start: string) => {
  let current = start;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return start;
};

const yamlString = (value: string) => JSON.stringify(value || '');

const dotenvString = (value: string) =>
  JSON.stringify(value || '').replace(/\n/g, '\\n');

const withRequiredToolsets = (toolsets: string[]) => {
  const seen = new Set<string>();
  return [...toolsets, 'memory'].filter((toolset) => {
    const normalized = toolset.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const toolsetsNeedBrowserBridge = (toolsets: string[]) =>
  toolsets.some((toolset) => HERMES_BROWSER_TOOLSETS.has(toolset));

const isLocalBrowserBackend = (backend?: HermesBrowserBackend) =>
  !backend || backend === 'local';

const compactOutput = (value: string) =>
  value.length > MAX_LIVE_OUTPUT ? value.slice(-MAX_LIVE_OUTPUT) : value;

const shellDisplay = (command: string, args: string[]) =>
  [command, ...args]
    .map((part) =>
      /[\s"]/u.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part,
    )
    .join(' ');

const publicToolName = (toolName?: string) => {
  const normalized = (toolName || 'tool')
    .replace(/^hermes[._:-]?/i, '')
    .replace(/^browser_/i, 'browser ')
    .replace(/^terminal$/i, 'command')
    .replace(/_/g, ' ')
    .trim();

  if (/browser/i.test(normalized)) {
    return 'browser action';
  }
  if (/terminal|command|shell/i.test(normalized)) {
    return 'command';
  }
  if (/memory/i.test(normalized)) {
    return 'memory';
  }
  if (/todo|plan/i.test(normalized)) {
    return 'planning';
  }
  return normalized || 'tool';
};

const publicProgressDetail = (value?: string) => {
  const cleaned = (value || '')
    .replace(/hermes[-_.]agent/gi, 'runtime')
    .replace(/\bHermes\b/g, 'Neura')
    .replace(/file:\/\/\/[^\s)]+/g, '[runtime files]')
    .replace(/C:\\Users\\[^\s]+/gi, '[local path]')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return undefined;
  }
  if (
    /^(Using CPython|Creating virtual environment|Building runtime|Built runtime|Installed \d+ packages|Resolved \d+ packages)/i.test(
      cleaned,
    )
  ) {
    return 'Preparing the local runtime.';
  }
  if (/<(html|xml|rdf|!doctype)|xmlns=|rdf:resource=/i.test(cleaned)) {
    return 'Read page content.';
  }
  if (/CDP WebSocket connect failed|No connection could be made/i.test(cleaned)) {
    return 'Browser connection is still starting.';
  }
  return cleaned.length > 220 ? `${cleaned.slice(0, 220)}...` : cleaned;
};

const resolveHermesRoot = () => {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const devRoot = path.join(workspaceRoot, 'third_party', 'hermes-agent');
  if (fs.existsSync(path.join(devRoot, 'hermes_cli'))) {
    return devRoot;
  }

  const resourceRoot = path.join(process.resourcesPath, 'hermes-agent');
  if (fs.existsSync(path.join(resourceRoot, 'hermes_cli'))) {
    return resourceRoot;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const installedRoot = path.join(localAppData, 'hermes', 'hermes-agent');
    if (fs.existsSync(path.join(installedRoot, 'hermes_cli'))) {
      return installedRoot;
    }
  }

  return devRoot;
};

const resolveUvCommand = () => {
  const candidates = [
    process.env.UV_EXE,
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'uv.exe'),
    'uv',
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => {
    if (candidate === 'uv') {
      return true;
    }
    return fs.existsSync(candidate);
  }) || 'uv';
};

const resolvePythonCommand = (hermesRoot: string) => {
  const dotVenvPython =
    process.platform === 'win32'
      ? path.join(hermesRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(hermesRoot, '.venv', 'bin', 'python');
  if (fs.existsSync(dotVenvPython)) {
    return dotVenvPython;
  }

  const localVenvPython =
    process.platform === 'win32'
      ? path.join(hermesRoot, 'venv', 'Scripts', 'python.exe')
      : path.join(hermesRoot, 'venv', 'bin', 'python');
  if (fs.existsSync(localVenvPython)) {
    return localVenvPython;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
};

const getModelSettings = (settings: LocalStore) => {
  const baseURL = (settings.plannerBaseUrl || settings.vlmBaseUrl || '').trim();
  const apiKey = (settings.plannerApiKey || settings.vlmApiKey || '').trim();
  const model =
    settings.usePlannerModel !== false && settings.plannerModelName?.trim()
      ? settings.plannerModelName.trim()
      : (settings.vlmModelName || '').trim();

  return { baseURL, apiKey, model };
};

const ensureHermesProfile = async (hermesHome: string) => {
  const directories = [
    'logs',
    'logs/curator',
    'sessions',
    'memories',
    'skills',
    'hooks',
    'pairing',
  ];

  await fs.promises.mkdir(hermesHome, { recursive: true });
  await Promise.all(
    directories.map((directory) =>
      fs.promises.mkdir(path.join(hermesHome, directory), { recursive: true }),
    ),
  );

  const soulPath = path.join(hermesHome, 'SOUL.md');
  let shouldWriteSoul = false;

  try {
    const existing = await fs.promises.readFile(soulPath, 'utf8');
    shouldWriteSoul =
      !existing.trim() ||
      (existing.includes('You are Hermes Agent') &&
        existing.includes('created by Nous Research') &&
        !existing.includes('Neura Desktop'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    shouldWriteSoul = true;
  }

  if (shouldWriteSoul) {
    await fs.promises.writeFile(soulPath, NEURA_HERMES_SOUL, 'utf8');
  }
};

const writeHermesConfig = async ({
  hermesHome,
  settings,
  cwd,
  toolsets,
  browserBackend,
  browserCdpUrl,
}: {
  hermesHome: string;
  settings: LocalStore;
  cwd: string;
  toolsets: string[];
  browserBackend: HermesBrowserBackend;
  browserCdpUrl?: string;
}) => {
  const { baseURL, apiKey, model } = getModelSettings(settings);
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      'Hermes backend requires a configured Neura planner/chat model, base URL, and API key.',
    );
  }

  await ensureHermesProfile(hermesHome);

  const apiMode =
    settings.useResponsesApi || /api\.openai\.com/i.test(baseURL)
      ? 'codex_responses'
      : 'chat_completions';

  const config = [
    'model:',
    '  provider: custom',
    `  default: ${yamlString(model)}`,
    `  base_url: ${yamlString(baseURL)}`,
    `  api_mode: ${yamlString(apiMode)}`,
    'toolsets:',
    ...toolsets.map((toolset) => `  - ${yamlString(toolset)}`),
    'terminal:',
    `  cwd: ${yamlString(cwd)}`,
    'browser:',
    `  cloud_provider: ${yamlString(browserBackend)}`,
    `  use_gateway: ${settings.hermesUseGateway ? 'true' : 'false'}`,
    ...(browserCdpUrl ? [`  cdp_url: ${yamlString(browserCdpUrl)}`] : []),
    'web:',
    ...(settings.hermesWebBackend && settings.hermesWebBackend !== 'auto'
      ? [`  backend: ${yamlString(settings.hermesWebBackend)}`]
      : []),
    `  use_gateway: ${settings.hermesUseGateway ? 'true' : 'false'}`,
    'memory:',
    '  memory_enabled: true',
    '  user_profile_enabled: true',
    '  memory_char_limit: 2200',
    '  user_char_limit: 1375',
    '  provider: ""',
    'display:',
    '  streaming: false',
    '',
  ].join('\n');

  const envFile = [
    `OPENAI_API_KEY=${dotenvString(apiKey)}`,
    `OPENROUTER_API_KEY=${dotenvString(apiKey)}`,
    `CUSTOM_BASE_URL=${dotenvString(baseURL)}`,
    `HERMES_INFERENCE_PROVIDER=${dotenvString('custom')}`,
    `HERMES_INFERENCE_MODEL=${dotenvString(model)}`,
    '',
  ].join('\n');

  await fs.promises.writeFile(
    path.join(hermesHome, 'config.yaml'),
    config,
    'utf8',
  );
  await fs.promises.writeFile(path.join(hermesHome, '.env'), envFile, 'utf8');

  return { apiMode, baseURL, apiKey, model };
};

const writeHermesBridgeFiles = async ({
  hermesHome,
  hermesRoot,
  prompt,
  cwd,
  model,
  baseURL,
  apiMode,
  toolsets,
  sessionId,
  conversationHistory,
}: {
  hermesHome: string;
  hermesRoot: string;
  prompt: string;
  cwd: string;
  model: string;
  baseURL: string;
  apiMode: string;
  toolsets: string[];
  sessionId?: string;
  conversationHistory?: Array<Record<string, unknown>>;
}) => {
  const bridgeDir = path.join(hermesHome, 'neura-bridge');
  await fs.promises.mkdir(bridgeDir, { recursive: true });

  const scriptPath = path.join(bridgeDir, 'neura_hermes_bridge.py');
  const inputPath = path.join(bridgeDir, `run-${randomUUID()}.json`);
  await fs.promises.writeFile(scriptPath, HERMES_BRIDGE_SCRIPT, 'utf8');
  await fs.promises.writeFile(
    inputPath,
    JSON.stringify(
      {
        apiMode,
        baseURL,
        cwd,
        hermesRoot,
        model,
        prompt,
        provider: 'custom',
        sessionId,
        conversationHistory: conversationHistory || [],
        toolsets,
      },
      null,
      2,
    ),
    'utf8',
  );

  return { inputPath, scriptPath };
};

export class HermesRuntimeService {
  private static instance: HermesRuntimeService | null = null;

  static getInstance() {
    if (!HermesRuntimeService.instance) {
      HermesRuntimeService.instance = new HermesRuntimeService();
    }
    return HermesRuntimeService.instance;
  }

  getHermesRoot() {
    return resolveHermesRoot();
  }

  getHermesHome() {
    return path.join(app.getPath('userData'), 'hermes');
  }

  async run(input: HermesRunInput): Promise<HermesRunResult> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Hermes prompt is required.');
    }

    const settings = SettingStore.getStore();
    const hermesRoot = this.getHermesRoot();
    const hermesHome = this.getHermesHome();
    const cwd = input.cwd || app.getPath('home');
    const toolsets = withRequiredToolsets(
      input.toolsets?.length ? input.toolsets : DEFAULT_TOOLSETS,
    );
    const browserBackend = input.browserBackend || settings.hermesBrowserBackend || 'local';
    const browserBridge =
      toolsetsNeedBrowserBridge(toolsets) && isLocalBrowserBackend(browserBackend)
      ? await startHermesBrowserBridge({
          signal: input.signal,
          onProgress: input.onProgress,
        })
      : null;
    const { apiMode, baseURL, model } = await writeHermesConfig({
      hermesHome,
      settings,
      cwd,
      toolsets,
      browserBackend,
      browserCdpUrl: browserBridge?.cdpUrl,
    });
    const { inputPath, scriptPath } = await writeHermesBridgeFiles({
      hermesHome,
      hermesRoot,
      prompt,
      cwd,
      model,
      baseURL,
      apiMode,
      toolsets,
      sessionId: input.sessionId,
      conversationHistory: input.conversationHistory,
    });

    input.onProgress?.({
      title: 'Runtime configured',
      detail: `Model: ${model}. Tools: ${toolsets.length}`,
      status: 'done',
    });
    if (toolsets.includes('memory')) {
      input.onProgress?.({
        title: 'Memory ready',
        detail: 'Persistent task context is available.',
        status: 'done',
      });
    }

    const pythonCommand = resolvePythonCommand(hermesRoot);
    const hasReadyVenv = path.basename(pythonCommand).toLowerCase().startsWith('python') &&
      pythonCommand !== 'python' &&
      pythonCommand !== 'python3';
    const useUv =
      !hasReadyVenv && fs.existsSync(path.join(hermesRoot, 'pyproject.toml'));
    const command = useUv ? resolveUvCommand() : pythonCommand;
    const pythonVersion = process.env.HERMES_PYTHON_VERSION || '3.12';
    const args = useUv
      ? [
          'run',
          '--python',
          pythonVersion,
          '--project',
          hermesRoot,
          'python',
          scriptPath,
          '--input',
          inputPath,
        ]
      : [
          scriptPath,
          '--input',
          inputPath,
        ];

    input.onProgress?.({
      title: 'Runtime started',
      detail: 'Preparing the local execution environment.',
      status: 'in_progress',
    });

    logger.info('[HermesRuntime] starting Hermes backend', {
      command,
      hermesRoot,
      hermesHome,
      cwd,
      toolsets,
      browserBackend,
      model,
    });

    return new Promise((resolve, reject) => {
      const displayCommand = shellDisplay(command, args);
      const child = spawn(command, args, {
        cwd: hermesRoot,
        windowsHide: true,
        env: {
          ...process.env,
          HERMES_HOME: hermesHome,
          HERMES_YOLO_MODE: '1',
          HERMES_ACCEPT_HOOKS: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          ...(browserBridge?.cdpUrl
            ? {
                BROWSER_CDP_URL: browserBridge.cdpUrl,
              }
            : {}),
          OPENAI_API_KEY: getModelSettings(settings).apiKey,
          OPENROUTER_API_KEY: getModelSettings(settings).apiKey,
          CUSTOM_BASE_URL: getModelSettings(settings).baseURL,
          HERMES_INFERENCE_PROVIDER: 'custom',
          HERMES_INFERENCE_MODEL: model,
        },
      });
      const processId = registerExternalTerminalProcess({
        child,
        command: displayCommand,
        cwd: hermesRoot,
      });
      input.onProcessStart?.({
        processId,
        command: displayCommand,
        cwd: hermesRoot,
      });

      let stdout = '';
      let stderr = '';
      let finalAnswer = '';
      let stdoutLineBuffer = '';
      let settled = false;
      const cleanupBridgeInput = () => {
        void fs.promises.unlink(inputPath).catch(() => undefined);
      };

      const abort = () => {
        if (child.killed) {
          return;
        }
        child.kill();
        browserBridge?.stop();
      };
      input.signal?.addEventListener('abort', abort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      const emitOutput = (nextStdout = stdout, nextStderr = stderr, failed = false) => {
        input.onOutput?.({
          command: displayCommand,
          cwd: hermesRoot,
          stdout: nextStdout,
          stderr: nextStderr,
          failed,
        });
      };
      const handleBridgeEvent = (event: HermesBridgeEvent) => {
        input.onEvent?.(event);

        if (event.type === 'run.completed' && typeof event.finalAnswer === 'string') {
          finalAnswer = event.finalAnswer;
        }

        if (event.type === 'stream.output') {
          if (event.stream === 'stderr') {
            stderr = compactOutput(
              `${stderr}${stderr ? '\n' : ''}${event.text || ''}`,
            );
          } else {
            stdout = compactOutput(
              `${stdout}${stdout ? '\n' : ''}${event.text || ''}`,
            );
          }
          emitOutput();
          return;
        }

        if (event.type === 'tool.started' || event.type === 'tool.call.started') {
          const toolLabel = publicToolName(event.toolName);
          input.onProgress?.({
            title: `Using ${toolLabel}`,
            detail: publicProgressDetail(
              event.preview || JSON.stringify(event.arguments || {}),
            ),
            status: 'in_progress',
          });
          return;
        }

        if (event.type === 'tool.completed' || event.type === 'tool.call.completed') {
          const toolLabel = publicToolName(event.toolName);
          input.onProgress?.({
            title: `${toolLabel[0]?.toUpperCase() || 'T'}${toolLabel.slice(1)} completed`,
            detail: publicProgressDetail(event.resultPreview || event.preview),
            status: event.isError ? 'failed' : 'done',
          });
          return;
        }

        if (event.type === 'status' || event.type === 'thinking') {
          input.onProgress?.({
            title: publicProgressDetail(event.message) || 'Working',
            status: 'in_progress',
          });
          return;
        }

        if (event.type === 'run.failed') {
          input.onProgress?.({
            title: 'Runtime failed',
            detail: publicProgressDetail(event.error || event.traceback),
            status: 'failed',
          });
        }
      };
      const handleStdoutLine = (line: string) => {
        if (!line) {
          return;
        }
        if (line.startsWith(HERMES_BRIDGE_EVENT_PREFIX)) {
          try {
            handleBridgeEvent(
              JSON.parse(line.slice(HERMES_BRIDGE_EVENT_PREFIX.length)),
            );
          } catch (error) {
            stderr = compactOutput(
              `${stderr}${stderr ? '\n' : ''}Invalid Hermes bridge event: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            emitOutput();
          }
          return;
        }

        stdout = compactOutput(`${stdout}${stdout ? '\n' : ''}${line}`);
        emitOutput();
      };
      child.stdout.on('data', (chunk: string) => {
        stdoutLineBuffer += chunk;
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() || '';
        lines.forEach(handleStdoutLine);
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = compactOutput(stderr + chunk);
        emitOutput();
        const line = chunk.trim();
        const publicLine = publicProgressDetail(line);
        if (publicLine && /preparing|install|runtime/i.test(publicLine)) {
          input.onProgress?.({
            title: 'Preparing runtime',
            detail: publicLine,
            status: 'in_progress',
          });
        }
      });
      child.on('error', (error) => {
        input.signal?.removeEventListener('abort', abort);
        browserBridge?.stop();
        cleanupBridgeInput();
        if (settled) {
          return;
        }
        settled = true;
        emitOutput(stdout, `${stderr}${stderr ? '\n' : ''}${error.message}`, true);
        reject(error);
      });
      child.on('close', (code) => {
        input.signal?.removeEventListener('abort', abort);
        if (input.signal?.aborted) {
          browserBridge?.stop();
        } else if (!input.keepBrowserAlive) {
          releaseHermesBrowserBridge(browserBridge);
        }
        cleanupBridgeInput();
        if (settled) {
          return;
        }
        settled = true;
        if (stdoutLineBuffer.trim()) {
          handleStdoutLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }
        const exitCode = code ?? 1;
        const resolvedFinalAnswer = finalAnswer.trim() || stdout.trim();
        if (input.signal?.aborted) {
          reject(new Error('Task was cancelled.'));
          return;
        }
        if (exitCode !== 0) {
          emitOutput(stdout, stderr, true);
          reject(
            new Error(
              stderr.trim() ||
                resolvedFinalAnswer ||
                `Runtime exited with code ${exitCode}.`,
            ),
          );
          return;
        }
        emitOutput(stdout, stderr, false);
        resolve({
          finalAnswer:
            resolvedFinalAnswer || 'Neura completed without a final answer.',
          stdout,
          stderr,
          exitCode,
          command: displayCommand,
        });
      });
    });
  }
}
