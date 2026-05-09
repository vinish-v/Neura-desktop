/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { app, shell } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { initIpc } from '@neura-desktop/electron-ipc/main';
import { appUpdater } from '@main/window/createWindow';
import { logger } from '../logger';
import { showWindow } from '@main/window/index';

const t = initIpc.create();

const TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mdx',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

type ElectronProcessMetrics = NodeJS.Process & {
  getCPUUsage?: () => {
    percentCPUUsage?: number;
    idleWakeupsPerSecond?: number;
  };
  getSystemMemoryInfo?: () => {
    free?: number;
    total?: number;
  };
};

export const windowRoute = t.router({
  showMainWindow: t.procedure.input<void>().handle(async () => {
    showWindow();
  }),
  checkForUpdatesDetail: t.procedure.input<void>().handle(async () => {
    if (appUpdater) {
      logger.info('checkForUpdatesDetail');

      const detail = await appUpdater.checkForUpdatesDetail();
      return {
        ...detail,
        isPackaged: app.isPackaged,
      };
    }
    return {
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      updateInfo: null,
    };
  }),
  openPath: t.procedure.input<{ path: string }>().handle(async ({ input }) => {
    return shell.openPath(input.path);
  }),
  revealPath: t.procedure
    .input<{ path: string }>()
    .handle(async ({ input }) => {
      shell.showItemInFolder(input.path);
    }),
  readArtifactText: t.procedure
    .input<{ path: string }>()
    .handle(async ({ input }) => {
      const extension = path.extname(input.path).toLowerCase();
      if (!TEXT_ARTIFACT_EXTENSIONS.has(extension)) {
        return {
          text: '',
          readable: false,
          reason: `Preview is not available for ${extension || 'this file type'}.`,
        };
      }

      const stat = await fs.stat(input.path);
      const maxBytes = 1024 * 1024;
      if (stat.size > maxBytes) {
        return {
          text: '',
          readable: false,
          reason: 'Preview is limited to 1 MB text artifacts.',
        };
      }

      return {
        text: await fs.readFile(input.path, 'utf8'),
        readable: true,
        reason: '',
      };
    }),
  getRuntimeTelemetry: t.procedure.input<void>().handle(async () => {
    const electronProcess = process as ElectronProcessMetrics;
    const cpu = electronProcess.getCPUUsage?.();
    const memoryInfo = electronProcess.getSystemMemoryInfo?.();
    const memory = process.memoryUsage();
    const networkInterfaces = os.networkInterfaces();
    const activeNetworkLinks = Object.values(networkInterfaces).filter(
      (items) =>
        items?.some((item) => !item.internal && item.family === 'IPv4'),
    ).length;
    const totalMemoryBytes =
      (memoryInfo?.total ? memoryInfo.total * 1024 : undefined) ||
      os.totalmem();
    const freeMemoryBytes =
      (memoryInfo?.free ? memoryInfo.free * 1024 : undefined) || os.freemem();

    return {
      cpuPercent: cpu?.percentCPUUsage ?? null,
      idleWakeupsPerSecond: cpu?.idleWakeupsPerSecond ?? null,
      processRssBytes: memory.rss,
      processHeapUsedBytes: memory.heapUsed,
      totalMemoryBytes,
      freeMemoryBytes,
      activeNetworkLinks,
      timestamp: Date.now(),
    };
  }),
});
