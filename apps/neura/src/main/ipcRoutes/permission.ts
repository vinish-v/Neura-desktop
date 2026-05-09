/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';
import * as env from '@main/env';
import { logger } from '@main/logger';
import { store } from '@main/store/create';
const t = initIpc.create();

export const permissionRoute = t.router({
  getEnsurePermissions: t.procedure.input<void>().handle(async () => {
    if (env.isMacOS) {
      const { ensurePermissions } = await import(
        '@main/utils/systemPermissions'
      );
      store.setState({ ensurePermissions: ensurePermissions() });
    } else {
      store.setState({
        ensurePermissions: { screenCapture: true, accessibility: true },
      });
    }
    logger.debug(
      '[getEnsurePermissions] ensurePermissions',
      store.getState().ensurePermissions,
    );
    return store.getState().ensurePermissions;
  }),
});
