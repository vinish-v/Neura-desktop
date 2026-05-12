/*
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

import { CriticAgent } from './critic-agent';
import { ExecutorAgent } from './executor-agent';
import { PlannerAgent } from './planner-agent';
import { ResearcherAgent } from './researcher-agent';
import {
  type BaseAgent,
  type MultiAgentEvent,
  type MultiAgentName,
  type MultiAgentObservation,
  type MultiAgentRuntime,
  type MultiAgentState,
  type MultiAgentStepResult,
} from './base-agent';
import { MultiAgentSupervisor } from './multi-agent-supervisor';

export type MultiAgentOrchestratorOptions = MultiAgentRuntime & {
  goal: string;
  taskId: string;
  maxIterations?: number;
  signal?: AbortSignal;
  onEvent?: (event: MultiAgentEvent) => void | Promise<void>;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new Error('Multi-agent task cancelled.');
  }
};

const createObservation = (
  result: MultiAgentStepResult,
): MultiAgentObservation => ({
  id: `${Date.now()}-${result.agentName}`,
  agentName: result.agentName,
  summary: result.summary,
  detail: result.detail,
  createdAt: Date.now(),
});

export class MultiAgentOrchestrator {
  private readonly supervisor = new MultiAgentSupervisor();

  private createAgents(
    runtime: MultiAgentRuntime,
  ): Map<MultiAgentName, BaseAgent> {
    return new Map<MultiAgentName, BaseAgent>([
      ['planner', new PlannerAgent(runtime)],
      ['researcher', new ResearcherAgent(runtime)],
      ['executor', new ExecutorAgent(runtime)],
      ['critic', new CriticAgent(runtime)],
    ]);
  }

  async run(options: MultiAgentOrchestratorOptions): Promise<string> {
    throwIfAborted(options.signal);
    const memory = options.memory;
    const retrievedMemory = memory
      ? await memory.search(options.goal, { limit: 6 })
      : [];
    const state: MultiAgentState = {
      taskId: options.taskId,
      goal: options.goal,
      status: 'planning',
      iteration: 0,
      maxIterations: options.maxIterations ?? 18,
      plan: [],
      completedStepIds: [],
      observations: [],
      artifacts: [],
      connectorRecommendations: [],
      memory: retrievedMemory,
      isComplete: false,
    };
    const agents = this.createAgents(options);

    while (!state.isComplete && state.iteration < state.maxIterations) {
      throwIfAborted(options.signal);
      const agentName = this.supervisor.decideNextAgent(state);
      const agent = agents.get(agentName);
      if (!agent) {
        throw new Error(`No multi-agent handler registered for ${agentName}.`);
      }

      state.currentAgent = agentName;
      state.status =
        agentName === 'planner'
          ? 'planning'
          : agentName === 'researcher'
            ? 'researching'
            : agentName === 'executor'
              ? 'executing'
              : 'reflecting';
      await options.onEvent?.({ type: 'agent.started', agentName, state });

      const result = await agent.execute(state);
      throwIfAborted(options.signal);
      state.iteration += 1;
      state.lastAgent = agentName;
      state.lastResult = result;
      state.observations.push(createObservation(result));

      if (result.plan?.length) {
        state.plan = result.plan;
      }
      if (result.agentName === 'executor' && result.status !== 'retry') {
        const currentStep = state.plan.find(
          (step) => !state.completedStepIds.includes(step.id),
        );
        if (currentStep) {
          state.completedStepIds.push(currentStep.id);
        }
      }
      if (result.artifacts?.length) {
        state.artifacts.push(...result.artifacts);
        for (const artifact of result.artifacts) {
          await options.onEvent?.({ type: 'artifact', artifact, state });
        }
      }
      if (result.connectorRecommendations?.length) {
        for (const recommendation of result.connectorRecommendations) {
          if (
            state.connectorRecommendations.some(
              (item) => item.connectorId === recommendation.connectorId,
            )
          ) {
            continue;
          }
          state.connectorRecommendations.push(recommendation);
          await options.onEvent?.({
            type: 'connector.recommended',
            recommendation,
            state,
          });
        }
      }
      if (result.status === 'complete') {
        state.isComplete = true;
        state.status = 'completed';
        state.finalAnswer = result.finalAnswer || result.summary;
      }
      if (result.status === 'fail') {
        state.isComplete = true;
        state.status = 'failed';
        state.error = result.finalAnswer || result.summary;
        state.finalAnswer = result.finalAnswer || result.summary;
      }

      await options.onEvent?.({
        type: 'agent.completed',
        agentName,
        result,
        state,
      });
      await options.onEvent?.({ type: 'state.updated', state });

      if (
        result.agentName === 'critic' &&
        result.status === 'continue' &&
        state.completedStepIds.length >= state.plan.length
      ) {
        state.isComplete = true;
        state.status = 'completed';
      }
    }

    if (!state.finalAnswer) {
      throwIfAborted(options.signal);
      state.finalAnswer = await this.finalize(options, state);
    }
    throwIfAborted(options.signal);
    state.isComplete = true;
    state.status = state.error ? 'failed' : 'completed';

    await memory?.rememberTask({
      id: options.taskId,
      goal: options.goal,
      status: state.status,
      finalAnswer: state.finalAnswer,
      observations: state.observations.map((observation) =>
        [observation.agentName, observation.summary, observation.detail]
          .filter(Boolean)
          .join(': '),
      ),
      metadata: {
        planSteps: state.plan.length,
        artifacts: state.artifacts.length,
      },
    });

    await options.onEvent?.({
      type: 'completed',
      finalAnswer: state.finalAnswer,
      state,
    });
    return state.finalAnswer;
  }

  private async finalize(
    options: MultiAgentOrchestratorOptions,
    state: MultiAgentState,
  ) {
    const output = await options.model.complete({
      role: 'reflector',
      temperature: 0,
      system:
        'You are Neura Finalizer. Produce a concise user-facing answer grounded only in the multi-agent observations.',
      user: [
        `Goal:\n${options.goal}`,
        '',
        'Observations:',
        ...state.observations.map((observation) =>
          [
            `${observation.agentName}: ${observation.summary}`,
            observation.detail,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ].join('\n'),
    });
    return output.trim() || 'The multi-agent task finished.';
  }
}
