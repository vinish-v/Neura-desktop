/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseAgent,
  compactForPrompt,
  extractJsonObject,
  type MultiAgentState,
  type MultiAgentStepResult,
} from './base-agent';

const normalizeStatus = (value: unknown): MultiAgentStepResult['status'] => {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (status === 'retry' || status === 'complete' || status === 'fail') {
    return status;
  }
  return 'continue';
};

export class CriticAgent extends BaseAgent {
  readonly name = 'critic' as const;

  async execute(state: MultiAgentState): Promise<MultiAgentStepResult> {
    const output = await this.runtime.model.complete({
      role: 'reflector',
      temperature: 0,
      system:
        'You are Neura Critic. Decide whether the multi-agent task should continue, retry, complete, or fail. Return only JSON.',
      user: [
        `Goal:\n${state.goal}`,
        '',
        `Plan:\n${compactForPrompt(state.plan, 4000)}`,
        '',
        `Completed step IDs:\n${state.completedStepIds.join(', ') || 'None'}`,
        '',
        `Latest result:\n${compactForPrompt(state.lastResult, 4000)}`,
        '',
        `Observations:\n${this.observationsForPrompt(state, 8000) || 'None'}`,
        '',
        'Return JSON: {"status":"continue|retry|complete|fail","summary":"short public summary","finalAnswer":"only when complete or fail"}',
      ].join('\n'),
    });
    const record = extractJsonObject(output);
    const status = normalizeStatus(record.status);
    return {
      agentName: this.name,
      status,
      summary:
        typeof record.summary === 'string' && record.summary.trim()
          ? record.summary.trim()
          : 'Critic reviewed the latest state.',
      finalAnswer:
        typeof record.finalAnswer === 'string' && record.finalAnswer.trim()
          ? record.finalAnswer.trim()
          : undefined,
    };
  }
}
