import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  Notification: class Notification {
    show() {}
  },
  clipboard: {
    readText: vi.fn(() => ''),
    writeText: vi.fn(),
  },
  desktopCapturer: {
    getSources: vi.fn(),
  },
}));

vi.mock('@neura-desktop/sdk', () => ({
  GUIAgent: class GUIAgent {},
}));

vi.mock('../agent/operator', () => ({
  NutJSElectronOperator: class NutJSElectronOperator {},
}));

vi.mock('../ipcRoutes/agent', () => ({
  GUIAgentManager: {
    getInstance: vi.fn(() => ({
      setAgent: vi.fn(),
    })),
  },
}));

vi.mock('../utils/agent', () => ({
  afterAgentRun: vi.fn(),
  beforeAgentRun: vi.fn(),
  getModelVersion: vi.fn(() => 'test-model-version'),
  getSpByModelVersion: vi.fn(
    () => 'System prompt\n\n## User Instruction\n{{instruction}}',
  ),
}));

vi.mock('./utio', () => ({
  UTIOService: {
    getInstance: vi.fn(() => ({
      sendInstruction: vi.fn(),
    })),
  },
}));

vi.mock('./agentMemory', () => ({
  getAgentMemoryHint: vi.fn(() => ''),
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
    get: vi.fn(() => []),
    getStore: vi.fn(() => ({})),
  },
}));

vi.mock('./approvalGate', () => ({
  requestUserApproval: vi.fn(),
}));

vi.mock('./taskRunRegistry', () => ({
  createRunId: () => 'run_test',
  TaskRunRegistry: {
    addApproval: vi.fn(),
    addArtifact: vi.fn(),
    getActiveRunId: vi.fn(() => null),
    setActiveRunId: vi.fn(),
    upsert: vi.fn((run) => run),
  },
}));

import { Operator, type LocalStore } from '@main/store/types';
import {
  buildDeterministicLocalComputerPlan,
  buildLocalComputerPlan,
} from './localComputerActorRunner';

const settings = {
  operator: Operator.LocalComputer,
  vlmBaseUrl: '',
  vlmApiKey: '',
  vlmModelName: '',
} as LocalStore;

describe('local computer actor planner', () => {
  it('builds a process-worker plan for explicit version checks', () => {
    expect(
      buildDeterministicLocalComputerPlan('check python version'),
    ).toMatchObject({
      canHandle: true,
      steps: [
        {
          actor: 'process_worker',
          tool: 'run_command',
          inputs: { command: 'python --version' },
        },
      ],
    });
  });

  it('uses a native Windows-safe command for date and time checks', () => {
    expect(
      buildDeterministicLocalComputerPlan(
        'run shell command to check the time and date',
      ),
    ).toMatchObject({
      canHandle: true,
      steps: [
        {
          actor: 'process_worker',
          tool: 'run_command',
          inputs: { command: "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'" },
        },
      ],
    });
  });

  it('builds a file-worker plan for named Desktop folders', () => {
    expect(
      buildDeterministicLocalComputerPlan(
        'create a folder called "Client Notes" on desktop',
      ),
    ).toMatchObject({
      canHandle: true,
      steps: [
        {
          actor: 'file_worker',
          tool: 'create_folder',
          inputs: { path: '~/Desktop/Client Notes' },
        },
      ],
    });
  });

  it('builds a visual-worker plan for desktop app tasks', async () => {
    const plan = await buildLocalComputerPlan(
      'open notepad and type hello',
      settings,
    );

    expect(plan).toMatchObject({
      canHandle: true,
      steps: [
        {
          actor: 'process_worker',
          tool: 'run_command',
          purpose: 'Open or focus notepad before visual interaction.',
        },
        {
          actor: 'visual_worker',
          tool: 'gui_agent',
          inputs: {
            content: expect.stringContaining('The requested app is "notepad".'),
          },
        },
      ],
    });
    expect(plan.steps[0].inputs.command).toContain('Sort-Object -Property');
    expect(plan.steps[0].inputs.command).not.toContain(
      'Sort-Object Score -Descending,',
    );
  });

  it('builds a generic launch-then-visual plan for messaging app tasks', async () => {
    await expect(
      buildLocalComputerPlan(
        'send hello there to Alex on ChatClient',
        settings,
      ),
    ).resolves.toMatchObject({
      canHandle: true,
      steps: [
        {
          actor: 'process_worker',
          tool: 'run_command',
        },
        {
          actor: 'visual_worker',
          tool: 'gui_agent',
          inputs: {
            content: expect.stringContaining(
              'Use ChatClient to send exactly "hello there" to "Alex".',
            ),
          },
        },
      ],
    });
  });

  it('parses open-app-then-send phrasing as one verified messaging task', async () => {
    await expect(
      buildLocalComputerPlan(
        'open ChatClient and send hello there to Alex',
        settings,
      ),
    ).resolves.toMatchObject({
      canHandle: true,
      steps: [
        {
          actor: 'process_worker',
          tool: 'run_command',
          purpose: 'Open or focus ChatClient before visual interaction.',
        },
        {
          actor: 'visual_worker',
          tool: 'gui_agent',
          inputs: {
            content: expect.stringContaining(
              'Use ChatClient to send exactly "hello there" to "Alex".',
            ),
          },
        },
      ],
    });
  });
});
