/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseAgent,
  compactForPrompt,
  type MultiAgentState,
  type MultiAgentStepResult,
} from './base-agent';

export class ResearcherAgent extends BaseAgent {
  readonly name = 'researcher' as const;

  async execute(state: MultiAgentState): Promise<MultiAgentStepResult> {
    const output = await this.runtime.model.complete({
      role: 'executor',
      temperature: 0.2,
      system:
        'You are Neura Researcher. Extract useful context, questions, constraints, and likely tool/skill needs. Do not claim external browsing unless a tool result exists.',
      user: [
        `Goal:\n${state.goal}`,
        '',
        `Plan:\n${compactForPrompt(state.plan, 4000)}`,
        '',
        `Relevant memory:\n${compactForPrompt(state.memory, 4000)}`,
        '',
        `Prior observations:\n${this.observationsForPrompt(state) || 'None'}`,
      ].join('\n'),
    });

    return {
      agentName: this.name,
      status: 'continue',
      summary: 'Prepared research context.',
      detail: output.trim(),
    };
  }
}
