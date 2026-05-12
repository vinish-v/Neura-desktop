/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MultiAgentName, MultiAgentState } from './base-agent';

export class MultiAgentSupervisor {
  decideNextAgent(state: MultiAgentState): MultiAgentName {
    if (!state.plan.length) {
      return 'planner';
    }

    if (state.lastAgent === 'executor') {
      return 'critic';
    }

    if (
      !state.observations.some(
        (observation) => observation.agentName === 'researcher',
      ) &&
      /research|analy[sz]e|compare|market|competitor|summari[sz]e|investigate/i.test(
        state.goal,
      )
    ) {
      return 'researcher';
    }

    if (state.lastAgent === 'critic' && state.lastResult?.status === 'retry') {
      return 'executor';
    }

    const remainingSteps = state.plan.some(
      (step) => !state.completedStepIds.includes(step.id),
    );
    return remainingSteps ? 'executor' : 'critic';
  }
}
