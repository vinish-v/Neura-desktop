import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyHermesTaskWithArbitration } from './intentArbitration';

const settings = {
  hermesBrowserBackend: 'local',
  usePlannerModel: true,
  plannerBaseUrl: 'https://planner.example.test/v1',
  plannerApiKey: 'planner-key',
  plannerModelName: 'planner-model',
  plannerTimeoutInMs: 15_000,
} as any;

const plannerResponse = (content: Record<string, unknown>) => ({
  ok: true,
  text: async () =>
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(content),
          },
        },
      ],
    }),
});

describe('classifyHermesTaskWithArbitration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces planner setup gaps without calling a model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const route = await classifyHermesTaskWithArbitration(
      'summarize this topic',
      {
        ...settings,
        plannerApiKey: '',
        vlmApiKey: '',
      },
    );

    expect(route.intentArbitration).toEqual(
      expect.objectContaining({
        status: 'not_configured',
        usedModel: false,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts safe upgrades that add tools, approval, and proof requirements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        plannerResponse({
          taskType: 'automation',
          requiredTools: ['scheduler', 'browser'],
          expectedArtifacts: ['citation_records'],
          riskLevel: 'medium',
          needsApproval: true,
          verificationRequired: true,
          completionProof: 'sources',
          reason: 'User wants recurring sourced work.',
        }),
      ),
    );

    const route = await classifyHermesTaskWithArbitration(
      'hello',
      settings,
    );

    expect(route.intentArbitration).toEqual(
      expect.objectContaining({
        status: 'accepted',
        proposedTaskType: 'automation',
      }),
    );
    expect(route.taskMode).toBe('scheduled_job');
    expect(route.semanticContract.requiredTools).toEqual(
      expect.arrayContaining(['scheduler', 'browser']),
    );
    expect(route.semanticContract.needsApproval).toBe(true);
    expect(route.semanticContract.completionProof).toBe('sources');
  });

  it('rejects unsafe downgrades from source-backed browser work', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        plannerResponse({
          taskType: 'answer',
          requiredTools: [],
          riskLevel: 'low',
          needsApproval: false,
          verificationRequired: false,
          completionProof: 'none',
          reason: 'Can answer from memory.',
        }),
      ),
    );

    const route = await classifyHermesTaskWithArbitration(
      'what is the latest price of Bitcoin today',
      settings,
    );

    expect(route.intentArbitration).toEqual(
      expect.objectContaining({
        status: 'rejected',
        proposedTaskType: 'answer',
      }),
    );
    expect(route.requiresSource).toBe(true);
    expect(route.semanticContract.completionProof).toBe('sources');
    expect(route.semanticContract.requiredTools).toContain('browser');
  });
});
