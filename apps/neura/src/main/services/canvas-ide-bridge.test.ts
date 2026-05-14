/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const project = {
  id: 'canvas_test',
  title: 'Test Canvas',
  rootPath: 'C:/Neura-Projects/test',
  entryFile: 'index.html',
  files: [
    {
      path: 'index.html',
      language: 'html',
      content: '<main>test</main>',
      updatedAt: 1,
    },
  ],
  versions: [],
  composerPlans: [],
  terminalRuns: [],
  createdAt: 1,
  updatedAt: 1,
};

const service = {
  getProject: vi.fn(async () => project),
  refreshProjectFiles: vi.fn(async () => project),
  createComposerPlan: vi.fn(async () => ({
    project,
    plan: {
      id: 'composer_1',
      prompt: 'change it',
      status: 'draft',
      steps: [],
      createdAt: 1,
      updatedAt: 1,
    },
  })),
  approveComposerPlan: vi.fn(),
  rejectComposerPlan: vi.fn(),
  updateProject: vi.fn(async () => project),
  runCommand: vi.fn(async () => ({
    project,
    result: {
      id: 'terminal_1',
      command: 'npm test',
      cwd: project.rootPath,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      startedAt: 1,
      completedAt: 2,
      approved: true,
      timedOut: false,
    },
  })),
  getAiSession: vi.fn(async () => ({
    mode: 'ask',
    contextFiles: [],
    messages: [],
    proposals: [],
    checkpoints: [],
    terminalCards: [],
    createdAt: 1,
    updatedAt: 1,
  })),
  setAiMode: vi.fn(),
  setAiContext: vi.fn(),
  addAiMessage: vi.fn(async () => ({
    project,
    message: {
      id: 'ai_message_1',
      role: 'assistant',
      mode: 'ask',
      content: 'answer',
      createdAt: 1,
    },
  })),
  saveAiEditProposal: vi.fn(async () => ({
    project,
    proposal: {
      id: 'ai_proposal_1',
      prompt: 'change it',
      mode: 'agent',
      summary: 'proposal',
      status: 'proposed',
      edits: [],
      createdAt: 1,
      updatedAt: 1,
    },
  })),
  applyAiEditProposal: vi.fn(async () => ({ project })),
  rejectAiEditProposal: vi.fn(async () => ({ project })),
  restoreAiCheckpoint: vi.fn(async () => ({ project })),
  recordAiTerminalCard: vi.fn(async () => ({
    project,
    card: {
      id: 'ai_terminal_1',
      command: 'npm test',
      status: 'requires_approval',
      createdAt: 1,
    },
  })),
};

vi.mock('./canvas-service', () => ({
  CanvasService: {
    getInstance: () => service,
  },
}));

vi.mock('./canvas-ai-coder', () => ({
  CanvasAiCoder: {
    getConfigStatus: () => ({
      configured: true,
      baseURL: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/test',
    }),
    answer: vi.fn(async () => ({
      summary: 'answer',
      referencedFiles: ['index.html'],
    })),
    generatePlan: vi.fn(async () => ({
      summary: 'plan',
      steps: [
        {
          title: 'Edit',
          detail: 'Update file',
          kind: 'edit',
          filePaths: ['index.html'],
        },
      ],
    })),
    generateEdits: vi.fn(async () => ({
      summary: 'proposal',
      edits: [
        {
          filePath: 'index.html',
          content: '<main>changed</main>',
          rationale: 'test',
        },
      ],
      verificationCommand: 'npm test',
    })),
    continueAfterTerminal: vi.fn(async () => ({
      summary: 'retry',
      edits: [],
    })),
  },
}));

describe('CanvasIdeBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    await CanvasIdeBridge.getInstance().stop();
  });

  it('rejects unauthenticated project reads', async () => {
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    const session = await CanvasIdeBridge.getInstance().createSession(
      project.id,
    );

    const response = await fetch(`${session.url}/project`);

    expect(response.status).toBe(401);
  });

  it('returns project state with a valid bridge token', async () => {
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    const session = await CanvasIdeBridge.getInstance().createSession(
      project.id,
    );

    const response = await fetch(`${session.url}/project`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe(project.id);
  });

  it('does not execute a terminal command without approval', async () => {
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    const session = await CanvasIdeBridge.getInstance().createSession(
      project.id,
    );

    const response = await fetch(`${session.url}/terminal/request`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ command: 'npm test', approved: false }),
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.requiresApproval).toBe(true);
    expect(service.runCommand).not.toHaveBeenCalled();
    expect(service.recordAiTerminalCard).toHaveBeenCalledWith(
      project.id,
      'npm test',
      'requires_approval',
    );
  });

  it('returns AI session state and redacted NIM status', async () => {
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    const session = await CanvasIdeBridge.getInstance().createSession(
      project.id,
    );

    const response = await fetch(`${session.url}/ai/session`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.mode).toBe('ask');
    expect(payload.nim.configured).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('nim-key');
  });

  it('rejects Ask mode edit proposals', async () => {
    const { CanvasIdeBridge } = await import('./canvas-ide-bridge');
    const session = await CanvasIdeBridge.getInstance().createSession(
      project.id,
    );

    const response = await fetch(`${session.url}/ai/edits/propose`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode: 'ask', prompt: 'edit this' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Ask mode cannot propose file edits');
    expect(service.saveAiEditProposal).not.toHaveBeenCalled();
  });
});
