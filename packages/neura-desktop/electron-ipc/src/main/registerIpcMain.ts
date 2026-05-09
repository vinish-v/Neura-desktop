/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ipcMain } from 'electron';
import { RouterType } from '../types';

export const registerIpcMain = (router: RouterType) => {
  for (const [name, route] of Object.entries(router)) {
    ipcMain.handle(name, (e, payload) => {
      return route.handle({ context: { sender: e.sender }, input: payload });
    });
  }
};
