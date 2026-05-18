/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@neura-desktop/electron-ipc/main';

import { checkLocalBrowserHealth } from '@main/services/hermesBrowserBridge';
import type { BrowserBridgeHealth } from '@main/store/types';
import { TaskRunRegistry } from '@main/services/taskRunRegistry';

const t = initIpc.create();

export type BrowserHealthRecord = {
  id: string;
  health: BrowserBridgeHealth;
  activeRunId: string | null;
  isSessionActive: boolean;
  checkedAt: number;
};

export type RecoveryHistoryItem = {
  label: string;
  action: string;
  kind: string;
  url?: string;
  timestamp: number;
};

export type HealthDashboardData = {
  currentHealth: BrowserHealthRecord | null;
  recoveryHistory: RecoveryHistoryItem[];
  activeRunBrowserSnapshotCount: number;
  recentBrowserSnapshotRuns: number;
};

export const healthRoute = t.router({
  getBrowserHealth: t.procedure.input<void>().handle(async () => {
    const health = await checkLocalBrowserHealth({
      profilePath: undefined,
      cdpUrl: undefined,
      bridgeStatus: 'not_started',
    });

    const activeRunId = TaskRunRegistry.getActiveRunId();

    const record: BrowserHealthRecord = {
      id: `health-${Date.now()}`,
      health,
      activeRunId,
      isSessionActive: Boolean(activeRunId),
      checkedAt: Date.now(),
    };

    return record;
  }),

  getHealthDashboardData: t.procedure.input<void>().handle(async () => {
    const runs = TaskRunRegistry.list();
    const activeRunId = TaskRunRegistry.getActiveRunId();

    const health = await checkLocalBrowserHealth({
      profilePath: undefined,
      cdpUrl: undefined,
      bridgeStatus: activeRunId ? 'connected' : 'not_started',
    });

    const recoveryHistory: RecoveryHistoryItem[] = [];

    for (const run of runs.slice(0, 20)) {
      for (const progress of run.progressItems || []) {
        if (
          progress.eventType === 'automation.recovery' ||
          progress.eventType === 'runtime.recovery'
        ) {
          recoveryHistory.push({
            label: progress.title,
            action: progress.eventType,
            kind: progress.status,
            url: run.originalGoal,
            timestamp: progress.createdAt,
          });
        }
      }
    }

    recoveryHistory.sort((a, b) => b.timestamp - a.timestamp);

    const runsWithBrowserSnapshots = runs.filter(
      (run) => run.browserRestoreSnapshot,
    );

    const dashboard: HealthDashboardData = {
      currentHealth: {
        id: `health-${Date.now()}`,
        health,
        activeRunId,
        isSessionActive: Boolean(activeRunId),
        checkedAt: Date.now(),
      },
      recoveryHistory: recoveryHistory.slice(0, 50),
      activeRunBrowserSnapshotCount: runsWithBrowserSnapshots.filter(
        (run) => run.runId === activeRunId,
      ).length,
      recentBrowserSnapshotRuns: runsWithBrowserSnapshots.length,
    };

    return dashboard;
  }),

  getRunBrowserSnapshots: t.procedure
    .input<{ limit?: number }>()
    .handle(async ({ input }) => {
      const runs = TaskRunRegistry.list();
      return runs
        .filter((run) => run.browserRestoreSnapshot)
        .slice(0, input?.limit || 10)
        .map((run) => ({
          runId: run.runId,
          originalGoal: run.originalGoal,
          snapshot: run.browserRestoreSnapshot,
        }));
    }),
});
