import { windowRoute } from './window';
import { showWindow } from '@main/window';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

// Mock window module
vi.mock('@main/window', () => ({
  showWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
  shell: {
    openPath: mocks.openPath,
    showItemInFolder: mocks.showItemInFolder,
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: mocks.stat,
    readFile: mocks.readFile,
    readdir: mocks.readdir,
  },
}));

describe('windowRoute.showMainWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call showWindow function', async () => {
    await windowRoute.showMainWindow.handle({
      input: undefined,
      context: {} as any,
    });

    expect(showWindow).toHaveBeenCalled();
    expect(showWindow).toHaveBeenCalledTimes(1);
  });

  it('should handle showWindow being called multiple times', async () => {
    await windowRoute.showMainWindow.handle({
      input: undefined,
      context: {} as any,
    });
    await windowRoute.showMainWindow.handle({
      input: undefined,
      context: {} as any,
    });
    await windowRoute.showMainWindow.handle({
      input: undefined,
      context: {} as any,
    });

    expect(showWindow).toHaveBeenCalledTimes(3);
  });

  it('should handle errors from showWindow', async () => {
    (showWindow as any).mockImplementationOnce(() => {
      throw new Error('Failed to show window');
    });

    await expect(
      windowRoute.showMainWindow.handle({
        input: undefined,
        context: {} as any,
      }),
    ).rejects.toThrow('Failed to show window');
  });
});

describe('windowRoute.readArtifactPreview', () => {
  it('returns text preview for markdown files', async () => {
    mocks.stat.mockResolvedValue({ size: 120 });
    mocks.readFile.mockResolvedValue('# Report');

    const result = await windowRoute.readArtifactPreview.handle({
      input: { path: 'D:\\tmp\\note.md' },
      context: {} as any,
    });

    expect(result).toEqual({
      kind: 'text',
      readable: true,
      text: '# Report',
      mimeType: 'text/markdown',
      reason: '',
    });
  });

  it('returns binary preview for image files', async () => {
    mocks.stat.mockResolvedValue({ size: 512 });
    mocks.readFile.mockResolvedValue(Buffer.from('png-binary'));

    const result = await windowRoute.readArtifactPreview.handle({
      input: { path: 'D:\\tmp\\image.png' },
      context: {} as any,
    });

    expect(result.kind).toBe('binary');
    expect(result.readable).toBe(true);
    if (result.kind === 'binary') {
      expect(result.mimeType).toBe('image/png');
      expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('returns unsupported for unknown extension', async () => {
    const result = await windowRoute.readArtifactPreview.handle({
      input: { path: 'D:\\tmp\\archive.bin' },
      context: {} as any,
    });

    expect(result).toEqual({
      kind: 'unsupported',
      readable: false,
      reason: 'Preview is not available for .bin.',
    });
  });
});

describe('windowRoute.listWorkspaceEntries', () => {
  it('lists deduped directory entries with file metadata', async () => {
    mocks.stat.mockImplementation(async (inputPath: string) => {
      if (inputPath === 'D:\\runs\\r1\\artifact.md') {
        return {
          isDirectory: () => false,
          size: 64,
          mtimeMs: 100,
        };
      }
      if (inputPath === 'D:\\runs\\r1') {
        return {
          isDirectory: () => true,
          size: 0,
          mtimeMs: 200,
        };
      }
      if (inputPath === 'D:\\runs\\r1\\output.txt') {
        return {
          isDirectory: () => false,
          size: 256,
          mtimeMs: 300,
        };
      }
      if (inputPath === 'D:\\runs\\r1\\images') {
        return {
          isDirectory: () => true,
          size: 0,
          mtimeMs: 400,
        };
      }
      throw new Error(`Unexpected stat path: ${inputPath}`);
    });

    mocks.readdir.mockResolvedValue([
      { name: 'output.txt', isDirectory: () => false },
      { name: 'images', isDirectory: () => true },
    ]);

    const result = await windowRoute.listWorkspaceEntries.handle({
      input: { paths: ['D:\\runs\\r1\\artifact.md', 'D:\\runs\\r1\\artifact.md'] },
      context: {} as any,
    });

    expect(result).toHaveLength(1);
    expect(result[0].rootPath).toBe('D:\\runs\\r1');
    expect(result[0].entries).toEqual([
      {
        path: 'D:\\runs\\r1\\images',
        name: 'images',
        type: 'directory',
        sizeBytes: 0,
        modifiedAt: 400,
      },
      {
        path: 'D:\\runs\\r1\\output.txt',
        name: 'output.txt',
        type: 'file',
        sizeBytes: 256,
        modifiedAt: 300,
      },
    ]);
  });
});
