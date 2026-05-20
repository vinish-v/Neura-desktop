import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(async (input: unknown) => ({
    id: 'bg-deep-link',
    input,
  })),
}));

vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}));

vi.mock('./background-task-service', () => ({
  BackgroundTaskService: {
    getInstance: () => ({
      enqueue: mocks.enqueue,
    }),
  },
}));

import {
  DeepLinkTaskService,
  parseTaskDeepLink,
} from './deep-link-task-service';

describe('deep link task intake', () => {
  beforeEach(() => {
    mocks.enqueue.mockClear();
  });

  it('parses supported Neura task URLs without accepting unrelated schemes', () => {
    expect(
      parseTaskDeepLink('neura://task?goal=Research%20competitors&mode=mcp'),
    ).toEqual({
      goal: 'Research competitors',
      kind: 'mcp_autonomous',
      sourceUrl: 'neura://task?goal=Research%20competitors&mode=mcp',
    });
    expect(parseTaskDeepLink('https://example.com/task?goal=x')).toBeNull();
  });

  it('rejects empty task deep links instead of queuing placeholders', () => {
    expect(() => parseTaskDeepLink('neura://task?goal=')).toThrow(
      'non-empty goal',
    );
  });

  it('rejects oversized task deep links instead of silently truncating context', () => {
    const url = `neura://task?goal=${encodeURIComponent('x'.repeat(8001))}`;

    expect(() => parseTaskDeepLink(url)).toThrow(
      '8000 characters or fewer',
    );
  });

  it('queues deep-link tasks through the background Hermes task path', async () => {
    const service = new DeepLinkTaskService();
    await service.start([]);

    await service.handleUrl('neura://run?goal=Build%20a%20deck');

    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: 'multi_agent',
      goal: 'Build a deck',
      arguments: {
        intake: 'deep_link',
        sourceUrl: 'neura://run?goal=Build%20a%20deck',
      },
    });
  });

  it('holds links received before startup and flushes them once ready', async () => {
    const service = new DeepLinkTaskService();
    await service.handleUrl('neura://task?goal=Summarize%20filings');
    expect(mocks.enqueue).not.toHaveBeenCalled();

    await service.start([]);

    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Summarize filings',
      }),
    );
  });
});
