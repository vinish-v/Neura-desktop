import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRunRecord } from '@main/store/types';

const mocks = vi.hoisted(() => ({
  settingGet: vi.fn(),
  settingSet: vi.fn(),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: mocks.settingGet,
    set: mocks.settingSet,
  },
}));

import { TaskRunRegistry } from './taskRunRegistry';

const buildRun = (
  runId: string,
  status: TaskRunRecord['status'],
): TaskRunRecord => ({
  runId,
  originalGoal: runId,
  runMode: 'gui_browser',
  status,
  todoItems: [],
  progressItems: [],
  factsFound: [],
  sourcesVisited: [],
  artifacts: [],
  approvalEvents: [],
  startedAt: 1,
});

describe('TaskRunRegistry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    TaskRunRegistry.setActiveRunId('run_active');
  });

  it('cancels persisted running runs on startup', () => {
    mocks.settingGet.mockReturnValue([
      buildRun('run_running', 'running'),
      buildRun('run_completed', 'completed'),
    ]);

    const count = TaskRunRegistry.cancelStaleRunningRuns(
      'Interrupted by previous app session.',
    );

    expect(count).toBe(1);
    expect(TaskRunRegistry.getActiveRunId()).toBeNull();
    expect(mocks.settingSet).toHaveBeenCalledWith(
      'taskRuns',
      expect.arrayContaining([
        expect.objectContaining({
          runId: 'run_running',
          status: 'cancelled',
          error: 'Interrupted by previous app session.',
          currentStep: 'Interrupted',
          completedAt: expect.any(Number),
        }),
        expect.objectContaining({
          runId: 'run_completed',
          status: 'completed',
        }),
      ]),
    );
  });

  it('does not rewrite task runs when there are no stale running records', () => {
    mocks.settingGet.mockReturnValue([buildRun('run_completed', 'completed')]);

    const count = TaskRunRegistry.cancelStaleRunningRuns('not used');

    expect(count).toBe(0);
    expect(mocks.settingSet).not.toHaveBeenCalled();
    expect(TaskRunRegistry.getActiveRunId()).toBe('run_active');
  });

  it('keeps sequential task runs isolated in history', () => {
    let persistedRuns: TaskRunRecord[] = [];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.upsert({
      ...buildRun('run_a', 'completed'),
      finalAnswer: 'answer A',
      completedAt: 10,
    });
    TaskRunRegistry.upsert({
      ...buildRun('run_b', 'completed'),
      finalAnswer: 'answer B',
      completedAt: 20,
    });

    expect(persistedRuns.map((run) => run.runId)).toEqual([
      'run_b',
      'run_a',
    ]);
    expect(persistedRuns[0]).toEqual(
      expect.objectContaining({ runId: 'run_b', finalAnswer: 'answer B' }),
    );
    expect(persistedRuns[1]).toEqual(
      expect.objectContaining({ runId: 'run_a', finalAnswer: 'answer A' }),
    );
  });
});
