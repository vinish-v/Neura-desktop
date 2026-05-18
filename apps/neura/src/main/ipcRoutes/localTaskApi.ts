/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import { LocalTaskApiService } from '@main/services/local-task-api-service';

const t = initIpc.create();

export const localTaskApiRoute = t.router({
  getLocalTaskApiStatus: t.procedure.input<void>().handle(async () => {
    return LocalTaskApiService.getInstance().status();
  }),
  enableLocalTaskApi: t.procedure
    .input<{ port?: number } | void>()
    .handle(async ({ input }) => {
      return LocalTaskApiService.getInstance().enable(input?.port);
    }),
  disableLocalTaskApi: t.procedure.input<void>().handle(async () => {
    return LocalTaskApiService.getInstance().disable();
  }),
  regenerateLocalTaskApiToken: t.procedure.input<void>().handle(async () => {
    return LocalTaskApiService.getInstance().regenerateToken();
  }),
});
