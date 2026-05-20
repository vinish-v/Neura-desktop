import { beforeEach, describe, expect, it, vi } from 'vitest';

const embeddedMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  focus: vi.fn(),
  setBounds: vi.fn(),
  setVisible: vi.fn(),
  setInteractionBlocked: vi.fn(),
  setHandlers: vi.fn(),
}));

vi.mock('./embeddedBrowserRuntime', () => ({
  embeddedBrowserRuntime: embeddedMock,
}));

vi.mock('./localDesktopMirror', () => ({
  localDesktopMirror: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

import { store } from '@main/store/create';
import { ComputerRuntimeController } from './computerRuntimeController';

describe('ComputerRuntimeController embedded surface controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.setState({ computerRuntime: null });
  });

  it('starts browser runtimes with a native browser surface', () => {
    ComputerRuntimeController.start({
      mode: 'browser',
      activity: 'Starting browser',
    });

    expect(store.getState().computerRuntime).toMatchObject({
      mode: 'browser',
      surface: 'native_browser',
      subtitle: 'Browser',
    });
  });

  it('forwards measured browser bounds to the embedded runtime', () => {
    ComputerRuntimeController.setSurfaceBounds({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
    ComputerRuntimeController.setSurfaceVisible(true);

    expect(embeddedMock.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
    expect(embeddedMock.setVisible).toHaveBeenCalledWith(true);
  });

  it('tracks live desktop frames and visible interactions', () => {
    ComputerRuntimeController.start({
      mode: 'desktop',
      activity: 'Watching desktop',
    });

    expect(store.getState().computerRuntime?.liveStream).toEqual(
      expect.objectContaining({
        frameCount: 0,
        frameIntervalMs: 125,
      }),
    );

    ComputerRuntimeController.frame({
      dataUrl: 'data:image/jpeg;base64,test',
      width: 1920,
      height: 1080,
      frameIndex: 1,
      cursor: { x: 320, y: 240 },
    });
    ComputerRuntimeController.interaction({
      type: 'click',
      x: 320,
      y: 240,
    });

    expect(store.getState().computerRuntime).toMatchObject({
      latestFrame: expect.objectContaining({
        frameIndex: 1,
        cursor: { x: 320, y: 240 },
      }),
      liveStream: expect.objectContaining({
        frameCount: 1,
      }),
      latestInteraction: expect.objectContaining({
        type: 'click',
        x: 320,
        y: 240,
      }),
    });
  });
});
