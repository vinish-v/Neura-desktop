/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { store } from '@main/store/create';

import { TaskRunRegistry } from './taskRunRegistry';

type PendingQuestion = {
  runId: string;
  eventId: string;
  resolve: (answer: string) => void;
};

const pendingQuestions = new Map<string, PendingQuestion>();

const keyFor = (runId: string, eventId: string) => `${runId}:${eventId}`;

const syncStoreTaskState = (runId: string) => {
  const run = TaskRunRegistry.list().find((item) => item.runId === runId);
  if (!run) {
    return;
  }
  const current = store.getState();
  if (current.taskState?.runId === runId) {
    store.setState({
      taskState: run,
    });
  }
};

const normalizeChoices = (choices?: string[]) =>
  (choices || [])
    .map((choice) => choice.trim())
    .filter(Boolean)
    .slice(0, 6);

export async function requestUserQuestion({
  question,
  context,
  choices,
}: {
  question: string;
  context?: string;
  choices?: string[];
}) {
  const runId = TaskRunRegistry.getActiveRunId();
  if (!runId) {
    throw new Error(
      `A user question was requested, but no active run exists: ${question}`,
    );
  }

  const event = TaskRunRegistry.addUserQuestion(runId, {
    question,
    context,
    choices: normalizeChoices(choices),
    status: 'requested',
  });
  if (!event) {
    throw new Error(
      `A user question was requested, but run ${runId} was not found.`,
    );
  }

  TaskRunRegistry.addProgress(runId, {
    title: 'Question for user',
    detail: question,
    status: 'pending',
    eventType: 'user.question',
  });
  syncStoreTaskState(runId);

  return new Promise<string>((resolve) => {
    pendingQuestions.set(keyFor(runId, event.id), {
      runId,
      eventId: event.id,
      resolve,
    });
  });
}

export function resolveUserQuestion({
  runId,
  eventId,
  answer,
}: {
  runId: string;
  eventId: string;
  answer: string;
}) {
  const trimmed = answer.trim();
  if (!trimmed) {
    return false;
  }

  const key = keyFor(runId, eventId);
  const pending = pendingQuestions.get(key);
  TaskRunRegistry.updateUserQuestion(runId, eventId, {
    status: 'answered',
    answer: trimmed,
    answeredAt: Date.now(),
  });
  TaskRunRegistry.addProgress(runId, {
    title: 'User answered question',
    detail: 'Neura received the missing decision and can continue.',
    status: 'done',
    eventType: 'user.question.answered',
  });
  syncStoreTaskState(runId);

  if (!pending) {
    return false;
  }

  pendingQuestions.delete(key);
  pending.resolve(trimmed);
  return true;
}
