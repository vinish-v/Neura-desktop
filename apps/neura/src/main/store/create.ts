/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createStore } from 'zustand/vanilla';

import { StatusEnum } from '@neura-desktop/shared/types';

import type { AppState } from './types';

export const store = createStore<AppState>(
  () =>
    ({
      theme: 'light',
      restUserData: null,
      instructions: '',
      status: StatusEnum.INIT,
      sessionHistoryMessages: [],
      messages: [],
      errorMsg: null,
      ensurePermissions: {},
      abortController: null,
      thinking: false,
      browserAvailable: false, // Defaults to false until the detection is complete
      taskState: null,
      computerRuntime: null,
    }) satisfies AppState,
);
