/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StatusEnum } from '@neura-desktop/shared/types';

import {
  AgentRunMode,
  AppState,
  CompletionProof,
  TaskArtifact,
  TaskProgressEventType,
  TaskProgressItem,
  TaskState,
  TaskTodoItem,
} from '@main/store/types';
import { ConversationWithSoM } from '@main/shared/types';
import { createTaskRun, TaskRunRegistry } from './taskRunRegistry';
import { prepareTaskRunContext } from './taskContextMemory';

type StateAccess = {
  getState: () => AppState;
  setState: (state: AppState) => void;
};

export type TaskProgressEvent = {
  type: TaskProgressEventType;
  title: string;
  detail?: string;
  status?: 'pending' | 'in_progress' | 'done' | 'failed';
};

const statusToTodoStatus = (
  status: TaskProgressEvent['status'],
): TaskTodoItem['status'] => {
  if (status === 'done') {
    return 'done';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'in_progress') {
    return 'in_progress';
  }
  return 'pending';
};

const eventTypeToPhase = (
  event: TaskProgressEvent,
): TaskState['phase'] | undefined => {
  if (event.type === 'plan.updated') {
    return 'planning';
  }
  if (event.type === 'step.started' || event.type === 'step.completed') {
    return 'acting';
  }
  if (event.type === 'validation.completed') {
    return 'validating';
  }
  if (event.type === 'task.completed') {
    return 'completed';
  }
  if (event.type === 'step.failed') {
    return 'failed';
  }
  return undefined;
};

const normalizeProgressText = (value?: string) =>
  (value || '').replace(/\s+/g, ' ').trim();

const isDuplicateProgressMessage = (
  progressItems: TaskProgressItem[],
  event: TaskProgressEvent,
) => {
  const last = progressItems[progressItems.length - 1];
  if (!last) {
    return false;
  }

  return (
    normalizeProgressText(last.title) ===
      normalizeProgressText(event.title) &&
    normalizeProgressText(last.detail) ===
      normalizeProgressText(event.detail || event.title)
  );
};

const extractPlanTodoItems = (
  detail: string | undefined,
  existingItems: TaskTodoItem[],
) => {
  const lines = (detail || '')
    .split(/\r?\n|(?=\s*\d+\.\s+)/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^\d+\.\s+|^[-*]\s+/, '').trim())
    .filter((line) => line.length >= 8)
    .slice(0, 8);

  if (!lines.length) {
    return existingItems;
  }

  return lines.map((text, index) => {
    const existing = existingItems.find(
      (item) =>
        normalizeProgressText(item.text) === normalizeProgressText(text),
    );
    return {
      id: existing?.id || `plan-${Date.now()}-${index}`,
      text,
      status: existing?.status || (index === 0 ? 'in_progress' : 'pending'),
    };
  });
};

export class AgentOrchestrator {
  private readonly getState: () => AppState;
  private readonly setState: (state: AppState) => void;

  constructor({ getState, setState }: StateAccess) {
    this.getState = getState;
    this.setState = setState;
  }

  begin(originalGoal: string, runMode: AgentRunMode) {
    const taskState: TaskState = prepareTaskRunContext(
      {
        ...createTaskRun(originalGoal, runMode),
        phase: 'planning',
      },
      TaskRunRegistry.list(),
    );
    TaskRunRegistry.upsert(taskState);
    TaskRunRegistry.setActiveRunId(taskState.runId);

    this.setState({
      ...this.getState(),
      status: StatusEnum.RUNNING,
      taskState,
    });

    this.emit({
      type: 'task.started',
      title: `Started ${runMode.replace(/_/g, ' ')}`,
      detail: originalGoal,
      status: 'in_progress',
    });
  }

  getCurrentRunId() {
    const runId = this.getState().taskState?.runId;
    if (!runId) {
      throw new Error('No active task run.');
    }
    return runId;
  }

  emit(event: TaskProgressEvent) {
    const current = this.getState();
    const taskState = current.taskState;
    if (isDuplicateProgressMessage(taskState?.progressItems || [], event)) {
      return;
    }

    const nextTodoItems =
      event.type === 'plan.updated'
        ? extractPlanTodoItems(event.detail, taskState?.todoItems || [])
        : taskState?.todoItems || [];
    const nextProgressItems =
      taskState && event.type !== 'task.started'
        ? [
            ...(taskState.progressItems || []),
            {
              id: `${Date.now()}-${taskState.progressItems.length}`,
              title: event.title,
              detail: event.detail,
              status: statusToTodoStatus(event.status),
              createdAt: Date.now(),
              completedAt:
                event.status === 'done' || event.status === 'failed'
                  ? Date.now()
                  : undefined,
            },
          ]
        : taskState?.progressItems || [];

    const nextTaskState = taskState
      ? {
          ...taskState,
          phase: eventTypeToPhase(event) || taskState.phase,
          todoItems: nextTodoItems,
          progressItems: nextProgressItems,
          currentStep:
            event.type === 'step.started' ? event.title : taskState.currentStep,
          validationStatus:
            event.type === 'validation.completed'
              ? event.status === 'done'
                ? 'valid'
                : 'invalid'
              : taskState.validationStatus,
        }
      : taskState;

    if (nextTaskState) {
      TaskRunRegistry.upsert(nextTaskState);
    }

    this.setState({
      ...current,
      taskState: nextTaskState,
    });
  }

  addFact(fact: string) {
    const current = this.getState();
    if (!current.taskState || !fact.trim()) {
      return;
    }

    const nextTaskState = {
      ...current.taskState,
      factsFound: [...current.taskState.factsFound, fact.trim()].slice(-30),
    };
    TaskRunRegistry.upsert(nextTaskState);

    this.setState({
      ...current,
      taskState: nextTaskState,
    });
  }

  addSource(url: string) {
    const current = this.getState();
    if (!current.taskState || !url.trim()) {
      return;
    }

    const nextTaskState = TaskRunRegistry.addSource(current.taskState.runId, {
      url,
    });

    this.setState({
      ...current,
      taskState: nextTaskState || current.taskState,
    });
  }

  addArtifact(artifact: Omit<TaskArtifact, 'sourceRunId'>) {
    const current = this.getState();
    if (!current.taskState) {
      return;
    }

    const nextTaskState = {
      ...current.taskState,
      artifacts: [
        ...current.taskState.artifacts,
        { ...artifact, sourceRunId: current.taskState.runId },
      ],
    };
    TaskRunRegistry.upsert(nextTaskState);

    this.setState({
      ...current,
      taskState: nextTaskState,
    });
  }

  setCompletionProof(completionProof: CompletionProof) {
    const current = this.getState();
    if (!current.taskState) {
      return;
    }

    const nextTaskState = {
      ...current.taskState,
      completionProof,
      validationStatus: 'valid' as const,
      phase: 'validating' as const,
    };
    TaskRunRegistry.upsert(nextTaskState);

    this.setState({
      ...current,
      taskState: nextTaskState,
    });
  }

  complete(finalAnswer?: string) {
    const current = this.getState();
    const trimmedAnswer = finalAnswer?.trim();
    const messages = current.messages || [];
    const shouldAppendFinalAnswer =
      Boolean(trimmedAnswer) &&
      messages[messages.length - 1]?.value?.trim() !== trimmedAnswer;
    const finalAnswerMessage: ConversationWithSoM | undefined = trimmedAnswer
      ? {
          from: 'gpt',
          value: trimmedAnswer,
          predictionParsed: [
            {
              reflection: null,
              thought: 'Final answer',
              action_type: 'finished',
              action_inputs: {
                content: trimmedAnswer,
              },
            },
          ],
        }
      : undefined;
    const nextTaskState = current.taskState
      ? {
          ...current.taskState,
          status: 'completed' as const,
          phase: 'completed' as const,
          finalAnswer: trimmedAnswer || finalAnswer,
          validationStatus: 'valid' as const,
          completedAt: Date.now(),
        }
      : current.taskState;
    if (nextTaskState) {
      TaskRunRegistry.upsert(nextTaskState);
    }
    this.setState({
      ...current,
      status: StatusEnum.END,
      thinking: false,
      taskState: nextTaskState,
      messages:
        shouldAppendFinalAnswer && finalAnswerMessage
          ? [...messages, finalAnswerMessage]
          : messages,
    });
  }

  fail(errorMsg: string) {
    const current = this.getState();
    const nextTaskState = current.taskState
      ? {
          ...current.taskState,
          status: 'failed' as const,
          phase: 'failed' as const,
          error: errorMsg,
          validationStatus: 'failed' as const,
          completedAt: Date.now(),
        }
      : current.taskState;
    if (nextTaskState) {
      TaskRunRegistry.upsert(nextTaskState);
    }
    this.setState({
      ...current,
      status: StatusEnum.ERROR,
      thinking: false,
      errorMsg,
      taskState: nextTaskState,
    });
  }
}
