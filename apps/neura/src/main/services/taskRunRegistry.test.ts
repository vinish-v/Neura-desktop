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
  sourceRecords: [],
  toolCalls: [],
  artifacts: [],
  approvalEvents: [],
  validationFailures: [],
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

  it('records structured source evidence without duplicating visited URLs', () => {
    let persistedRuns: TaskRunRecord[] = [buildRun('run_source', 'running')];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addSource('run_source', {
      url: 'https://example.com/report',
      title: 'Report',
      excerpt: 'A useful source excerpt.',
    });
    TaskRunRegistry.addSource('run_source', {
      url: 'https://example.com/report',
      sourceName: 'Example',
    });

    expect(persistedRuns[0].sourcesVisited).toEqual([
      'https://example.com/report',
    ]);
    expect(persistedRuns[0].sourceRecords).toHaveLength(1);
    expect(persistedRuns[0].sourceRecords[0]).toEqual(
      expect.objectContaining({
        url: 'https://example.com/report',
        title: 'Report',
        sourceName: 'Example',
        quality: expect.objectContaining({
          score: expect.any(Number),
          tier: expect.any(String),
        }),
      }),
    );
  });

  it('records tool calls and validation failures as run evidence', () => {
    let persistedRuns: TaskRunRecord[] = [buildRun('run_tool', 'running')];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addToolCall('run_tool', {
      serverName: 'neura-search',
      toolName: 'search',
      arguments: { query: 'neura' },
      status: 'completed',
      resultPreview: 'result',
    });
    TaskRunRegistry.addValidationFailure('run_tool', 'Need another source.');

    expect(persistedRuns[0].toolCalls[0]).toEqual(
      expect.objectContaining({
        serverName: 'neura-search',
        toolName: 'search',
        status: 'completed',
        resultPreview: 'result',
      }),
    );
    expect(persistedRuns[0].validationFailures).toEqual([
      'Need another source.',
    ]);
    expect(persistedRuns[0].validationStatus).toBe('invalid');
  });

  it('derives verified evidence status for completed source-backed runs', () => {
    let persistedRuns: TaskRunRecord[] = [];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.upsert({
      ...buildRun('run_verified', 'completed'),
      runMode: 'wide_research',
      taskMode: 'research',
      finalAnswer: 'The claim is grounded in a recorded source.',
      sourceRecords: [
        {
          id: 'source-1',
          url: 'https://www.sec.gov/report',
          title: 'SEC Report',
          sourceName: 'SEC',
          excerpt: 'The claim is grounded in a recorded source.',
          quality: {
            score: 91,
            tier: 'high',
            reasons: ['institutional or developer source'],
            domain: 'sec.gov',
          },
          capturedAt: 2,
        },
      ],
      completedAt: 3,
    });

    expect(persistedRuns[0].evidenceValidation).toEqual(
      expect.objectContaining({
        completionStatus: 'verified',
        confidence: expect.any(Number),
      }),
    );
    expect(persistedRuns[0].evidence?.[0]).toEqual(
      expect.objectContaining({
        kind: 'citation_source',
        url: 'https://www.sec.gov/report',
      }),
    );
  });

  it('marks completed runs as needing verification when evidence is missing', () => {
    let persistedRuns: TaskRunRecord[] = [];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.upsert({
      ...buildRun('run_missing', 'completed'),
      finalAnswer: 'Done.',
      completedAt: 4,
    });

    expect(persistedRuns[0].evidenceValidation).toEqual(
      expect.objectContaining({
        completionStatus: 'needs_verification',
      }),
    );
    expect(persistedRuns[0].evidenceValidation?.missingEvidence).toContain(
      'Attach at least one source, artifact, browser, command, or connector evidence record.',
    );
  });

  it('redacts secrets from derived tool-call evidence', () => {
    let persistedRuns: TaskRunRecord[] = [buildRun('run_secret', 'running')];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addToolCall('run_secret', {
      serverName: 'github',
      toolName: 'create_issue',
      arguments: {
        token: 'ghp_secret',
        payload: 'apiKey=sk-secret',
      },
      status: 'completed',
      resultPreview: 'Authorization: Bearer abc123',
    });

    const serialized = JSON.stringify(persistedRuns[0].evidence);
    expect(serialized).not.toContain('ghp_secret');
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('abc123');
    expect(serialized).toContain('[REDACTED]');
  });

  it('stores explicit recovery evidence as panel-safe data', () => {
    let persistedRuns: TaskRunRecord[] = [buildRun('run_recovery', 'running')];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addEvidence('run_recovery', {
      id: 'recovery-1',
      kind: 'browser_snapshot',
      summary: 'Browser recovery evidence: Login required',
      status: 'completed',
      metadata: {
        recovery: {
          kind: 'blocked_or_login_required',
          nextAction: 'ask_user_for_login_or_captcha',
          failureMessage: 'Authorization: Bearer abc123',
        },
      },
    });

    const serialized = JSON.stringify(persistedRuns[0].evidence);
    expect(persistedRuns[0].evidence?.[0]).toEqual(
      expect.objectContaining({
        kind: 'browser_snapshot',
        summary: 'Browser recovery evidence: Login required',
        metadata: expect.objectContaining({
          recovery: expect.objectContaining({
            nextAction: 'ask_user_for_login_or_captcha',
          }),
        }),
      }),
    );
    expect(serialized).not.toContain('abc123');
    expect(serialized).toContain('[REDACTED]');
  });
});
