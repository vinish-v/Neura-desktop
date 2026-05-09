/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Logger utility for PDK
 */
import chalk from 'chalk';

const pkg = require('../../package.json');
const PREFIX = `${chalk.cyan('❯')} ${chalk.gray(pkg.name)}`;

export const logger = {
  info: (msg: string) => console.log(`${PREFIX} 💬 ${msg}`),
  warn: (msg: string) => console.log(`${PREFIX} ⚠️  ${msg}`),
  error: (msg: string) => console.log(`${PREFIX} ${chalk.red('error')} ${msg}`),
  success: (msg: string) => console.log(`${PREFIX} ${chalk.green('✓')} ${msg}`),
};
