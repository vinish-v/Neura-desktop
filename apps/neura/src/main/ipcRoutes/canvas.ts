/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import {
  CanvasService,
  CreateCanvasProjectInput,
  UpdateCanvasProjectInput,
} from '@main/services/canvas-service';

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
});
