/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import type {
  BackgroundTaskKind,
  ScheduledTaskHistoryItem,
  ScheduledTaskRecord,
} from '@main/store/types';

import { BackgroundTaskService } from './background-task-service';

const MAX_SCHEDULED_TASKS = 100;
const MAX_SCHEDULED_HISTORY = 30;
const MIN_INTERVAL_MINUTES = 1;
const SCHEDULER_TICK_MS = 30_000;

type CreateScheduledTaskInput = {
  name: string;
  goal: string;
  kind?: BackgroundTaskKind;
  intervalMinutes: number;
};

type UpdateScheduledTaskInput = Partial<CreateScheduledTaskInput> & {
  status?: ScheduledTaskRecord['status'];
};

const nowPlusInterval = (intervalMinutes: number) =>
  Date.now() + Math.max(MIN_INTERVAL_MINUTES, intervalMinutes) * 60_000;

const normalizeInterval = (value: number) => {
  if (!Number.isFinite(value)) {
    return MIN_INTERVAL_MINUTES;
  }
  return Math.max(MIN_INTERVAL_MINUTES, Math.round(value));
};

const validateText = (label: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
};

export class ScheduledTaskService {
  private static instance: ScheduledTaskService | null = null;
  private timer: NodeJS.Timeout | null = null;
  private runningTaskIds = new Set<string>();

  static getInstance() {
    if (!ScheduledTaskService.instance) {
      ScheduledTaskService.instance = new ScheduledTaskService();
    }
    return ScheduledTaskService.instance;
  }

  start() {
    if (this.timer) {
      return;
    }
    void this.tickDueTasks();
    this.timer = setInterval(() => {
      void this.tickDueTasks();
    }, SCHEDULER_TICK_MS);
  }

  cleanup() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list() {
    return [...((SettingStore.get('scheduledTasks') || []) as ScheduledTaskRecord[])]
      .sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  create(input: CreateScheduledTaskInput) {
    const intervalMinutes = normalizeInterval(input.intervalMinutes);
    const task: ScheduledTaskRecord = {
      id: `schedule_${Date.now()}_${randomUUID().slice(0, 8)}`,
      name: validateText('Scheduled task name', input.name),
      goal: validateText('Scheduled task goal', input.goal),
      kind: input.kind || 'multi_agent',
      intervalMinutes,
      status: 'active',
      nextRunAt: nowPlusInterval(intervalMinutes),
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.persist([task, ...this.list()].slice(0, MAX_SCHEDULED_TASKS));
    return task;
  }

  update(id: string, input: UpdateScheduledTaskInput) {
    const existing = this.requireTask(id);
    const intervalMinutes =
      input.intervalMinutes === undefined
        ? existing.intervalMinutes
        : normalizeInterval(input.intervalMinutes);
    const updated: ScheduledTaskRecord = {
      ...existing,
      name:
        input.name === undefined
          ? existing.name
          : validateText('Scheduled task name', input.name),
      goal:
        input.goal === undefined
          ? existing.goal
          : validateText('Scheduled task goal', input.goal),
      kind: input.kind || existing.kind,
      intervalMinutes,
      status: input.status || existing.status,
      nextRunAt:
        input.intervalMinutes === undefined
          ? existing.nextRunAt
          : nowPlusInterval(intervalMinutes),
      updatedAt: Date.now(),
    };
    this.persist(
      this.list().map((task) => (task.id === id ? updated : task)),
    );
    return updated;
  }

  pause(id: string) {
    return this.update(id, { status: 'paused' });
  }

  resume(id: string) {
    const existing = this.requireTask(id);
    return this.update(id, {
      status: 'active',
      intervalMinutes: existing.intervalMinutes,
    });
  }

  delete(id: string) {
    this.requireTask(id);
    this.persist(this.list().filter((task) => task.id !== id));
    return { id, deleted: true };
  }

  async runNow(id: string) {
    const task = this.requireTask(id);
    return this.enqueueScheduledTask(task, 'run-now');
  }

  async tickDueTasks(now = Date.now()) {
    const dueTasks = this.list().filter(
      (task) =>
        task.status === 'active' &&
        task.nextRunAt <= now &&
        !this.runningTaskIds.has(task.id),
    );
    for (const task of dueTasks) {
      await this.enqueueScheduledTask(task, 'scheduled');
    }
  }

  private async enqueueScheduledTask(
    task: ScheduledTaskRecord,
    reason: 'scheduled' | 'run-now',
  ) {
    this.runningTaskIds.add(task.id);
    const queuedAt = Date.now();
    try {
      const backgroundTask = await BackgroundTaskService.getInstance().enqueue({
        kind: task.kind,
        goal: task.goal,
      });
      const history: ScheduledTaskHistoryItem = {
        id: `history_${queuedAt}_${randomUUID().slice(0, 8)}`,
        runId: backgroundTask.runId,
        status: 'queued',
        message:
          reason === 'run-now'
            ? 'Manually queued from scheduler.'
            : 'Queued by local scheduler.',
        queuedAt,
      };
      this.patch(task.id, {
        lastRunAt: queuedAt,
        nextRunAt: nowPlusInterval(task.intervalMinutes),
        history: [history, ...task.history].slice(0, MAX_SCHEDULED_HISTORY),
      });
      return this.requireTask(task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[ScheduledTaskService] failed to queue task', error);
      const history: ScheduledTaskHistoryItem = {
        id: `history_${queuedAt}_${randomUUID().slice(0, 8)}`,
        status: 'failed',
        message,
        queuedAt,
      };
      this.patch(task.id, {
        lastRunAt: queuedAt,
        nextRunAt: nowPlusInterval(task.intervalMinutes),
        history: [history, ...task.history].slice(0, MAX_SCHEDULED_HISTORY),
      });
      throw error;
    } finally {
      this.runningTaskIds.delete(task.id);
    }
  }

  private patch(id: string, patch: Partial<ScheduledTaskRecord>) {
    const tasks = this.list().map((task) =>
      task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task,
    );
    this.persist(tasks);
  }

  private requireTask(id: string) {
    const task = this.list().find((item) => item.id === id);
    if (!task) {
      throw new Error(`Scheduled task not found: ${id}`);
    }
    return task;
  }

  private persist(tasks: ScheduledTaskRecord[]) {
    SettingStore.set('scheduledTasks', tasks.slice(0, MAX_SCHEDULED_TASKS));
  }
}
