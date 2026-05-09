/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ElectronHandler } from '../../../preload/index';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler;
    platform: NodeJS.Platform;
    zustandBridge: any;
  }
}

export {};
