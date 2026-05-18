import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledTaskRecord } from '@main/store/types';

const mocks = vi.hoisted(() => ({
  scheduledTasks: [] as ScheduledTaskRecord[],
  settingGet: vi.fn((key: string) =>
    key === 'scheduledTasks' ? mocks.scheduledTasks : undefined,
  ),
  settingSet: vi.fn((key: string, value: ScheduledTaskRecord[]) => {
    if (key === 'scheduledTasks') {
      mocks.scheduledTasks = value;
    }
  }),
  enqueue: vi.fn(async () => ({ id: 'bg-1', status: 'queued' })),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: mocks.settingGet,
    set: mocks.settingSet,
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('./background-task-service', () => ({
  BackgroundTaskService: {
    getInstance: () => ({
      enqueue: mocks.enqueue,
    }),
  },
}));

import { ScheduledTaskService } from './scheduled-task-service';

describe('ScheduledTaskService', () => {
  beforeEach(() => {
    mocks.scheduledTasks = [];
    mocks.settingGet.mockClear();
    mocks.settingSet.mockClear();
    mocks.enqueue.mockClear();
  });

  it('persists create, update, pause, resume, and delete operations', () => {
    const service = new ScheduledTaskService();
    const created = service.create({
      name: 'Morning research',
      goal: 'Research the market',
      intervalMinutes: 15,
    });

    expect(created.status).toBe('active');
    expect(mocks.scheduledTasks).toHaveLength(1);

    const updated = service.update(created.id, {
      name: 'Daily research',
      intervalMinutes: 30,
    });
    expect(updated.name).toBe('Daily research');
    expect(updated.intervalMinutes).toBe(30);

    expect(service.pause(created.id).status).toBe('paused');
    expect(service.resume(created.id).status).toBe('active');
    expect(service.delete(created.id)).toEqual({ id: created.id, deleted: true });
    expect(service.list()).toHaveLength(0);
  });

  it('queues due scheduled tasks through the real background task service', async () => {
    const service = new ScheduledTaskService();
    const created = service.create({
      name: 'Due task',
      goal: 'Run due task',
      intervalMinutes: 1,
    });
    mocks.scheduledTasks = [
      {
        ...created,
        nextRunAt: Date.now() - 1,
      },
    ];

    await service.tickDueTasks(Date.now());

    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: 'multi_agent',
      goal: 'Run due task',
    });
    expect(mocks.scheduledTasks[0].history[0]).toEqual(
      expect.objectContaining({
        status: 'queued',
        message: 'Queued by local scheduler.',
      }),
    );
  });

  it('records independent run-now history without pausing the schedule', async () => {
    const service = new ScheduledTaskService();
    const created = service.create({
      name: 'Manual task',
      goal: 'Run manually',
      intervalMinutes: 5,
    });

    const updated = await service.runNow(created.id);

    expect(updated.status).toBe('active');
    expect(updated.history[0]).toEqual(
      expect.objectContaining({
        status: 'queued',
        message: 'Manually queued from scheduler.',
      }),
    );
  });
});
