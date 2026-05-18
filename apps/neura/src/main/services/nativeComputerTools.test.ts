import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('native multimodal provider readiness tools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reports multimodal readiness without exposing API keys or making provider calls', async () => {
    mocks.settingGet.mockReturnValue({
      image: {
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'secret-image-key',
        model: 'image-model',
      },
      textToSpeech: {
        baseUrl: 'https://audio.example.test/v1',
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNativeComputerTool(
      'check_multimodal_readiness',
      {} as never,
    );

    expect(result.status).toBe(StatusEnum.END);
    expect(result.message).toContain('Image generation: ready');
    expect(result.message).toContain('Text to speech: needs setup');
    expect(result.message).not.toContain('secret-image-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks media generation before file writes or provider calls when setup is missing', async () => {
    mocks.settingGet.mockReturnValue({});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeNativeComputerTool('generate_image', {
      path: 'image.png',
      prompt: 'A product mockup',
    } as never);

    expect(result.status).toBe(StatusEnum.ERROR);
    expect(result.message).toContain('Settings > Multimodal');
    expect(result.message).toContain(
      'Neura will not claim a media artifact was created',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.requestUserApproval).not.toHaveBeenCalled();
  });
});

describe('native local file tools', () => {
  const originalEnv = { ...process.env };
  let tempRoot = '';

  beforeEach(async () => {
    vi.resetAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-native-tools-'));
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates inferred Desktop folders on the OneDrive Desktop when that is the active Windows Desktop', async () => {
    const oneDriveRoot = path.join(tempRoot, 'OneDrive');
    const desktopPath = path.join(oneDriveRoot, 'Desktop');
    await fs.mkdir(desktopPath, { recursive: true });
    process.env.OneDrive = oneDriveRoot;
    process.env.OneDriveConsumer = '';
    process.env.OneDriveCommercial = '';
    process.env.USERPROFILE = path.join(tempRoot, 'UserProfile');

    const result = await executeNativeComputerTool('create_folder', {
      content: 'create a folder on desktop named hom',
    } as never);

    const createdPath = path.join(desktopPath, 'hom');
    await expect(fs.stat(createdPath)).resolves.toEqual(
      expect.objectContaining({}),
    );
    expect(result.status).toBe(StatusEnum.END);
    expect(result.message).toBe(
      `Created folder on OneDrive Desktop: ${createdPath}`,
    );
  });

  it('reports created files with a clear Desktop label for explicit Desktop paths', async () => {
    const oneDriveRoot = path.join(tempRoot, 'OneDrive');
    const desktopPath = path.join(oneDriveRoot, 'Desktop');
    await fs.mkdir(desktopPath, { recursive: true });
    process.env.OneDrive = oneDriveRoot;
    process.env.OneDriveConsumer = '';
    process.env.OneDriveCommercial = '';
    process.env.USERPROFILE = path.join(tempRoot, 'UserProfile');
    const filePath = path.join(desktopPath, 'note.txt');

    const result = await executeNativeComputerTool('write_file', {
      path: filePath,
      content: 'hello',
    } as never);

    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('hello');
    expect(result.status).toBe(StatusEnum.END);
    expect(result.message).toBe(
      `Created file on OneDrive Desktop: ${filePath}`,
    );
  });
});
