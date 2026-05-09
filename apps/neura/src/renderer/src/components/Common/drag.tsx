/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isWindows } from '@renderer/utils/os';

export const DragArea = () => {
  if (isWindows) {
    return null;
  }

  return <div className={'w-full h-9 draggable-area'} />;
};
