/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createClient } from '@neura-desktop/electron-ipc/renderer';
import type { Router } from '@main/ipcRoutes';

export const api = createClient<Router>({
  ipcInvoke: window.electron.ipcRenderer.invoke,
});
