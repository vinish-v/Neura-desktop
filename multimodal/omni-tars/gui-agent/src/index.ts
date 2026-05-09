/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentMode, ComposableAgent } from '@omni-tars/core';
import { GuiAgentPlugin } from './GuiAgentPlugin';
import { AgentOptions } from '@tarko/agent';
import { GUIAgentToolCallEngine } from './GUIAgentToolCallEngine';
import { OperatorManager } from './OperatorManager';

export { OperatorManager } from './OperatorManager';
export { GuiAgentPlugin } from './GuiAgentPlugin';
export { GuiToolCallEngineProvider } from './GuiToolCallEngineProvider';

export interface GUIAgentConfig<TOperator> {
  operator: TOperator;
  model: {
    baseURL: string;
    id: string;
    apiKey: string; // @secretlint-disable-line
    neuraModelVersion?:
      | 'neura-desktop-1.0'
      | 'neura-desktop-1.5'
      | 'doubao-1.5-neura-desktop-15b'
      | 'doubao-1.5-neura-desktop-20b';
  };
  // ===== Optional =====
  systemPrompt?: string;
  signal?: AbortSignal;
  maxLoopCount?: number;
  loopIntervalInMs?: number;
}

export default class GUIAgent extends ComposableAgent {
  static label: 'Browser GUI Agent';
  constructor(options: AgentOptions & { agentMode?: AgentMode }) {
    super({
      ...options,
      plugins: [
        new GuiAgentPlugin({
          operatorManager: OperatorManager.create(options.agentMode, options.sandboxUrl),
          agentMode: options.agentMode,
        }),
      ],
      toolCallEngine: GUIAgentToolCallEngine,
    });
  }
}
