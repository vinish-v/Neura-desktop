/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import { BackgroundTaskService } from '@main/services/background-task-service';
import { MailTaskIntakeService } from '@main/services/mail-task-intake-service';
import { ScheduledTaskService } from '@main/services/scheduled-task-service';
import { TaskManager } from '@main/services/task-manager';
import type { BackgroundTaskKind } from '@main/store/types';

const t = initIpc.create();

export const tasksRoute = t.router({
  runMultiAgentTask: t.procedure
    .input<{ goal: string }>()
    .handle(async ({ input }) => {
      return TaskManager.getInstance().startMultiAgentTask(input.goal);
    }),
  queueBackgroundTask: t.procedure
    .input<{
      kind: 'mcp_autonomous' | 'skill' | 'multi_agent';
      goal: string;
      skillName?: string;
      arguments?: Record<string, unknown>;
    }>()
    .handle(async ({ input }) => {
      return BackgroundTaskService.getInstance().enqueue(input);
    }),
  listBackgroundTasks: t.procedure.input<void>().handle(async () => {
    return BackgroundTaskService.getInstance().list();
  }),
  cancelBackgroundTask: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return BackgroundTaskService.getInstance().cancel(input.id);
    }),
  retryBackgroundTask: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return BackgroundTaskService.getInstance().retry(input.id);
    }),
  listScheduledTasks: t.procedure.input<void>().handle(async () => {
    return ScheduledTaskService.getInstance().list();
  }),
  createScheduledTask: t.procedure
    .input<{
      name: string;
      goal: string;
      kind?: BackgroundTaskKind;
      intervalMinutes: number;
    }>()
    .handle(async ({ input }) => {
      return ScheduledTaskService.getInstance().create(input);
    }),
  updateScheduledTask: t.procedure
    .input<{
      id: string;
      name?: string;
      goal?: string;
      kind?: BackgroundTaskKind;
      intervalMinutes?: number;
      status?: 'active' | 'paused';
    }>()
    .handle(async ({ input }) => {
      const { id, ...patch } = input;
      return ScheduledTaskService.getInstance().update(id, patch);
    }),
  pauseScheduledTask: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return ScheduledTaskService.getInstance().pause(input.id);
    }),
  resumeScheduledTask: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return ScheduledTaskService.getInstance().resume(input.id);
    }),
  deleteScheduledTask: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return ScheduledTaskService.getInstance().delete(input.id);
    }),
  runScheduledTaskNow: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return ScheduledTaskService.getInstance().runNow(input.id);
    }),
  getMailTaskIntakeStatus: t.procedure.input<void>().handle(async () => {
    return MailTaskIntakeService.getInstance().getStatus();
  }),
  updateMailTaskIntake: t.procedure
    .input<{
      enabled?: boolean;
      subjectPrefix?: string;
      maxResults?: number;
      senderAllowlist?: string[];
    }>()
    .handle(async ({ input }) => {
      return MailTaskIntakeService.getInstance().update(input);
    }),
  runMailTaskIntakeNow: t.procedure.input<void>().handle(async () => {
    return MailTaskIntakeService.getInstance().runOnce();
  }),
});
