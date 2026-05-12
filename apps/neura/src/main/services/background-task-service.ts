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
  signal: AbortSignal,
) => Promise<TaskRunRecord | null | undefined>;

export class BackgroundTaskService {
  private static instance: BackgroundTaskService | null = null;
  private running = false;
  private activeTaskId: string | null = null;
  private powerSaveBlockerId: number | null = null;
  private activeAbortController: AbortController | null = null;
  private runners = new Map<BackgroundTaskKind, BackgroundRunner>();

  static getInstance() {
    if (!BackgroundTaskService.instance) {
      BackgroundTaskService.instance = new BackgroundTaskService();
    }
    return BackgroundTaskService.instance;
  }

  constructor() {
    this.runners.set('multi_agent', async (task, signal) => {
      const { TaskManager } = await import('./task-manager');
      return TaskManager.getInstance().startMultiAgentTask(task.goal, {
        signal,
        backgroundTaskId: task.id,
      });
    });
    this.runners.set('mcp_autonomous', async (task, signal) => {
      const { TaskManager } = await import('./task-manager');
      return TaskManager.getInstance().startMcpAutonomousTask(task.goal, {
        signal,
        backgroundTaskId: task.id,
      });
    });
    this.runners.set('skill', async (task, signal) => {
      if (!task.skillName) {
        throw new Error('Background skill task requires a skillName.');
      }
      const { TaskManager } = await import('./task-manager');
      return TaskManager.getInstance().startSkillTask({
        skillName: task.skillName,
        arguments: task.arguments || {},
        goal: task.goal,
        signal,
        backgroundTaskId: task.id,
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

  async cancel(id: string) {
    const task = this.list().find((item) => item.id === id);
    if (!task) {
      throw new Error(`Background task not found: ${id}`);
    }
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      return task;
    }
    if (task.status === 'queued') {
      this.patch(id, {
        status: 'cancelled',
        error: 'Cancelled before start.',
        completedAt: Date.now(),
      });
      return this.list().find((item) => item.id === id) || task;
    }
    if (task.status === 'running' && this.activeTaskId === id) {
      this.patch(id, {
        cancelRequested: true,
        error: 'Cancellation requested.',
      });
      this.activeAbortController?.abort();
      return this.list().find((item) => item.id === id) || task;
    }
    return task;
  }

  async retry(id: string) {
    const task = this.list().find((item) => item.id === id);
    if (!task) {
      throw new Error(`Background task not found: ${id}`);
    }
    if (task.status === 'queued' || task.status === 'running') {
      return task;
    }
    return this.enqueue({
      kind: task.kind,
      goal: task.goal,
      skillName: task.skillName,
      arguments: task.arguments,
    });
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
    this.activeTaskId = next.id;
    this.activeAbortController = new AbortController();
    this.startPowerSaveBlocker();
    this.patch(next.id, {
      status: 'running',
      startedAt: Date.now(),
      error: undefined,
    });

    try {
      const run = await runner(next, this.activeAbortController.signal);
      const wasCancelled =
        this.activeAbortController.signal.aborted ||
        this.list().find((task) => task.id === next.id)?.cancelRequested;
      this.patch(next.id, {
        status: wasCancelled
          ? 'cancelled'
          : run?.status === 'failed'
            ? 'failed'
            : 'completed',
        runId: run?.runId,
        error: wasCancelled ? 'Cancelled by user.' : run?.error,
        cancelRequested: undefined,
        completedAt: Date.now(),
      });
      this.notify(
        wasCancelled
          ? 'Neura task cancelled'
          : run?.status === 'failed'
            ? 'Neura task failed'
            : 'Neura task completed',
        next.goal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wasCancelled =
        this.activeAbortController?.signal.aborted ||
        this.list().find((task) => task.id === next.id)?.cancelRequested;
      logger.warn('[BackgroundTaskService] task failed', error);
      this.patch(next.id, {
        status: wasCancelled ? 'cancelled' : 'failed',
        error: wasCancelled ? 'Cancelled by user.' : message,
        cancelRequested: undefined,
        completedAt: Date.now(),
      });
      this.notify(
        wasCancelled ? 'Neura task cancelled' : 'Neura task failed',
        wasCancelled ? next.goal : message,
      );
    } finally {
      this.running = false;
      this.activeTaskId = null;
      this.activeAbortController = null;
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
  ipcMain.handle('task:cancel', async (_event, params: { id: string }) =>
    service.cancel(params.id),
  );
  ipcMain.handle('task:retry', async (_event, params: { id: string }) =>
    service.retry(params.id),
  );
  ipcMain.on('task:subscribe', (event) => {
    event.sender.send('task:updated', service.list());
  });
};
