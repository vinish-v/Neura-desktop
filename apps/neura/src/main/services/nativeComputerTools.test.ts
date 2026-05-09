import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestUserApproval: vi.fn(),
  settingGet: vi.fn(),
}));

vi.mock('electron', () => ({
  Notification: class Notification {
    show() {}
  },
}));

vi.mock('@main/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    get: mocks.settingGet,
  },
}));

vi.mock('./approvalGate', () => ({
  requestUserApproval: mocks.requestUserApproval,
}));

vi.mock('./taskRunRegistry', () => ({
  createRunId: () => 'run_test',
  TaskRunRegistry: {
    addApproval: vi.fn(),
    addArtifact: vi.fn(),
    getActiveRunId: vi.fn(() => null),
  },
}));

import { StatusEnum } from '@neura-desktop/shared/types';
import { executeNativeComputerTool } from './nativeComputerTools';

describe('native GitHub connector tools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('refuses GitHub actions when the connector is disabled', async () => {
    mocks.settingGet.mockReturnValue([
      {
        id: 'github',
        enabled: false,
      },
    ]);

    const result = await executeNativeComputerTool('connector_github_issue', {
      repository: 'owner/repo',
      title: 'Test issue',
    } as never);

    expect(result.status).toBe(StatusEnum.ERROR);
    expect(result.message).toContain('GitHub connector is disabled');
    expect(mocks.requestUserApproval).not.toHaveBeenCalled();
  });

  it('creates an issue through the GitHub API after approval', async () => {
    mocks.settingGet.mockReturnValue([
      {
        id: 'github',
        enabled: true,
        config: {
          token: 'ghp_test',
          apiBase: 'https://api.github.test',
        },
      },
    ]);
    mocks.requestUserApproval.mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ number: 7, html_url: 'issue-url' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNativeComputerTool('connector_github_issue', {
      repository: 'owner/repo',
      title: 'Test issue',
      message: 'Body',
    } as never);

    expect(result.status).toBe(StatusEnum.END);
    expect(result.message).toContain('Created GitHub issue #7');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.test/repos/owner/repo/issues',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Test issue', body: 'Body' }),
      }),
    );
  });
});
