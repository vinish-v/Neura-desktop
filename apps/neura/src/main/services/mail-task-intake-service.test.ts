import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailTaskIntakeSettings } from '@main/store/types';

const mocks = vi.hoisted(() => ({
  settings: {
    enabled: false,
    connectorId: 'gmail',
    subjectPrefix: '[Neura Task]',
    maxResults: 10,
    processedMessageIds: [],
  } as MailTaskIntakeSettings,
  callTool: vi.fn(),
  getHealth: vi.fn(),
  enqueue: vi.fn(async (input: any) => ({
    id: 'bg-1',
    ...input,
    status: 'queued',
    createdAt: Date.now(),
  })),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: (key: string) => (key === 'mailTaskIntake' ? mocks.settings : undefined),
    set: (key: string, value: MailTaskIntakeSettings) => {
      if (key === 'mailTaskIntake') {
        mocks.settings = value;
      }
    },
  },
}));

vi.mock('./connectors-service', () => ({
  ConnectorsService: {
    getInstance: () => ({
      callTool: mocks.callTool,
      getHealth: mocks.getHealth,
    }),
  },
}));

vi.mock('./background-task-service', () => ({
  BackgroundTaskService: {
    getInstance: () => ({
      enqueue: mocks.enqueue,
    }),
  },
}));

import { MailTaskIntakeService } from './mail-task-intake-service';

describe('MailTaskIntakeService', () => {
  beforeEach(() => {
    mocks.settings = {
      enabled: false,
      connectorId: 'gmail',
      subjectPrefix: '[Neura Task]',
      maxResults: 10,
      processedMessageIds: [],
    };
    mocks.callTool.mockReset();
    mocks.getHealth.mockReset();
    mocks.enqueue.mockClear();
  });

  it('stays disabled by default and does not read Gmail', async () => {
    const result = await new MailTaskIntakeService().runOnce();

    expect(result.message).toContain('disabled');
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('queues only explicit prefixed unread Gmail subjects and dedupes message ids', async () => {
    mocks.settings = {
      ...mocks.settings,
      enabled: true,
      processedMessageIds: ['old-message'],
    };
    mocks.getHealth.mockResolvedValue([
      {
        connectorId: 'gmail',
        setupGap: undefined,
      },
    ]);
    mocks.callTool.mockResolvedValue({
      content: [
        {
          type: 'json',
          json: {
            messages: [
              {
                id: 'new-message',
                payload: {
                  headers: [
                    { name: 'Subject', value: '[Neura Task] Research invoices' },
                    { name: 'From', value: 'ops@example.com' },
                    { name: 'Date', value: 'Mon, 18 May 2026 10:00:00 GMT' },
                  ],
                },
              },
              {
                id: 'old-message',
                payload: {
                  headers: [
                    { name: 'Subject', value: '[Neura Task] Duplicate' },
                  ],
                },
              },
              {
                id: 'ignored-message',
                payload: {
                  headers: [{ name: 'Subject', value: 'Hello Neura' }],
                },
              },
            ],
          },
        },
      ],
    });

    const result = await new MailTaskIntakeService().runOnce();

    expect(result).toEqual(
      expect.objectContaining({
        queued: 1,
        skipped: 2,
      }),
    );
    expect(mocks.callTool).toHaveBeenCalledWith({
      connectorId: 'gmail',
      name: 'gmail_list_unread',
      arguments: { maxResults: 10 },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: 'multi_agent',
      goal: 'Research invoices',
      arguments: expect.objectContaining({
        intake: 'gmail_subject',
        gmailMessageId: 'new-message',
        from: 'ops@example.com',
      }),
    });
    expect(mocks.settings.processedMessageIds).toEqual(
      expect.arrayContaining(['old-message', 'new-message']),
    );
  });

  it('surfaces Gmail connector setup gaps instead of pretending intake is active', async () => {
    mocks.settings = {
      ...mocks.settings,
      enabled: true,
    };
    mocks.getHealth.mockResolvedValue([
      {
        connectorId: 'gmail',
        setupGap: 'Gmail has no stored credential.',
      },
    ]);

    const result = await new MailTaskIntakeService().runOnce();

    expect(result.message).toBe('Gmail has no stored credential.');
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('reports ready when enabled Gmail health has no setup gap', async () => {
    mocks.settings = {
      ...mocks.settings,
      enabled: true,
    };
    mocks.getHealth.mockResolvedValue([
      {
        connectorId: 'gmail',
        setupGap: undefined,
      },
    ]);

    const status = await new MailTaskIntakeService().getStatus();

    expect(status.ready).toBe(true);
    expect(status.setupGap).toBeUndefined();
  });
});
