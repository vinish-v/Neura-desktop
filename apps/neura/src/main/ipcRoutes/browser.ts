/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';
import { checkBrowserAvailability } from '../services/browserCheck';

const t = initIpc.create();

export const browserRoute = t.router({
  checkBrowserAvailability: t.procedure.input<void>().handle(async () => {
    return await checkBrowserAvailability();
  }),
});
