import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BackgroundTaskRecord,
  LocalTaskApiSettings,
  TaskRunRecord,
} from '@main/store/types';

const mocks = vi.hoisted(() => ({
  localTaskApi: {
    enabled: false,
    port: 47837,
  } as LocalTaskApiSettings,
  backgroundTasks: [] as BackgroundTaskRecord[],
  taskRuns: [] as TaskRunRecord[],
  enqueue: vi.fn(async (input: any) => {
    const task = {
      id: `bg-${mocks.backgroundTasks.length + 1}`,
      kind: input.kind,
      goal: input.goal,
      status: 'queued',
      arguments: input.arguments,
      createdAt: Date.now(),
    } as BackgroundTaskRecord;
    mocks.backgroundTasks = [task, ...mocks.backgroundTasks];
    return task;
  }),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: (key: string) =>
      key === 'localTaskApi' ? mocks.localTaskApi : undefined,
    set: (key: string, value: LocalTaskApiSettings) => {
      if (key === 'localTaskApi') {
        mocks.localTaskApi = value;
      }
    },
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('./background-task-service', () => ({
  BackgroundTaskService: {
    getInstance: () => ({
      enqueue: mocks.enqueue,
      list: () => mocks.backgroundTasks,
    }),
  },
}));

vi.mock('./taskRunRegistry', () => ({
  TaskRunRegistry: {
    list: () => mocks.taskRuns,
  },
}));

import { LocalTaskApiService } from './local-task-api-service';

describe('LocalTaskApiService', () => {
  beforeEach(() => {
    mocks.localTaskApi = {
      enabled: false,
      port: 47837,
    };
    mocks.backgroundTasks = [];
    mocks.taskRuns = [];
    mocks.enqueue.mockClear();
  });

  it('stays disabled by default and stores only token hash when enabled', async () => {
    const service = new LocalTaskApiService();
    expect(await service.status()).toEqual(
      expect.objectContaining({
        enabled: false,
        listening: false,
        tokenPresent: false,
      }),
    );

    const enabled = await service.enable(0);
    expect(enabled.token).toMatch(/^neura_/u);
    expect(mocks.localTaskApi.tokenHash).toBeTruthy();
    expect(mocks.localTaskApi.tokenHash).not.toBe(enabled.token);
    await service.stop();
  });

  it('does not start with an unknown generated token when enabled settings are corrupt', async () => {
    mocks.localTaskApi = {
      enabled: true,
      port: 47837,
    };
    const service = new LocalTaskApiService();

    const status = await service.start();

    expect(status).toEqual(
      expect.objectContaining({
        enabled: true,
        listening: false,
        tokenPresent: false,
        setupGap: expect.stringContaining('has no usable bearer token'),
      }),
    );
    expect(mocks.localTaskApi.tokenHash).toBeUndefined();
    await service.stop();
  });

  it('reports a setup gap instead of throwing when the configured port is unavailable', async () => {
    const first = new LocalTaskApiService();
    await first.enable(0);
    const occupiedPort = (await first.status()).port;
    mocks.localTaskApi = {
      enabled: true,
      port: occupiedPort,
      tokenHash: 'configured-token-hash',
    };
    const second = new LocalTaskApiService();

    const status = await second.start();

    expect(status).toEqual(
      expect.objectContaining({
        enabled: true,
        listening: false,
        setupGap: expect.stringContaining('could not listen'),
      }),
    );
    await second.stop();
    await first.stop();
  });

  it('requires bearer auth and queues tasks through the real background path', async () => {
    const service = new LocalTaskApiService();
    const enabled = await service.enable(0);
    const baseUrl = (await service.status()).baseUrl;

    const denied = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Research invoices' }),
    });
    expect(denied.status).toBe(401);

    const accepted = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enabled.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        goal: 'Research invoices',
        kind: 'mcp_autonomous',
      }),
    });
    expect(accepted.status).toBe(202);
    const body = await accepted.json();
    expect(body.task).toEqual(
      expect.objectContaining({
        goal: 'Research invoices',
        kind: 'mcp_autonomous',
      }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: 'mcp_autonomous',
      goal: 'Research invoices',
      arguments: {
        intake: 'local_task_api',
      },
    });
    await service.stop();
  });

  it('returns task status and rejects empty goals', async () => {
    const service = new LocalTaskApiService();
    const enabled = await service.enable(0);
    const baseUrl = (await service.status()).baseUrl;

    const invalid = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enabled.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ goal: '' }),
    });
    expect(invalid.status).toBe(400);

    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enabled.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ goal: 'Build a report' }),
    });
    const taskId = mocks.backgroundTasks[0].id;
    const status = await fetch(`${baseUrl}/tasks/${taskId}`, {
      headers: {
        authorization: `Bearer ${enabled.token}`,
      },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      task: expect.objectContaining({
        id: taskId,
      }),
    });
    await service.stop();
  });
});
