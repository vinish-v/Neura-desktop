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

import {
  buildTaskRunEvidenceRequirements,
  TaskRunRegistry,
} from './taskRunRegistry';

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
      url: 'https://example.com/report#section',
      title: 'Report',
      excerpt: 'Published: May 18, 2026. A useful source excerpt.',
      claimIds: ['claim-1'],
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
        visibleDate: 'May 18, 2026',
        publishedAt: expect.any(Number),
        claimIds: ['claim-1'],
        quality: expect.objectContaining({
          score: expect.any(Number),
          tier: expect.any(String),
        }),
      }),
    );
  });

  it('tracks Wide Research worker citations and retries failed workers independently', () => {
    let persistedRuns: TaskRunRecord[] = [
      {
        ...buildRun('run_wide', 'running'),
        runMode: 'wide_research',
        wideResearchWorkers: [
          {
            id: 'worker-1',
            subtask: 'Find official sources',
            status: 'running',
            sessionId: 'session-1',
            attempts: 0,
            sourceUrls: [],
            claimIds: [],
            updatedAt: 1,
          },
          {
            id: 'worker-2',
            subtask: 'Find analyst sources',
            status: 'failed',
            sessionId: 'session-2',
            attempts: 1,
            sourceUrls: [],
            claimIds: [],
            error: 'timeout',
            completedAt: 2,
            updatedAt: 2,
          },
        ],
      },
    ];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addSource('run_wide', {
      url: 'https://www.sec.gov/report/',
      title: 'Official report',
      workerId: 'worker-1',
      claimIds: ['claim-a'],
    });
    TaskRunRegistry.retryFailedWideResearchWorkers('run_wide');

    expect(persistedRuns[0].wideResearchWorkers?.[0]).toEqual(
      expect.objectContaining({
        id: 'worker-1',
        sourceUrls: ['https://www.sec.gov/report'],
        claimIds: ['claim-a'],
      }),
    );
    expect(persistedRuns[0].wideResearchWorkers?.[1]).toEqual(
      expect.objectContaining({
        id: 'worker-2',
        status: 'pending',
        attempts: 2,
        error: undefined,
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

  it('stores a resumable state digest on every checkpoint', () => {
    let persistedRuns: TaskRunRecord[] = [
      {
        ...buildRun('run_checkpoint', 'running'),
        phase: 'acting',
        currentStep: 'Use browser',
        nextAction: 'Validate output',
        workspacePath: 'D:\\workspaces\\run_checkpoint',
        sessionId: 'neura_run_checkpoint',
        todoItems: [
          { id: 'todo-1', text: 'Find source', status: 'done' },
          { id: 'todo-2', text: 'Validate output', status: 'pending' },
        ],
        browserRestoreSnapshot: {
          url: 'https://example.com',
          title: 'Example',
          profilePath: 'C:\\Users\\HP\\AppData\\Roaming\\Neura\\browser',
          backend: 'local',
          cdpUrl: 'http://127.0.0.1:9222',
          takeoverActive: false,
          bridgeStatus: 'connected',
          capturedAt: 12,
          health: {
            executableExists: true,
            portReachable: true,
            bridgeStatus: 'connected',
            checkedAt: 12,
            issues: [],
            profile: {
              exists: true,
              writable: true,
              lockState: 'unlocked',
              issues: [],
            },
          },
        },
      },
    ];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addCheckpoint('run_checkpoint', {
      label: 'Observed browser state',
      status: 'validated',
      summary: 'Captured current state before validation.',
    });

    expect(persistedRuns[0].checkpoints?.[0]).toEqual(
      expect.objectContaining({
        label: 'Observed browser state',
        snapshot: expect.objectContaining({
          phase: 'acting',
          status: 'running',
          currentStep: 'Use browser',
          nextAction: 'Validate output',
          workspacePath: 'D:\\workspaces\\run_checkpoint',
          sessionId: 'neura_run_checkpoint',
          browser: expect.objectContaining({
            url: 'https://example.com',
            bridgeStatus: 'connected',
            takeoverActive: false,
          }),
          counts: expect.objectContaining({
            evidence: expect.any(Number),
            validationFailures: 0,
          }),
          todos: {
            pending: 1,
            inProgress: 0,
            done: 1,
            failed: 0,
          },
        }),
      }),
    );
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

  it('builds task-type-specific completion proof requirements', () => {
    expect(
      buildTaskRunEvidenceRequirements({
        ...buildRun('website', 'completed'),
        runMode: 'website_builder',
        taskMode: 'code',
      }),
    ).toEqual(
      expect.objectContaining({
        requireFileArtifact: true,
        requireCommandTest: true,
        acceptedArtifactKinds: ['website', 'archive', 'report', 'other'],
      }),
    );

    expect(
      buildTaskRunEvidenceRequirements({
        ...buildRun('browser', 'completed'),
        runMode: 'executor_browser',
        taskMode: 'browser_login',
      }),
    ).toEqual(
      expect.objectContaining({
        requireBrowserSnapshot: true,
      }),
    );

    expect(
      buildTaskRunEvidenceRequirements({
        ...buildRun('media', 'completed'),
        runMode: 'multimodal_workflow',
      }),
    ).toEqual(
      expect.objectContaining({
        requireFileArtifact: true,
        acceptedArtifactKinds: ['image', 'audio', 'video'],
      }),
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

  it('persists browser restore snapshots on the target run only', () => {
    let persistedRuns: TaskRunRecord[] = [
      buildRun('run_target', 'running'),
      buildRun('run_other', 'completed'),
    ];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.setBrowserRestoreSnapshot('run_target', {
      url: 'https://example.com/dashboard',
      title: 'Dashboard',
      profilePath: 'C:\\Users\\HP\\AppData\\Roaming\\Neura\\browser',
      backend: 'local',
      cdpUrl: 'http://127.0.0.1:9222',
      takeoverActive: false,
      bridgeStatus: 'connected',
      capturedAt: 12,
      health: {
        executablePath:
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        executableExists: true,
        port: 9222,
        portReachable: true,
        bridgeStatus: 'connected',
        checkedAt: 12,
        issues: [],
        profile: {
          profilePath: 'C:\\Users\\HP\\AppData\\Roaming\\Neura\\browser',
          exists: true,
          writable: true,
          lockState: 'unlocked',
          issues: [],
        },
      },
    });

    expect(persistedRuns[0]).toEqual(
      expect.objectContaining({
        runId: 'run_target',
        browserRestoreSnapshot: expect.objectContaining({
          url: 'https://example.com/dashboard',
          title: 'Dashboard',
          bridgeStatus: 'connected',
        }),
      }),
    );
    expect(persistedRuns[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'run_target-browser-restore',
          kind: 'browser_snapshot',
          url: 'https://example.com/dashboard',
        }),
      ]),
    );
    expect(persistedRuns[1]).toEqual(
      expect.objectContaining({
        runId: 'run_other',
      }),
    );
    expect(persistedRuns[1]).not.toHaveProperty('browserRestoreSnapshot');
  });

  it('records browser action audit and timing budgets for slow steps', () => {
    let persistedRuns: TaskRunRecord[] = [
      {
        ...buildRun('run_browser_metrics', 'running'),
        runMode: 'executor_browser',
        browserRestoreSnapshot: {
          url: 'https://example.com/start',
          title: 'Start',
          profilePath: 'C:\\Users\\HP\\AppData\\Roaming\\Neura\\browser',
          backend: 'local',
          cdpUrl: 'http://127.0.0.1:9222',
          takeoverActive: false,
          bridgeStatus: 'connected',
          capturedAt: 12,
          health: {
            executableExists: true,
            portReachable: true,
            bridgeStatus: 'connected',
            checkedAt: 12,
            issues: [],
            profile: {
              exists: true,
              writable: true,
              lockState: 'unlocked',
              issues: [],
            },
          },
        },
      },
    ];
    mocks.settingGet.mockImplementation(() => persistedRuns);
    mocks.settingSet.mockImplementation((_key, value) => {
      persistedRuns = value as TaskRunRecord[];
    });

    TaskRunRegistry.addBrowserActionAudit('run_browser_metrics', {
      externalCallId: 'call-1',
      action: 'browser_navigate',
      target: 'https://example.com/final',
      urlBefore: 'https://example.com/start',
      status: 'pending',
      startedAt: 100,
    });
    TaskRunRegistry.updateBrowserActionAudit('run_browser_metrics', 'call-1', {
      status: 'completed',
      urlAfter: 'https://example.com/final',
      titleAfter: 'Final',
      completedAt: 35_200,
    });
    TaskRunRegistry.recordBrowserTiming(
      'run_browser_metrics',
      'browser_navigate',
      35_100,
      'navigation',
    );

    expect(persistedRuns[0].browserActionAudit?.[0]).toEqual(
      expect.objectContaining({
        action: 'browser_navigate',
        status: 'completed',
        urlBefore: 'https://example.com/start',
        urlAfter: 'https://example.com/final',
        durationMs: 35_100,
      }),
    );
    expect(persistedRuns[0].browserTiming).toEqual(
      expect.objectContaining({
        navigationCount: 1,
        navigationMs: 35_100,
        slowSteps: [
          expect.objectContaining({
            action: 'browser_navigate',
            kind: 'navigation',
            budgetMs: 30_000,
          }),
        ],
      }),
    );
    expect(
      TaskRunRegistry.summarizeBrowserPerformance('run_browser_metrics'),
    ).toEqual(
      expect.objectContaining({
        runId: 'run_browser_metrics',
        actionAudit: expect.arrayContaining([
          expect.objectContaining({ action: 'browser_navigate' }),
        ]),
      }),
    );
  });
});
