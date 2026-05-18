/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import { DesktopProjectsService } from '@main/services/desktop-projects-service';
import { TaskManager } from '@main/services/task-manager';

const t = initIpc.create();

export const projectsRoute = t.router({
  listDesktopProjects: t.procedure.input<void>().handle(async () => {
    return DesktopProjectsService.getInstance().list();
  }),
  createDesktopProject: t.procedure
    .input<{
      name: string;
      masterInstruction?: string;
      pinned?: boolean;
    }>()
    .handle(async ({ input }) => {
      return DesktopProjectsService.getInstance().create(input);
    }),
  updateDesktopProject: t.procedure
    .input<{
      id: string;
      name?: string;
      masterInstruction?: string;
      pinned?: boolean;
      memory?: string[];
    }>()
    .handle(async ({ input }) => {
      const { id, ...patch } = input;
      return DesktopProjectsService.getInstance().update(id, patch);
    }),
  deleteDesktopProject: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return DesktopProjectsService.getInstance().delete(input.id);
    }),
  addDesktopProjectKnowledgeFile: t.procedure
    .input<{ id: string; path: string }>()
    .handle(async ({ input }) => {
      return DesktopProjectsService.getInstance().addKnowledgeFile(
        input.id,
        input.path,
      );
    }),
  removeDesktopProjectKnowledgeFile: t.procedure
    .input<{ id: string; fileId: string }>()
    .handle(async ({ input }) => {
      return DesktopProjectsService.getInstance().removeKnowledgeFile(
        input.id,
        input.fileId,
      );
    }),
  runDesktopProjectTask: t.procedure
    .input<{ id: string; goal: string }>()
    .handle(async ({ input }) => {
      return TaskManager.getInstance().startMultiAgentTask(input.goal, {
        projectId: input.id,
      });
    }),
});
