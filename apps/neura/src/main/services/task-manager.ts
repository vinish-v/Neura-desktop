/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import { StatusEnum } from '@neura-desktop/shared/types';

import { logger } from '@main/logger';
import { store } from '@main/store/create';
import { AgentRunMode, TaskRunRecord } from '@main/store/types';
import { ComputerRuntimeController } from './computerRuntimeController';
import { HermesRuntimeService } from './hermesRuntime';
import { createTaskRun, TaskRunRegistry } from './taskRunRegistry';

type TaskStartOptions = {
  signal?: AbortSignal;
  backgroundTaskId?: string;
  runMode?: AgentRunMode;
  publicGoal?: string;
  toolsets?: string[];
};

const compact = (value: string, limit = 1200) =>
  value.length > limit ? `${value.slice(0, limit)}...` : value;

export class TaskManager {
  private static instance: TaskManager | null = null;

  static getInstance() {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  listRuns() {
    return TaskRunRegistry.list();
  }

  getRun(runId: string) {
    return TaskRunRegistry.list().find((run) => run.runId === runId) || null;
  }

  private syncRun(run: TaskRunRecord | null) {
    if (!run) {
      return;
    }
    store.setState({
      taskState: run,
    });
  }

  private upsert(run: TaskRunRecord) {
    const saved = TaskRunRegistry.upsert(run);
    this.syncRun(saved);
    return saved;
  }

  private patch(runId: string, patch: Partial<TaskRunRecord>) {
    const saved = TaskRunRegistry.patch(runId, patch);
    this.syncRun(saved);
    return saved;
  }

  private addProgress(
    runId: string,
    item: Parameters<typeof TaskRunRegistry.addProgress>[1],
  ) {
    const saved = TaskRunRegistry.addProgress(runId, item);
    this.syncRun(saved);
    return saved;
  }

  async runDirect(prompt: string, options: Pick<TaskStartOptions, 'signal'> = {}) {
    const result = await HermesRuntimeService.getInstance().run({
      prompt,
      signal: options.signal,
      toolsets: ['web', 'file', 'terminal', 'moa'],
    });
    return result.finalAnswer;
  }

  async startHermesTask(goal: string, options: TaskStartOptions = {}) {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      throw new Error('Task goal is required.');
    }

    const runMode = options.runMode || 'multi_agent';
    const publicGoal = options.publicGoal || trimmedGoal;
    const run = {
      ...createTaskRun(publicGoal, runMode),
      phase: 'planning' as const,
      activeAgent: 'planner' as const,
      backgroundTaskId: options.backgroundTaskId,
    };
    this.upsert(run);
    TaskRunRegistry.setActiveRunId(run.runId);

    ComputerRuntimeController.start({
      mode: 'terminal',
      title: 'Hermes Agent',
      subtitle: 'Hermes backend',
      display: 'Hermes',
      activity: 'Starting',
    });
    store.setState({
      status: StatusEnum.RUNNING,
      thinking: true,
      errorMsg: null,
    });

    try {
      const result = await HermesRuntimeService.getInstance().run({
        prompt: trimmedGoal,
        signal: options.signal,
        toolsets: options.toolsets,
        onProgress: (event) => {
          this.addProgress(run.runId, {
            title: event.title,
            detail: event.detail,
            status: event.status === 'failed' ? 'failed' : event.status || 'done',
            eventType: 'hermes.progress',
          });
          ComputerRuntimeController.output({
            command: 'hermes -z',
            stdout: event.detail,
            failed: event.status === 'failed',
          });
          this.patch(run.runId, {
            phase:
              event.status === 'failed'
                ? 'failed'
                : event.status === 'done'
                  ? 'acting'
                  : 'planning',
            activeAgent: event.status === 'done' ? 'executor' : 'planner',
            currentStep: event.title,
          });
        },
      });

      const completed = this.patch(run.runId, {
        status: 'completed',
        phase: 'completed',
        activeAgent: 'critic',
        finalAnswer: result.finalAnswer,
        validationStatus: 'valid',
        completionProof: {
          kind: 'connector_action',
          summary: 'Hermes backend completed the task.',
          evidence: [compact(result.finalAnswer)],
          verifiedAt: Date.now(),
        },
        completedAt: Date.now(),
      });
      this.addProgress(run.runId, {
        title: 'Hermes task completed',
        detail: compact(result.finalAnswer),
        status: 'done',
        eventType: 'hermes.completed',
      });
      ComputerRuntimeController.complete('Hermes task completed');
      store.setState({
        status: StatusEnum.END,
        thinking: false,
        messages: [
          ...(store.getState().messages || []),
          {
            from: 'gpt',
            value: result.finalAnswer,
          },
        ],
        taskState: completed || store.getState().taskState,
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wasCancelled = options.signal?.aborted;
      logger.warn('[TaskManager] Hermes task failed', error);
      const failed = this.patch(run.runId, {
        status: wasCancelled ? 'cancelled' : 'failed',
        phase: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        finalAnswer: wasCancelled
          ? `The Hermes task was cancelled: ${message}`
          : `Hermes could not complete the task: ${message}`,
        completedAt: Date.now(),
      });
      this.addProgress(run.runId, {
        title: wasCancelled ? 'Hermes task cancelled' : 'Hermes task failed',
        detail: message,
        status: wasCancelled ? 'done' : 'failed',
        eventType: 'hermes.failed',
      });
      if (wasCancelled) {
        ComputerRuntimeController.complete('Hermes task cancelled');
      } else {
        ComputerRuntimeController.fail(message);
      }
      store.setState({
        status: wasCancelled ? StatusEnum.USER_STOPPED : StatusEnum.ERROR,
        thinking: false,
        errorMsg: wasCancelled ? null : message,
        taskState: failed || store.getState().taskState,
      });
      return failed;
    } finally {
      TaskRunRegistry.setActiveRunId(null);
    }
  }

  async startMcpAutonomousTask(goal: string, options: TaskStartOptions = {}) {
    return this.startHermesTask(goal, {
      ...options,
      runMode: 'mcp_autonomous',
    });
  }

  async startMultiAgentTask(goal: string, options: TaskStartOptions = {}) {
    return this.startHermesTask(goal, {
      ...options,
      runMode: 'multi_agent',
    });
  }

  async startSkillTask(input: {
    skillName: string;
    arguments?: Record<string, unknown>;
    goal?: string;
    signal?: AbortSignal;
    backgroundTaskId?: string;
  }) {
    const goal = [
      input.goal || `Use ${input.skillName} skill.`,
      '',
      `Skill: ${input.skillName}`,
      '',
      `Arguments:\n${JSON.stringify(input.arguments || {}, null, 2)}`,
    ].join('\n');

    return this.startHermesTask(goal, {
      runMode: 'skill',
      publicGoal: input.goal || `Use ${input.skillName} skill`,
      signal: input.signal,
      backgroundTaskId: input.backgroundTaskId,
    });
  }

  createRunId() {
    return `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }
}
