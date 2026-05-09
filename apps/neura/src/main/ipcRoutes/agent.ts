/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  Button as MouseButton,
  Key,
  Point,
  keyboard,
  mouse,
  straightTo,
} from '@computer-use/nut-js';
import { initIpc } from '@neura-desktop/electron-ipc/main';
import { StatusEnum, Conversation, Message } from '@neura-desktop/shared/types';
import { store } from '@main/store/create';
import { runAgent } from '@main/services/runAgent';
import { showWindow } from '@main/window/index';
import OpenAI from 'openai';

import { GUIAgent } from '@neura-desktop/sdk';
import { Operator } from '@neura-desktop/sdk/core';
import { SettingStore } from '@main/store/setting';
import { logger } from '@main/logger';
import { runQuickLocalTask } from '@main/services/quickLocalTask';
import { resolveUserApproval } from '@main/services/approvalGate';
import { TaskRunRegistry } from '@main/services/taskRunRegistry';
import { ComputerRuntimeController } from '@main/services/computerRuntimeController';
import { writeProcessInput } from '@main/services/nativeComputerTools';

const t = initIpc.create();

const takeoverKeyMap: Record<string, Key> = {
  enter: Key.Enter,
  return: Key.Enter,
  backspace: Key.Backspace,
  delete: Key.Delete,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  space: Key.Space,
  arrowup: Key.Up,
  arrowdown: Key.Down,
  arrowleft: Key.Left,
  arrowright: Key.Right,
  pagedown: Key.PageDown,
  pageup: Key.PageUp,
  home: Key.Home,
  end: Key.End,
};

const takeoverHotkeyMap: Record<string, Key> = {
  ...takeoverKeyMap,
  ctrl: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl,
  control: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl,
  shift: Key.LeftShift,
  alt: Key.LeftAlt,
  meta: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftWin,
  cmd: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftWin,
  command: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftWin,
  win: Key.LeftWin,
};

const getTakeoverHotkeys = (value: string) =>
  value
    .split(/[\s+]+/)
    .map((part) => takeoverHotkeyMap[part.toLowerCase()])
    .filter(Boolean);

const formatRunSummary = (
  run: NonNullable<ReturnType<typeof TaskRunRegistry.list>[number]>,
) =>
  [
    `# ${run.originalGoal}`,
    '',
    `Run ID: ${run.runId}`,
    `Mode: ${run.runMode}`,
    `Status: ${run.status}`,
    `Started: ${new Date(run.startedAt).toLocaleString()}`,
    run.completedAt
      ? `Completed: ${new Date(run.completedAt).toLocaleString()}`
      : 'Completed: Not finished',
    '',
    '## Final Answer',
    '',
    run.finalAnswer || run.error || 'No final answer recorded.',
    '',
    '## Progress',
    '',
    ...(run.progressItems.length
      ? run.progressItems.map(
          (item) =>
            `- ${item.status}: ${item.title}${item.detail ? ` - ${item.detail}` : ''}`,
        )
      : ['- No progress events recorded.']),
    '',
    '## Artifacts',
    '',
    ...(run.artifacts.length
      ? run.artifacts.map((artifact) => `- ${artifact.title}: ${artifact.path}`)
      : ['- No artifacts recorded.']),
    '',
    '## Sources',
    '',
    ...(run.sourcesVisited.length
      ? run.sourcesVisited.map((source) => `- ${source}`)
      : ['- No sources recorded.']),
    '',
    '## Approvals',
    '',
    ...(run.approvalEvents.length
      ? run.approvalEvents.map(
          (event) =>
            `- ${event.status}: ${event.action}${event.target ? ` (${event.target})` : ''}`,
        )
      : ['- No approval events recorded.']),
    '',
  ].join('\n');

export class GUIAgentManager {
  private static instance: GUIAgentManager;
  private currentAgent: GUIAgent<Operator> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): GUIAgentManager {
    if (!GUIAgentManager.instance) {
      GUIAgentManager.instance = new GUIAgentManager();
    }
    return GUIAgentManager.instance;
  }

  public setAgent(agent: GUIAgent<Operator>) {
    this.currentAgent = agent;
  }

  public getAgent(): GUIAgent<Operator> | null {
    return this.currentAgent;
  }

  public clearAgent() {
    this.currentAgent = null;
  }
}

export const agentRoute = t.router({
  runQuickLocalTask: t.procedure
    .input<{ instructions: string }>()
    .handle(async ({ input }) => {
      try {
        return await runQuickLocalTask(input.instructions);
      } catch (error) {
        logger.warn('[runQuickLocalTask] failed:', error);
        return {
          handled: true,
          message: `I tried to complete that local task quickly, but it failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }),
  directChat: t.procedure
    .input<{ instructions: string; history?: Message[] }>()
    .handle(async ({ input }) => {
      const instructions = input.instructions.trim();
      const settings = SettingStore.getStore();
      const baseURL = settings.plannerBaseUrl || settings.vlmBaseUrl;
      const apiKey = settings.plannerApiKey || settings.vlmApiKey;
      const model =
        settings.usePlannerModel !== false && settings.plannerModelName
          ? settings.plannerModelName
          : settings.vlmModelName;

      if (!instructions) {
        return '';
      }

      if (!apiKey || !baseURL || !model) {
        if (/^(hi|hii|hello|hey)\s*[!.?]*$/i.test(instructions)) {
          return 'Hi. What would you like me to do?';
        }
        return 'I can answer directly once a chat/planner model is configured. For automation tasks, ask me to open, search, click, or work on a file.';
      }

      try {
        const openai = new OpenAI({
          apiKey,
          baseURL,
          maxRetries: 0,
        });

        const history = (input.history || [])
          .filter((message) => message.value && message.value !== '<image>')
          .slice(-8)
          .map((message) => ({
            role: message.from === 'human' ? 'user' : 'assistant',
            content: message.value,
          })) as Array<{
          role: 'user' | 'assistant';
          content: string;
        }>;

        const completion = await openai.chat.completions.create(
          {
            model,
            temperature: 0.4,
            max_tokens: 700,
            stream: false,
            messages: [
              {
                role: 'system',
                content:
                  'You are Neura in direct-answer mode. Reply conversationally and concisely. Never claim you are operating the browser, clicking anything, seeing the screen, typing into apps, running shell commands, managing processes, monitoring pages, or changing local files. Neura has native file, document, browser extraction, process, and webpage monitor tools for action-taking tasks. If an action-taking request reaches this direct-answer path, do not provide instructions or pretend it is done; say only that Neura needs to use its computer or browser tools for that action.',
              },
              ...history,
              {
                role: 'user',
                content: instructions,
              },
            ],
          },
          { timeout: settings.plannerTimeoutInMs || 90_000 },
        );

        return (
          completion.choices?.[0]?.message?.content?.trim() ||
          'I could not produce a direct answer.'
        );
      } catch (error) {
        logger.warn('[directChat] failed:', error);
        return 'I had trouble reaching the chat model. Automation mode is still available for browser or computer tasks.';
      }
    }),
  runAgent: t.procedure.input<void>().handle(async () => {
    const { thinking } = store.getState();
    if (thinking) {
      return;
    }

    store.setState({
      abortController: new AbortController(),
      thinking: true,
      errorMsg: null,
    });

    await runAgent(store.setState, store.getState);

    store.setState({ thinking: false });
  }),
  setComputerTakeover: t.procedure
    .input<{ enabled: boolean }>()
    .handle(async ({ input }) => {
      const { computerRuntime } = store.getState();
      if (!computerRuntime) {
        return null;
      }
      return ComputerRuntimeController.setTakeover(input.enabled);
    }),
  computerTakeoverInput: t.procedure
    .input<
      | { type: 'click' | 'double_click' | 'right_click'; x: number; y: number }
      | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down' }
      | { type: 'text'; text: string }
      | { type: 'key' | 'hotkey'; key: string }
    >()
    .handle(async ({ input }) => {
      const runtime = store.getState().computerRuntime;
      if (!runtime?.takeoverEnabled) {
        throw new Error('Computer takeover is not enabled.');
      }

      if (runtime.mode === 'terminal') {
        if (!runtime.activeProcessId) {
          throw new Error('No active terminal process is available for takeover input.');
        }
        if (input.type === 'text') {
          writeProcessInput(runtime.activeProcessId, input.text);
          return { ok: true };
        }
        if (input.type === 'key') {
          const stdinByKey: Record<string, string> = {
            enter: os.EOL,
            return: os.EOL,
            backspace: '\b',
            tab: '\t',
            escape: '\x1b',
            esc: '\x1b',
            arrowup: '\x1b[A',
            arrowdown: '\x1b[B',
            arrowright: '\x1b[C',
            arrowleft: '\x1b[D',
          };
          const value = stdinByKey[input.key.toLowerCase()];
          if (!value) {
            throw new Error(`Unsupported terminal takeover key: ${input.key}`);
          }
          writeProcessInput(runtime.activeProcessId, value);
          return { ok: true };
        }
        throw new Error('Terminal takeover supports keyboard input only.');
      }

      const guiAgent = GUIAgentManager.getInstance().getAgent();
      if (guiAgent) {
        await guiAgent.executeTakeoverInput(input, {
          width: runtime.latestFrame?.width,
          height: runtime.latestFrame?.height,
          scaleFactor: runtime.latestFrame?.scaleFactor,
        });
        return { ok: true };
      }

      if (input.type === 'click') {
        await mouse.move(straightTo(new Point(input.x, input.y)));
        await mouse.click(MouseButton.LEFT);
        return { ok: true };
      }

      if (input.type === 'double_click') {
        await mouse.move(straightTo(new Point(input.x, input.y)));
        await mouse.doubleClick(MouseButton.LEFT);
        return { ok: true };
      }

      if (input.type === 'right_click') {
        await mouse.move(straightTo(new Point(input.x, input.y)));
        await mouse.click(MouseButton.RIGHT);
        return { ok: true };
      }

      if (input.type === 'scroll') {
        await mouse.move(straightTo(new Point(input.x, input.y)));
        if (input.direction === 'up') {
          await mouse.scrollUp(500);
        } else {
          await mouse.scrollDown(500);
        }
        return { ok: true };
      }

      if (input.type === 'text') {
        if (input.text) {
          await keyboard.type(input.text);
        }
        return { ok: true };
      }

      if (input.type === 'key' || input.type === 'hotkey') {
        if (input.type === 'hotkey') {
          const keys = getTakeoverHotkeys(input.key);
          if (!keys.length) {
            throw new Error(`Unsupported takeover hotkey: ${input.key}`);
          }
          await keyboard.pressKey(...keys);
          await keyboard.releaseKey(...[...keys].reverse());
          return { ok: true };
        }

        const key = takeoverKeyMap[input.key.toLowerCase()];
        if (!key) {
          throw new Error(`Unsupported takeover key: ${input.key}`);
        }
        await keyboard.pressKey(key);
        await keyboard.releaseKey(key);
        return { ok: true };
      }

      throw new Error(`Unsupported takeover input: ${input.type}`);
    }),
  pauseRun: t.procedure.input<void>().handle(async () => {
    const guiAgent = GUIAgentManager.getInstance().getAgent();
    if (guiAgent instanceof GUIAgent) {
      guiAgent.pause();
      store.setState({
        thinking: false,
      });
      ComputerRuntimeController.update({ status: 'paused', activity: 'Paused' });
    }
  }),
  resumeRun: t.procedure.input<void>().handle(async () => {
    const guiAgent = GUIAgentManager.getInstance().getAgent();
    if (guiAgent instanceof GUIAgent) {
      guiAgent.resume();
      store.setState({
        thinking: false,
      });
      ComputerRuntimeController.update({
        status: 'running',
        activity: 'Resumed',
      });
    }
  }),
  stopRun: t.procedure.input<void>().handle(async () => {
    const { abortController } = store.getState();
    store.setState({
      status: StatusEnum.END,
      thinking: false,
    });
    ComputerRuntimeController.complete('Task stopped');

    showWindow();

    abortController?.abort();
    const guiAgent = GUIAgentManager.getInstance().getAgent();
    if (guiAgent instanceof GUIAgent) {
      guiAgent.resume();
      guiAgent.stop();
    }
  }),
  resolveApproval: t.procedure
    .input<{ runId: string; eventId: string; approved: boolean }>()
    .handle(async ({ input }) => {
      return resolveUserApproval(input);
    }),
  exportRunSummary: t.procedure
    .input<{ runId: string }>()
    .handle(async ({ input }) => {
      const run = TaskRunRegistry.list().find(
        (item) => item.runId === input.runId,
      );
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }
      const outputDir = path.join(
        os.homedir(),
        'Documents',
        'Neura Artifacts',
        run.runId,
      );
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, 'task-summary.md');
      await fs.writeFile(outputPath, formatRunSummary(run), 'utf8');
      const updated = TaskRunRegistry.addArtifact(run.runId, {
        id: `artifact_${Date.now()}_${randomUUID().slice(0, 8)}`,
        title: 'Task Summary',
        kind: 'report',
        mimeType: 'text/markdown',
        path: outputPath,
        createdAt: Date.now(),
      });
      if (store.getState().taskState?.runId === run.runId && updated) {
        store.setState({ taskState: updated });
      }
      return outputPath;
    }),
  setInstructions: t.procedure
    .input<{ instructions: string }>()
    .handle(async ({ input }) => {
      store.setState({ instructions: input.instructions });
    }),
  setMessages: t.procedure
    .input<{ messages: Conversation[] }>()
    .handle(async ({ input }) => {
      store.setState({ messages: input.messages });
    }),
  setSessionHistoryMessages: t.procedure
    .input<{ messages: Message[] }>()
    .handle(async ({ input }) => {
      store.setState({ sessionHistoryMessages: input.messages });
    }),
  clearHistory: t.procedure.input<void>().handle(async () => {
    store.setState({
      status: StatusEnum.END,
      messages: [],
      thinking: false,
      errorMsg: null,
      instructions: '',
    });
  }),
});
