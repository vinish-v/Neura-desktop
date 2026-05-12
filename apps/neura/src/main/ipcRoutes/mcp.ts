/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import { MCPService } from '@main/services/mcp-service';
import { TaskManager } from '@main/services/task-manager';

const t = initIpc.create();

export const mcpRoute = t.router({
  listMcpTools: t.procedure
    .input<{ serverName?: string } | void>()
    .handle(async ({ input }) => {
      return MCPService.getInstance().listTools(input?.serverName);
    }),
  callMcpTool: t.procedure
    .input<{
      serverName: string;
      name: string;
      arguments?: Record<string, unknown>;
    }>()
    .handle(async ({ input }) => {
      return MCPService.getInstance().callTool(input);
    }),
  getMcpStatus: t.procedure.input<void>().handle(async () => {
    return MCPService.getInstance().status();
  }),
  runMcpAutonomousTask: t.procedure
    .input<{ goal: string }>()
    .handle(async ({ input }) => {
      return TaskManager.getInstance().startMcpAutonomousTask(input.goal);
    }),
});
