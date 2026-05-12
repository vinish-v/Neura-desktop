/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import {
  BrowserWindow,
  Notification,
  ipcMain,
  powerSaveBlocker,
} from 'electron';

import { logger } from '@main/logger';
import { store } from '@main/store/create';
import { SettingStore } from '@main/store/setting';
import {
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  TaskRunRecord,
} from '@main/store/types';

const MAX_BACKGROUND_TASKS = 100;

type EnqueueBackgroundTaskInput = {
  kind: BackgroundTaskKind;
  goal: string;
  skillName?: string;
  arguments?: Record<string, unknown>;
};

type BackgroundRunner = (
  task: BackgroundTaskRecord,
) => Promise<TaskRunRecord | null | undefined>;

export class BackgroundTaskService {
  private static instance: BackgroundTaskService | null = null;
  private running = false;
  private powerSaveBlockerId: number | null = null;
  private runners = new Map<BackgroundTaskKind, BackgroundRunner>();

  static getInstance() {
    if (!BackgroundTaskService.instance) {
      BackgroundTaskService.instance = new BackgroundTaskService();
    }
    return BackgroundTaskService.instance;
  }

  constructor() {
    this.runners.set('multi_agent', async (task) => {
      const { TaskManager } = await import('./task-manager');
      return TaskManager.getInstance().startMultiAgentTask(task.goal);
    });
    this.runners.set('mcp_autonomous', async (task) => {
      const { TaskManager } = await import('./task-manager');
      return TaskManager.getInstance().startMcpAutonomousTask(task.goal);
    });
    this.runners.set('skill', async (task) => {
      if (!task.skillName) {
        throw new Error('Background skill task requires a skillName.');
      }
      const { TaskManager } = await import('./task-manager');
      return TaskManager.getInstance().startSkillTask({
        skillName: task.skillName,
        arguments: task.arguments || {},
        goal: task.goal,
      });
    });
  }

  start() {
    const recovered = this.list().map((task) =>
      task.status === 'running'
        ? {
            ...task,
            status: 'queued' as BackgroundTaskStatus,
            error: 'Recovered after app restart.',
            startedAt: undefined,
          }
        : task,
    );
    this.persist(recovered);
    void this.runNext();
  }

  cleanup() {
    this.stopPowerSaveBlocker();
  }

  list() {
    return (SettingStore.get('backgroundTasks') ||
      []) as BackgroundTaskRecord[];
  }

  async enqueue(input: EnqueueBackgroundTaskInput) {
    const goal = input.goal.trim();
    if (!goal) {
      throw new Error('Background task goal is required.');
    }
    if (input.kind === 'skill' && !input.skillName?.trim()) {
      throw new Error('Background skill task requires a skillName.');
    }

    const task: BackgroundTaskRecord = {
      id: `bg_${Date.now()}_${randomUUID().slice(0, 8)}`,
      kind: input.kind,
      goal,
      skillName: input.skillName?.trim(),
      arguments: input.arguments || {},
      status: 'queued',
      createdAt: Date.now(),
    };
    this.persist([task, ...this.list()].slice(0, MAX_BACKGROUND_TASKS));
    this.broadcast();
    void this.runNext();
    return task;
  }

  private async runNext() {
    if (this.running) {
      return;
    }
    const next = this.list()
      .filter((task) => task.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) {
      this.stopPowerSaveBlocker();
      return;
    }

    const runner = this.runners.get(next.kind);
    if (!runner) {
      this.patch(next.id, {
        status: 'failed',
        error: `No runner registered for ${next.kind}.`,
        completedAt: Date.now(),
      });
      void this.runNext();
      return;
    }

    this.running = true;
    this.startPowerSaveBlocker();
    this.patch(next.id, {
      status: 'running',
      startedAt: Date.now(),
      error: undefined,
    });

    try {
      const run = await runner(next);
      this.patch(next.id, {
        status: run?.status === 'failed' ? 'failed' : 'completed',
        runId: run?.runId,
        error: run?.error,
        completedAt: Date.now(),
      });
      this.notify(
        run?.status === 'failed' ? 'Neura task failed' : 'Neura task completed',
        next.goal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[BackgroundTaskService] task failed', error);
      this.patch(next.id, {
        status: 'failed',
        error: message,
        completedAt: Date.now(),
      });
      this.notify('Neura task failed', message);
    } finally {
      this.running = false;
      this.broadcast();
      void this.runNext();
    }
  }

  private patch(id: string, patch: Partial<BackgroundTaskRecord>) {
    const tasks = this.list().map((task) =>
      task.id === id ? { ...task, ...patch } : task,
    );
    this.persist(tasks);
    this.broadcast();
  }

  private persist(tasks: BackgroundTaskRecord[]) {
    SettingStore.set('backgroundTasks', tasks.slice(0, MAX_BACKGROUND_TASKS));
  }

  private broadcast() {
    const tasks = this.list();
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('task:updated', tasks);
    });
    store.setState({
      taskState: store.getState().taskState,
    });
  }

  private startPowerSaveBlocker() {
    if (
      this.powerSaveBlockerId !== null &&
      powerSaveBlocker.isStarted(this.powerSaveBlockerId)
    ) {
      return;
    }
    this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }

  private stopPowerSaveBlocker() {
    if (
      this.powerSaveBlockerId !== null &&
      powerSaveBlocker.isStarted(this.powerSaveBlockerId)
    ) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
    }
    this.powerSaveBlockerId = null;
  }

  private notify(title: string, body: string) {
    if (!Notification.isSupported()) {
      return;
    }
    new Notification({
      title,
      body: body.length > 160 ? `${body.slice(0, 160)}...` : body,
    }).show();
  }
}

let rawBackgroundIpcRegistered = false;

export const registerBackgroundTaskIpcHandlers = () => {
  if (rawBackgroundIpcRegistered) {
    return;
  }
  rawBackgroundIpcRegistered = true;
  const service = BackgroundTaskService.getInstance();

  ipcMain.handle(
    'task:queue',
    async (_event, params: EnqueueBackgroundTaskInput) =>
      service.enqueue(params),
  );
  ipcMain.handle('task:list', async () => service.list());
  ipcMain.on('task:subscribe', (event) => {
    event.sender.send('task:updated', service.list());
  });
};
