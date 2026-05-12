/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';

import {
  AgentRunMode,
  ApprovalEvent,
  CompletionProof,
  TaskArtifact,
  TaskProgressItem,
  TaskRunRecord,
  TaskRunStatus,
  TaskTodoItem,
} from '@main/store/types';
import { SettingStore } from '@main/store/setting';

const MAX_STORED_RUNS = 100;

export const createRunId = () =>
  `run_${Date.now()}_${randomUUID().slice(0, 8)}`;

export const createTaskRun = (
  originalGoal: string,
  runMode: AgentRunMode,
): TaskRunRecord => ({
  runId: createRunId(),
  originalGoal,
  runMode,
  status: 'running',
  todoItems: [],
  progressItems: [],
  factsFound: [],
  sourcesVisited: [],
  artifacts: [],
  approvalEvents: [],
  validationStatus: runMode === 'executor_browser' ? 'pending' : undefined,
  startedAt: Date.now(),
});

const normalizeRun = (run: TaskRunRecord): TaskRunRecord => ({
  ...run,
  todoItems: run.todoItems || [],
  progressItems: run.progressItems || [],
  factsFound: run.factsFound || [],
  sourcesVisited: run.sourcesVisited || [],
  artifacts: run.artifacts || [],
  approvalEvents: run.approvalEvents || [],
});

export class TaskRunRegistry {
  private static activeRunId: string | null = null;

  static setActiveRunId(runId: string | null) {
    TaskRunRegistry.activeRunId = runId;
  }

  static getActiveRunId() {
    return TaskRunRegistry.activeRunId;
  }

  static list(): TaskRunRecord[] {
    return ((SettingStore.get('taskRuns') || []) as TaskRunRecord[]).map(
      normalizeRun,
    );
  }

  static cancelStaleRunningRuns(reason: string) {
    const runs = TaskRunRegistry.list();
    const completedAt = Date.now();
    let changed = false;
    let cancelledCount = 0;
    const nextRuns = runs.map((run) => {
      if (run.status !== 'running') {
        return run;
      }
      changed = true;
      cancelledCount += 1;
      return normalizeRun({
        ...run,
        status: 'cancelled',
        error: reason,
        currentStep: 'Interrupted',
        completedAt,
      });
    });

    if (!changed) {
      return 0;
    }

    SettingStore.set('taskRuns', nextRuns.slice(0, MAX_STORED_RUNS));
    TaskRunRegistry.setActiveRunId(null);
    return cancelledCount;
  }

  static upsert(run: TaskRunRecord) {
    const runs = TaskRunRegistry.list();
    const index = runs.findIndex((item) => item.runId === run.runId);
    const nextRun = normalizeRun(run);
    const nextRuns =
      index >= 0
        ? runs.map((item) => (item.runId === run.runId ? nextRun : item))
        : [nextRun, ...runs];
    SettingStore.set('taskRuns', nextRuns.slice(0, MAX_STORED_RUNS));
    if (nextRun.status === 'running') {
      TaskRunRegistry.setActiveRunId(nextRun.runId);
    }
    return nextRun;
  }

  static patch(runId: string, patch: Partial<TaskRunRecord>) {
    const run = TaskRunRegistry.list().find((item) => item.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({ ...run, ...patch });
  }

  static setStatus(runId: string, status: TaskRunStatus, error?: string) {
    return TaskRunRegistry.patch(runId, {
      status,
      error,
      completedAt:
        status === 'completed' || status === 'failed' || status === 'cancelled'
          ? Date.now()
          : undefined,
    });
  }

  static addProgress(
    runId: string,
    item: Omit<TaskProgressItem, 'id' | 'createdAt'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const progress: TaskProgressItem = {
      ...item,
      id: `${Date.now()}-${run.progressItems.length}`,
      createdAt: Date.now(),
      completedAt:
        item.status === 'done' || item.status === 'failed'
          ? Date.now()
          : undefined,
    };
    return TaskRunRegistry.upsert({
      ...run,
      progressItems: [...run.progressItems, progress],
      currentStep: item.title,
    });
  }

  static addTodo(runId: string, item: TaskTodoItem) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      todoItems: [...run.todoItems, item],
    });
  }

  static addArtifact(
    runId: string,
    artifact: Omit<TaskArtifact, 'sourceRunId'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      artifacts: [...run.artifacts, { ...artifact, sourceRunId: runId }],
    });
  }

  static addApproval(
    runId: string,
    event: Omit<ApprovalEvent, 'id' | 'createdAt'>,
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    const approvalEvent: ApprovalEvent = {
      ...event,
      id: `${Date.now()}-${run.approvalEvents.length}`,
      createdAt: Date.now(),
    };
    TaskRunRegistry.upsert({
      ...run,
      approvalEvents: [...run.approvalEvents, approvalEvent],
    });
    return approvalEvent;
  }

  static setCompletionProof(runId: string, completionProof: CompletionProof) {
    return TaskRunRegistry.patch(runId, {
      completionProof,
      validationStatus: 'valid',
    });
  }

  static updateApproval(
    runId: string,
    eventId: string,
    status: ApprovalEvent['status'],
  ) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return null;
    }
    return TaskRunRegistry.upsert({
      ...run,
      approvalEvents: run.approvalEvents.map((event) =>
        event.id === eventId ? { ...event, status } : event,
      ),
    });
  }

  static hasApprovedApproval(runId: string, action: string, target?: string) {
    const run = TaskRunRegistry.list().find((record) => record.runId === runId);
    if (!run) {
      return false;
    }
    return run.approvalEvents.some(
      (event) =>
        event.action === action &&
        event.target === target &&
        event.status === 'approved',
    );
  }
}
