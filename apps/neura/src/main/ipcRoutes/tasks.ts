/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import { BackgroundTaskService } from '@main/services/background-task-service';
import { TaskManager } from '@main/services/task-manager';

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
});
