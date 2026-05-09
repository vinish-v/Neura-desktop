/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from '@rslib/core';
import { rslibConfig } from '@common/configs/rslib.config';

export default defineConfig({
  ...rslibConfig,
  lib: rslibConfig.lib?.map((lib) => ({
    ...lib,
    dts: false,
  })),
  output: {
    ...rslibConfig.output,
    target: 'web',
  },
});
