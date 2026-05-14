/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import {
  CanvasService,
  CreateCanvasFileInput,
  CreateComposerPlanInput,
  CreateCanvasProjectInput,
  RunCanvasCommandInput,
  UpdateCanvasProjectInput,
} from '@main/services/canvas-service';
import { CanvasIdeLauncher } from '@main/services/canvas-ide-launcher';

const t = initIpc.create();

export const canvasRoute = t.router({
  listCanvasProjects: t.procedure.input<void>().handle(async () => {
    return CanvasService.getInstance().listProjects();
  }),
  createCanvasProject: t.procedure
    .input<CreateCanvasProjectInput>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().createProject(input);
    }),
  getCanvasProject: t.procedure
    .input<{ projectId: string }>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().getProject(input.projectId);
    }),
  updateCanvasProject: t.procedure
    .input<UpdateCanvasProjectInput>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().updateProject(input);
    }),
  createCanvasFile: t.procedure
    .input<CreateCanvasFileInput>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().createFile(input);
    }),
  refreshCanvasProjectFiles: t.procedure
    .input<{ projectId: string }>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().refreshProjectFiles(input.projectId);
    }),
  createCanvasComposerPlan: t.procedure
    .input<CreateComposerPlanInput>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().createComposerPlan(input);
    }),
  approveCanvasComposerPlan: t.procedure
    .input<{ projectId: string; planId: string }>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().approveComposerPlan(
        input.projectId,
        input.planId,
      );
    }),
  runCanvasCommand: t.procedure
    .input<RunCanvasCommandInput>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().runCommand(input);
    }),
  revealCanvasProject: t.procedure
    .input<{ projectId: string }>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().revealProject(input.projectId);
    }),
  openCanvasProject: t.procedure
    .input<{ projectId: string }>()
    .handle(async ({ input }) => {
      return CanvasService.getInstance().openProject(input.projectId);
    }),
  openCanvasIde: t.procedure
    .input<{ projectId: string }>()
    .handle(async ({ input }) => {
      return CanvasIdeLauncher.getInstance().openProject(input.projectId);
    }),
  getCanvasIdeStatus: t.procedure.input<void>().handle(async () => {
    return CanvasIdeLauncher.getInstance().getStatus();
  }),
});
