/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';
import { getScreenSize } from '@main/utils/screen';

const t = initIpc.create();

export const screenRoute = t.router({
  getScreenSize: t.procedure.input<void>().handle(async () => {
    const primaryDisplay = getScreenSize();

    return {
      screenWidth: primaryDisplay.physicalSize.width,
      screenHeight: primaryDisplay.physicalSize.height,
      scaleFactor: primaryDisplay.scaleFactor,
    };
  }),
});
