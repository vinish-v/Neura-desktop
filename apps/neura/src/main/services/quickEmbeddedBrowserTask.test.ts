import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const runtimeMock = vi.hoisted(() => ({
  ensure: vi.fn(),
  navigate: vi.fn(),
  setInteractionBlocked: vi.fn(),
  executeJavaScript: vi.fn(),
  webContents: {
    getURL: vi.fn(),
  },
}));

const runtimeControllerMock = vi.hoisted(() => ({
  start: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));

const orchestratorMock = vi.hoisted(() => ({
  begin: vi.fn(),
  emit: vi.fn(),
  addSource: vi.fn(),
  setCompletionProof: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));

vi.mock('./embeddedBrowserRuntime', () => ({
  embeddedBrowserRuntime: runtimeMock,
}));

vi.mock('./computerRuntimeController', () => ({
  ComputerRuntimeController: runtimeControllerMock,
}));

vi.mock('./agentOrchestrator', () => ({
  AgentOrchestrator: vi.fn(() => orchestratorMock),
}));

import { StatusEnum } from '@neura-desktop/shared/types';

import {
  classifyQuickBrowserTask,
  runQuickEmbeddedBrowserTask,
} from './quickEmbeddedBrowserTask';

describe('quickEmbeddedBrowserTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMock.webContents.getURL.mockReturnValue('https://www.youtube.com/results');
  });

  it('routes common browser tasks to the embedded browser quick path', () => {
    expect(classifyQuickBrowserTask('open youtube and play a song')).toBe(
      'youtube',
    );
    expect(classifyQuickBrowserTask('give me the latest tamil nadu news')).toBe(
      null,
    );
    expect(classifyQuickBrowserTask('search about india')).toBe('search');
    expect(classifyQuickBrowserTask('open example.com')).toBe('open');
  });

  it('opens YouTube search results and clicks a playable video link', async () => {
    runtimeMock.navigate.mockResolvedValue(undefined);
    runtimeMock.setInteractionBlocked.mockResolvedValue(undefined);
    runtimeMock.executeJavaScript
      .mockResolvedValueOnce('complete')
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce({
        ok: true,
        title: 'A playable song',
        href: 'https://www.youtube.com/watch?v=abc',
      })
      .mockResolvedValueOnce('A playable song - YouTube');

    const setState = vi.fn();
    const getState = vi.fn(() => ({ status: StatusEnum.RUNNING }) as any);

    await expect(
      runQuickEmbeddedBrowserTask({
        instructions: 'open youtube and play a song',
        setState,
        getState,
      }),
    ).resolves.toBe(true);

    expect(runtimeMock.navigate).toHaveBeenCalledWith(
      'https://www.youtube.com/results?search_query=popular%20music%20video',
    );
    expect(orchestratorMock.complete).toHaveBeenCalledWith(
      expect.stringContaining('A playable song'),
    );
    expect(runtimeControllerMock.complete).toHaveBeenCalled();
  });
});
