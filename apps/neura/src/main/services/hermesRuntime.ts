/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import { LocalStore } from '@main/store/types';

export type HermesRunResult = {
  finalAnswer: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
};

export type HermesRunInput = {
  prompt: string;
  cwd?: string;
  toolsets?: string[];
  signal?: AbortSignal;
  onProgress?: (event: {
    title: string;
    detail?: string;
    status?: 'pending' | 'in_progress' | 'done' | 'failed';
  }) => void;
};

const DEFAULT_TOOLSETS = ['web', 'terminal', 'file', 'browser', 'moa'];

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

const writeHermesConfig = async ({
  hermesHome,
  settings,
  cwd,
  toolsets,
}: {
  hermesHome: string;
  settings: LocalStore;
  cwd: string;
  toolsets: string[];
}) => {
  const { baseURL, apiKey, model } = getModelSettings(settings);
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      'Hermes backend requires a configured Neura planner/chat model, base URL, and API key.',
    );
  }

  await fs.promises.mkdir(hermesHome, { recursive: true });
  await fs.promises.mkdir(path.join(hermesHome, 'logs'), { recursive: true });
  await fs.promises.mkdir(path.join(hermesHome, 'sessions'), {
    recursive: true,
  });
  await fs.promises.mkdir(path.join(hermesHome, 'memories'), {
    recursive: true,
  });

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
    '  cloud_provider: local',
    '  use_gateway: false',
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

  return { baseURL, model };
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
    const toolsets = input.toolsets?.length ? input.toolsets : DEFAULT_TOOLSETS;
    const { model } = await writeHermesConfig({
      hermesHome,
      settings,
      cwd,
      toolsets,
    });

    input.onProgress?.({
      title: 'Hermes backend configured',
      detail: `Model: ${model}. Toolsets: ${toolsets.join(', ')}`,
      status: 'done',
    });

    const useUv = fs.existsSync(path.join(hermesRoot, 'pyproject.toml'));
    const command = useUv ? resolveUvCommand() : resolvePythonCommand(hermesRoot);
    const pythonVersion = process.env.HERMES_PYTHON_VERSION || '3.12';
    const args = useUv
      ? [
          'run',
          '--python',
          pythonVersion,
          '--project',
          hermesRoot,
          'python',
          '-m',
          'hermes_cli.main',
          '-z',
          prompt,
          '--provider',
          'custom',
          '--model',
          model,
          '--toolsets',
          toolsets.join(','),
        ]
      : [
          '-m',
          'hermes_cli.main',
          '-z',
          prompt,
          '--provider',
          'custom',
          '--model',
          model,
          '--toolsets',
          toolsets.join(','),
        ];

    input.onProgress?.({
      title: 'Hermes agent started',
      detail: command,
      status: 'in_progress',
    });

    logger.info('[HermesRuntime] starting Hermes backend', {
      command,
      hermesRoot,
      hermesHome,
      cwd,
      toolsets,
      model,
    });

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: hermesRoot,
        windowsHide: true,
        env: {
          ...process.env,
          HERMES_HOME: hermesHome,
          HERMES_QUIET: '1',
          HERMES_YOLO_MODE: '1',
          HERMES_ACCEPT_HOOKS: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          OPENAI_API_KEY: getModelSettings(settings).apiKey,
          OPENROUTER_API_KEY: getModelSettings(settings).apiKey,
          CUSTOM_BASE_URL: getModelSettings(settings).baseURL,
          HERMES_INFERENCE_PROVIDER: 'custom',
          HERMES_INFERENCE_MODEL: model,
        },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const abort = () => {
        if (child.killed) {
          return;
        }
        child.kill();
      };
      input.signal?.addEventListener('abort', abort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        const line = chunk.trim();
        if (line) {
          input.onProgress?.({
            title: 'Hermes backend output',
            detail: line.slice(0, 900),
            status: 'in_progress',
          });
        }
      });
      child.on('error', (error) => {
        input.signal?.removeEventListener('abort', abort);
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });
      child.on('close', (code) => {
        input.signal?.removeEventListener('abort', abort);
        if (settled) {
          return;
        }
        settled = true;
        const exitCode = code ?? 1;
        const finalAnswer = stdout.trim();
        if (input.signal?.aborted) {
          reject(new Error('Hermes task was cancelled.'));
          return;
        }
        if (exitCode !== 0) {
          reject(
            new Error(
              stderr.trim() ||
                finalAnswer ||
                `Hermes exited with code ${exitCode}.`,
            ),
          );
          return;
        }
        resolve({
          finalAnswer: finalAnswer || 'Hermes completed without a final answer.',
          stdout,
          stderr,
          exitCode,
          command,
        });
      });
    });
  }
}
