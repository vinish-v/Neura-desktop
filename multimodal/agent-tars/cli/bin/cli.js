#!/usr/bin/env -S node --no-warnings
/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

const { version } = require('../package.json');
const { AgentTARSCLI } = require('../dist');
new AgentTARSCLI({ version }).bootstrap();
