import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const runtimeMock = vi.hoisted(() => ({
  ensure: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  executeJavaScript: vi.fn(),
  capturePage: vi.fn(),
  sendInputEvent: vi.fn(),
  publishBrowserState: vi.fn(),
  withInteractionUnblocked: vi.fn(async (operation: () => unknown) => operation()),
  webContents: {
    insertText: vi.fn(),
  },
}));

vi.mock('./embeddedBrowserRuntime', () => ({
  BROWSER_INPUT_BLOCKER_ID: 'neura-browser-input-blocker',
  embeddedBrowserRuntime: runtimeMock,
}));

import { ElectronBrowserOperator } from './electronBrowserOperator';

const executeParams = (action_type: string, action_inputs = {}) => ({
  prediction: '',
  parsedPrediction: {
    reflection: null,
    thought: '',
    action_type,
    action_inputs,
  },
  screenWidth: 1000,
  screenHeight: 1000,
  scaleFactor: 1,
  factors: [1, 1] as [number, number],
});

describe('ElectronBrowserOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMock.capturePage.mockResolvedValue({
      base64: 'image-data',
      width: 800,
      height: 600,
      mime: 'image/jpeg',
    });
    runtimeMock.executeJavaScript.mockResolvedValue('URL: about:blank');
  });

  it('captures the embedded browser page and DOM map', async () => {
    const operator = new ElectronBrowserOperator();
    runtimeMock.executeJavaScript
      .mockResolvedValueOnce('URL: https://example.com\nELEMENTS:')
      .mockResolvedValueOnce(1);

    await expect(operator.screenshot()).resolves.toMatchObject({
      base64: 'image-data',
      scaleFactor: 1,
      domText: 'URL: https://example.com\nELEMENTS:',
    });
    expect(runtimeMock.capturePage).toHaveBeenCalled();
  });

  it('executes DOM-first click_element actions', async () => {
    const operator = new ElectronBrowserOperator();
    runtimeMock.executeJavaScript.mockResolvedValueOnce({
      ok: true,
      text: 'Open result',
    });

    await expect(
      operator.execute(executeParams('click_element', { element_id: '3' })),
    ).resolves.toMatchObject({ message: 'Open result' });
    expect(runtimeMock.publishBrowserState).toHaveBeenCalled();
  });

  it('returns internal recovery feedback for stale DOM click_element actions', async () => {
    const operator = new ElectronBrowserOperator();
    runtimeMock.executeJavaScript.mockResolvedValueOnce({
      ok: false,
      reason: 'Element is not visible on the current page.',
    });

    const output = await operator.execute(
      executeParams('click_element', { element_id: 'e3' }),
    );

    expect(output.message).toContain(
      'Previous browser DOM action could not be executed',
    );
    expect(output.message).not.toContain('Could not click that DOM element');
    expect(runtimeMock.executeJavaScript.mock.calls[0][0]).toContain(
      'normalizedElementId',
    );
    expect(runtimeMock.executeJavaScript.mock.calls[0][0]).toContain(
      'neura-browser-input-blocker',
    );
  });

  it('focuses DOM elements before typing into them', async () => {
    const operator = new ElectronBrowserOperator();
    runtimeMock.executeJavaScript.mockResolvedValueOnce({ ok: true });

    await operator.execute(
      executeParams('type_element', {
        element_id: '7',
        content: 'hello\\n',
      }),
    );

    expect(runtimeMock.webContents.insertText).toHaveBeenCalledWith('hello');
    expect(runtimeMock.sendInputEvent).toHaveBeenCalledWith({
      type: 'keyDown',
      keyCode: 'Enter',
    });
  });
});
