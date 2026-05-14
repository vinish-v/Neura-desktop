/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
const getStore = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((config) => ({
    config,
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

vi.mock('@main/store/setting', () => ({
  SettingStore: {
    getStore,
  },
}));

const project = {
  id: 'canvas_ai',
  title: 'AI Canvas',
  rootPath: 'C:/Neura-Projects/ai',
  entryFile: 'src/App.tsx',
  files: [
    {
      path: 'src/App.tsx',
      language: 'typescript',
      content: 'export default function App() { return <main />; }',
      updatedAt: 1,
    },
  ],
  versions: [],
  composerPlans: [],
  terminalRuns: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('CanvasAiCoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStore.mockReturnValue({
      vlmBaseUrl: 'https://integrate.api.nvidia.com/v1',
      vlmApiKey: 'nim-key',
      vlmModelName: 'fallback-model',
      usePlannerModel: true,
      plannerBaseUrl: 'https://integrate.api.nvidia.com/v1',
      plannerApiKey: '',
      plannerModelName: 'nvidia/nemotron-3-nano-30b-a3b',
      plannerTimeoutInMs: 90_000,
      modelTimeoutInMs: 240_000,
    });
  });

  it('uses configured NVIDIA NIM settings for plan generation', async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              '{"summary":"Build the app","steps":[{"title":"Edit UI","detail":"Update App","kind":"edit","filePaths":["src/App.tsx"]}]}',
          },
        },
      ],
    });
    const { CanvasAiCoder } = await import('./canvas-ai-coder');

    const plan = await CanvasAiCoder.generatePlan(project, 'build a dashboard');

    expect(plan.steps[0].filePaths).toEqual(['src/App.tsx']);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'nvidia/nemotron-3-nano-30b-a3b',
      }),
      { timeout: 90_000 },
    );
  });

  it('answers in read-only Ask mode with referenced files', async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              '{"summary":"App renders an empty main element.","referencedFiles":["src/App.tsx"],"followUps":["Ask for edits in Agent mode."]}',
          },
        },
      ],
    });
    const { CanvasAiCoder } = await import('./canvas-ai-coder');

    const answer = await CanvasAiCoder.answer(project, 'what does this do?');

    expect(answer.referencedFiles).toEqual(['src/App.tsx']);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Do not propose file edits'),
          }),
        ]),
      }),
      { timeout: 90_000 },
    );
  });

  it('reports NIM coding configuration without exposing the key', async () => {
    const { CanvasAiCoder } = await import('./canvas-ai-coder');

    const status = CanvasAiCoder.getConfigStatus();

    expect(status).toEqual({
      configured: true,
      baseURL: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3-nano-30b-a3b',
    });
    expect(JSON.stringify(status)).not.toContain('nim-key');
  });

  it('fails clearly when the NIM key is missing', async () => {
    getStore.mockReturnValueOnce({
      vlmBaseUrl: 'https://integrate.api.nvidia.com/v1',
      vlmApiKey: '',
      vlmModelName: 'fallback-model',
      usePlannerModel: true,
      plannerBaseUrl: 'https://integrate.api.nvidia.com/v1',
      plannerApiKey: '',
      plannerModelName: 'nvidia/nemotron-3-nano-30b-a3b',
    });
    const { CanvasAiCoder } = await import('./canvas-ai-coder');

    await expect(CanvasAiCoder.generateEdits(project, 'build')).rejects.toThrow(
      'NVIDIA NIM coding model is not configured',
    );
  });
});
