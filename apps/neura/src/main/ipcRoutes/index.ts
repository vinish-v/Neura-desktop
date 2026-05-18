/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc, createServer } from '@neura-desktop/electron-ipc/main';
import { screenRoute } from './screen';
import { windowRoute } from './window';
import { permissionRoute } from './permission';
import { agentRoute } from './agent';
import { settingRoute } from './setting';
import { mcpRoute } from './mcp';
import { skillsRoute } from './skills';
import { tasksRoute } from './tasks';
import { connectorsRoute } from './connectors';
import { canvasRoute } from './canvas';

const t = initIpc.create();

export const ipcRoutes = t.router({
  ...screenRoute,
  ...windowRoute,
  ...permissionRoute,
  ...agentRoute,
  ...settingRoute,
  ...mcpRoute,
  ...skillsRoute,
  ...tasksRoute,
  ...connectorsRoute,
  ...canvasRoute,
});
export type Router = typeof ipcRoutes;

export const server = createServer(ipcRoutes);
