/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from '@rslib/core';

const BANNER = `/**
* Copyright (c) 2025 Neura.
* SPDX-License-Identifier: Apache-2.0
*/`;

export default defineConfig({
  source: {
    entry: {
      index: ['./src/**'],
    },
  },
  lib: [
    {
      format: 'esm',
      syntax: 'esnext',
      bundle: false,
      autoExternal: false,
      dts: true,
      banner: { js: BANNER },
    },
    {
      format: 'cjs',
      syntax: 'esnext',
      bundle: false,
      dts: true,
      banner: { js: BANNER },
    },
  ],
  output: {
    target: 'node',
    cleanDistPath: false,
    sourceMap: true,
  },
});
