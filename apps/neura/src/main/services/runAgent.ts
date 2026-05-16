/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { AppState } from '@main/store/types';
import { TaskManager } from './task-manager';

export const runAgent = async (
  _setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  await TaskManager.getInstance().startHermesTask(instructions, {
    signal: abortController?.signal,
    runMode: 'multi_agent',
  });
};
