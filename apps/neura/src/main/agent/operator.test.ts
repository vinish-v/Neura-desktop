import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, desktopCapturer } from 'electron';
import { NutJSElectronOperator } from './operator';

// Mock dependencies
vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: vi.fn(),
  },
  desktopCapturer: {
    getSources: vi.fn(),
  },
  app: {
    on: vi.fn(),
    off: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
  },
}));

vi.mock('@main/env', () => ({
  isMacOS: false,
  isWindows: true,
  isLinux: false,
  vlmProvider: undefined,
  vlmBaseUrl: 'https://integrate.api.nvidia.com/v1',
  vlmApiKey: '',
  vlmModelName: 'meta/llama-3.2-11b-vision-instruct',
  plannerBaseUrl: 'https://integrate.api.nvidia.com/v1',
  plannerApiKey: '',
  plannerModelName: 'nvidia/nemotron-3-nano-30b-a3b',
}));

describe('NutJSElectronOperator', () => {
  let operator: NutJSElectronOperator;

  beforeEach(() => {
    operator = new NutJSElectronOperator();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('screenshot', () => {
    it('should capture screenshot successfully', async () => {
      const mockDisplay = {
        id: '1',
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      };
      const mockSource = {
        display_id: '1',
        thumbnail: {
          toPNG: () => Buffer.from('mock-image'),
          resize: () => ({
            toPNG: () => Buffer.from('mock-image'),
            toJPEG: () => Buffer.from('mock-image'),
          }),
        },
      };

      vi.mocked(screen.getPrimaryDisplay).mockReturnValue(mockDisplay as any);
      vi.mocked(desktopCapturer.getSources).mockResolvedValueOnce([
        mockSource as any,
      ]);

      const result = await operator.screenshot();

      expect(result).toEqual({
        base64: 'bW9jay1pbWFnZQ==',
        scaleFactor: 1,
      });
      expect(desktopCapturer.getSources).toHaveBeenCalledWith({
        types: ['screen'],
        thumbnailSize: {
          width: 1920,
          height: 1080,
        },
      });
    });
  });
});
