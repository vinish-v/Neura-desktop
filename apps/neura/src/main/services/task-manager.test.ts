import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRunRecord } from '@main/store/types';

const mocks = vi.hoisted(() => {
  const runs: TaskRunRecord[] = [];
  return {
    runs,
    activeRunId: null as string | null,
    hermesRun: vi.fn(async (input: any) => {
      if (String(input.prompt).includes('Worker id:')) {
        const workerId = /Worker id: ([^\n]+)/u.exec(input.prompt)?.[1] || 'worker';
        input.onEvent?.({
          type: 'tool.call.completed',
          callId: `call-${workerId}`,
          toolName: 'browser_navigate',
          arguments: {
            url: `https://${workerId}.research.test/report`,
          },
          resultPreview: `Source https://${workerId}.research.test/report`,
        });
        return {
          finalAnswer: `Worker ${workerId} done`,
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: 'hermes',
        };
      }
      if (String(input.prompt).includes('pending computer action')) {
        input.onEvent?.({
          type: 'tool.call.started',
          callId: 'pending-call',
          toolName: 'run_command',
          arguments: {
            command: 'npm run build',
          },
          preview: 'Started npm run build',
        });
      }
      return {
        finalAnswer: 'Final synthesized report with citations.',
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'hermes',
      };
    }),
  };
});

vi.mock('@neura-desktop/shared/types', () => ({
  StatusEnum: {
    RUNNING: 'running',
    END: 'end',
    ERROR: 'error',
    USER_STOPPED: 'user_stopped',
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/store/create', () => ({
  store: {
    getState: () => ({
      messages: [],
      taskState: mocks.runs[0] || null,
    }),
    setState: vi.fn(),
  },
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    getStore: () => ({
      hermesBrowserBackend: 'local',
      vlmBaseUrl: 'https://example.test/v1',
      vlmApiKey: 'test-key',
      vlmModelName: 'test-model',
      plannerBaseUrl: 'https://example.test/v1',
      plannerApiKey: 'test-key',
      plannerModelName: 'test-model',
      usePlannerModel: true,
    }),
  },
}));

vi.mock('./computerRuntimeController', () => ({
  ComputerRuntimeController: {
    start: vi.fn(),
    update: vi.fn(),
    output: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  },
}));

vi.mock('./hermesRuntime', () => ({
  buildBrowserSearchPolicy: () =>
    'Browser search preference: use Google Search first. Do not use DuckDuckGo unless explicitly requested.',
  HermesRuntimeService: {
    getInstance: () => ({
      run: mocks.hermesRun,
    }),
  },
}));

vi.mock('./taskContextMemory', () => ({
  getTaskContextHint: () => '',
  prepareTaskRunContext: (run: TaskRunRecord) => ({
    ...run,
    workspacePath: 'D:\\tmp\\neura-test-run',
  }),
}));

vi.mock('./productionReadiness', () => ({
  assessProductionReadiness: vi.fn(async () => ({
    status: 'ready',
    summary: 'Ready for tests.',
    issues: [],
    checkedAt: Date.now(),
  })),
  formatProductionReadinessForPrompt: () => 'Production readiness preflight: ready',
}));

vi.mock('./hermesTaskRouter', () => ({
  classifyHermesTask: () => ({
    runMode: 'wide_research',
    taskMode: 'research',
    browserBackend: 'local',
    toolsets: ['browser', 'memory'],
    requiredArtifactKinds: [],
    validationHint: 'Validate research.',
    promptDirectives: [],
  }),
}));

vi.mock('./intentArbitration', () => ({
  classifyHermesTaskWithArbitration: () => ({
    runMode: 'wide_research',
    taskMode: 'research',
    browserBackend: 'local',
    toolsets: ['browser', 'memory'],
    requiredArtifactKinds: [],
    requiresSource: true,
    requiresBrowser: true,
    riskLevel: 'low',
    semanticContract: {
      taskType: 'wide_research',
      requiredTools: ['browser'],
      riskLevel: 'low',
      expectedArtifacts: ['citation_records'],
      needsApproval: false,
      verificationRequired: true,
      completionProof: 'sources',
    },
    validationHint: 'Validate research.',
    promptDirectives: [],
  }),
}));

vi.mock('./artifactValidation', () => ({
  validateArtifactFile: vi.fn(),
}));

vi.mock('@shared/taskEvidence', () => ({
  sanitizeTaskEvidence: (evidence: any) => evidence,
  validateTaskEvidence: ({ knownFailures = [] }: any = {}) =>
    knownFailures.length
      ? {
          completionStatus: 'blocked',
          confidence: 0,
          agentFacingMessage: 'blocked',
          userFacingMessage: 'blocked',
          missingEvidence: knownFailures,
          safeEvidence: [],
        }
      : {
          completionStatus: 'verified',
          confidence: 0.95,
          agentFacingMessage: 'verified',
          userFacingMessage: 'verified',
          missingEvidence: [],
          safeEvidence: [
            {
              id: 'source',
              kind: 'source',
              summary: 'source',
              status: 'completed',
              confidence: 0.9,
              capturedAt: Date.now(),
              url: 'https://worker.research.test/report',
            },
          ],
        },
}));

vi.mock('./sourceQuality', () => ({
  summarizeSourceQuality: () => ({
    sourceCount: 4,
    highQualityCount: 0,
    mediumOrBetterCount: 4,
    averageScore: 70,
    domains: ['research.test'],
  }),
}));

vi.mock('./taskRunRegistry', () => {
  const createTaskRun = (goal: string, runMode: TaskRunRecord['runMode']) =>
    ({
      runId: 'run-1',
      sessionId: 'session-1',
      originalGoal: goal,
      runMode,
      status: 'pending',
      todoItems: [],
      progressItems: [],
      factsFound: [],
      sourcesVisited: [],
      sourceRecords: [],
      toolCalls: [],
      artifacts: [],
      approvalEvents: [],
      validationFailures: [],
      checkpoints: [],
      startedAt: Date.now(),
    }) as TaskRunRecord;

  const upsertRun = (run: TaskRunRecord) => {
    const index = mocks.runs.findIndex((item) => item.runId === run.runId);
    if (index >= 0) {
      mocks.runs[index] = run;
    } else {
      mocks.runs.unshift(run);
    }
    return run;
  };

  return {
    createTaskRun,
    buildTaskRunEvidenceRequirements: () => ({}),
    collectTaskEvidenceForRun: (run: TaskRunRecord) =>
      run.sourceRecords.map((source) => ({
        id: source.id,
        kind: 'source',
        summary: source.url,
        status: 'completed',
        confidence: 0.8,
        capturedAt: source.capturedAt,
        url: source.url,
      })),
    TaskRunRegistry: {
      list: () => mocks.runs,
      upsert: upsertRun,
      setActiveRunId: (runId: string | null) => {
        mocks.activeRunId = runId;
      },
      addEvidence: vi.fn(),
      addCheckpoint: vi.fn(),
      addProgress: (runId: string, item: any) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (run) {
          run.progressItems.push({
            id: `progress-${run.progressItems.length}`,
            title: item.title,
            detail: item.detail,
            status: item.status,
            eventType: item.eventType,
            createdAt: Date.now(),
          });
        }
        return run || null;
      },
      addToolCall: (runId: string, toolCall: any) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (run) {
          run.toolCalls.push({
            id: `tool-${run.toolCalls.length}`,
            startedAt: Date.now(),
            ...toolCall,
          });
        }
        return run || null;
      },
      updateToolCall: (runId: string, callId: string, patch: any) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (run) {
          run.toolCalls = run.toolCalls.map((toolCall) =>
            toolCall.id === callId || toolCall.externalCallId === callId
              ? { ...toolCall, ...patch, completedAt: Date.now() }
              : toolCall,
          );
        }
        return run || null;
      },
      addBrowserActionAudit: vi.fn(),
      updateBrowserActionAudit: vi.fn(),
      recordBrowserTiming: vi.fn(),
      summarizeBrowserPerformance: vi.fn(() => null),
      upsertTodo: vi.fn(),
      addSource: (runId: string, source: any) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (!run) {
          return null;
        }
        const record = {
          id: `source-${run.sourceRecords.length}`,
          url: source.url,
          workerId: source.workerId,
          quality: { score: 70, tier: 'medium', reasons: [] },
          capturedAt: Date.now(),
        };
        run.sourceRecords.push(record as any);
        run.sourcesVisited.push(source.url);
        run.wideResearchWorkers = (run.wideResearchWorkers || []).map((worker) =>
          worker.id === source.workerId
            ? {
                ...worker,
                sourceUrls: [...worker.sourceUrls, source.url],
              }
            : worker,
        );
        return run;
      },
      setWideResearchWorkers: (runId: string, workers: any[]) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (run) {
          run.wideResearchWorkers = workers;
        }
        return run || null;
      },
      updateWideResearchWorker: (runId: string, workerId: string, patch: any) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (run) {
          run.wideResearchWorkers = (run.wideResearchWorkers || []).map((worker) =>
            worker.id === workerId ? { ...worker, ...patch } : worker,
          );
        }
        return run || null;
      },
      addValidationFailure: vi.fn(),
      addArtifact: vi.fn(),
      patch: (runId: string, patch: Partial<TaskRunRecord>) => {
        const run = mocks.runs.find((record) => record.runId === runId);
        if (!run) {
          return null;
        }
        Object.assign(run, patch);
        return run;
      },
    },
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      promises: {
        ...actual.promises,
        readdir: vi.fn(async () => []),
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
      },
    },
  };
});

import { TaskManager } from './task-manager';

describe('TaskManager Wide Research workers', () => {
  beforeEach(() => {
    mocks.runs.length = 0;
    mocks.hermesRun.mockClear();
  });

  it('runs independent worker preflights before final synthesis', async () => {
    const result = await TaskManager.getInstance().startHermesTask(
      'Do wide research on AI app builders',
      { runMode: 'wide_research' },
    );

    expect(result?.status).toBe('completed');
    expect(mocks.hermesRun).toHaveBeenCalledTimes(5);
    expect(
      mocks.hermesRun.mock.calls
        .slice(0, 4)
        .every(([input]) => input.dedicatedBrowserSession === true),
    ).toBe(true);
    expect(
      mocks.hermesRun.mock.calls[4][0].prompt,
    ).toContain('Wide Research worker records');
    expect(result?.wideResearchWorkers?.every((worker) => worker.status === 'completed')).toBe(
      true,
    );
  });

  it('does not mark a task complete while a computer action is still pending', async () => {
    const result = await TaskManager.getInstance().startHermesTask(
      'Do wide research with a pending computer action',
      { runMode: 'wide_research' },
    );

    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('pending computer/tool action');
    expect(result?.completionProof).toBeUndefined();
  });
});
