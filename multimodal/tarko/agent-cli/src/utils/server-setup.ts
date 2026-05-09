/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentAppConfig } from '@tarko/interface';
import chalk from 'chalk';
import { findAvailablePort } from './port';

export async function ensureServerConfig(appConfig: AgentAppConfig): Promise<void> {
  // Ensure server config exists with defaults
  if (!appConfig.server) {
    appConfig.server = {
      port: 8888,
    };
  }

  // Find available port
  const availablePort = await findAvailablePort(appConfig.server.port!);
  if (availablePort !== appConfig.server.port) {
    console.log(
      `🔄 Port ${chalk.yellow(appConfig.server.port)} unavailable, switching to ${chalk.green(availablePort)}`,
    );
    appConfig.server.port = availablePort;
  }
}
