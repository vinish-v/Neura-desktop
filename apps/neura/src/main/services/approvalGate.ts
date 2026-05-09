/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { store } from '@main/store/create';
import { ApprovalEvent } from '@main/store/types';
import { TaskRunRegistry } from './taskRunRegistry';

type PendingApproval = {
  runId: string;
  eventId: string;
  resolve: (approved: boolean) => void;
};

const pendingApprovals = new Map<string, PendingApproval>();

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

export async function requestUserApproval({
  action,
  target,
  risk = 'medium',
}: {
  action: string;
  target?: string;
  risk?: ApprovalEvent['risk'];
}) {
  const runId = TaskRunRegistry.getActiveRunId();
  if (!runId) {
    throw new Error(
      `Approval required for ${action}, but no active run exists.`,
    );
  }

  if (TaskRunRegistry.hasApprovedApproval(runId, action, target)) {
    return true;
  }

  const event = TaskRunRegistry.addApproval(runId, {
    action,
    target,
    risk,
    status: 'requested',
  });
  if (!event) {
    throw new Error(
      `Approval required for ${action}, but run ${runId} was not found.`,
    );
  }

  syncStoreTaskState(runId);

  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(keyFor(runId, event.id), {
      runId,
      eventId: event.id,
      resolve,
    });
  });
}

export function resolveUserApproval({
  runId,
  eventId,
  approved,
}: {
  runId: string;
  eventId: string;
  approved: boolean;
}) {
  const key = keyFor(runId, eventId);
  const pending = pendingApprovals.get(key);
  TaskRunRegistry.updateApproval(
    runId,
    eventId,
    approved ? 'approved' : 'denied',
  );
  syncStoreTaskState(runId);

  if (!pending) {
    return false;
  }

  pendingApprovals.delete(key);
  pending.resolve(approved);
  return true;
}
