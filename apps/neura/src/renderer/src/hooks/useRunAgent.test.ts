import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/hooks/useStore', () => ({
  getState: vi.fn(),
}));

vi.mock('@renderer/api', () => ({
  api: {},
}));

import { buildMessagesForRun } from './useRunAgent';

describe('buildMessagesForRun', () => {
  it('starts a fresh new-task message list when no history is provided', () => {
    const currentMessages = [{ from: 'gpt', value: 'old answer' }] as any[];
    const initialMessages = [{ from: 'human', value: 'new task' }] as any[];

    expect(
      buildMessagesForRun({
        currentMessages,
        initialMessages,
        history: [],
      }),
    ).toEqual(initialMessages);
  });

  it('does not infer continuation from history when starting a run', () => {
    const currentMessages = [{ from: 'gpt', value: 'old answer' }] as any[];
    const initialMessages = [{ from: 'human', value: 'follow up' }] as any[];
    const history = [{ from: 'human', value: 'old task' }] as any[];

    expect(
      buildMessagesForRun({
        currentMessages,
        initialMessages,
        history,
      }),
    ).toEqual(initialMessages);
  });
});
