/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { shell } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const CANVAS_ROOT = path.join(os.homedir(), 'Neura-Projects');
const METADATA_FILE = 'neura-canvas.json';
const MAX_VERSIONS = 50;
const MAX_TERMINAL_RUNS = 50;
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const IGNORED_SCAN_DIRECTORIES = new Set([
  '.git',
  'dist',
  'node_modules',
  'out',
  '.next',
  '.turbo',
]);

export type CanvasProjectFile = {
  path: string;
  language: string;
  content: string;
  updatedAt: number;
};

export type CanvasProjectVersion = {
  id: string;
  label: string;
  createdAt: number;
  files: CanvasProjectFile[];
};

export type CanvasComposerStepStatus =
  | 'pending'
  | 'approved'
  | 'running'
  | 'done'
  | 'failed';

export type CanvasComposerStep = {
  id: string;
  title: string;
  detail: string;
  kind: 'plan' | 'edit' | 'terminal' | 'verify';
  status: CanvasComposerStepStatus;
  filePaths?: string[];
  command?: string;
};

export type CanvasComposerPlan = {
  id: string;
  prompt: string;
  status: 'draft' | 'approved' | 'running' | 'completed' | 'failed';
  steps: CanvasComposerStep[];
  createdAt: number;
  updatedAt: number;
};

export type CanvasTerminalCommandResult = {
  id: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  completedAt: number;
  approved: boolean;
  timedOut: boolean;
};

export type CanvasAiMode = 'ask' | 'plan' | 'agent' | 'builder';

export type CanvasAiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  mode: CanvasAiMode;
  content: string;
  createdAt: number;
  referencedFiles?: string[];
  proposalId?: string;
  planId?: string;
  terminalRunId?: string;
};

export type CanvasAiEditProposal = {
  id: string;
  prompt: string;
  mode: CanvasAiMode;
  summary: string;
  status: 'proposed' | 'partially_applied' | 'applied' | 'rejected';
  edits: Array<{
    filePath: string;
    content: string;
    rationale?: string;
    status: 'pending' | 'applied' | 'rejected';
  }>;
  verificationCommand?: string;
  checkpointId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasAiCheckpoint = {
  id: string;
  label: string;
  proposalId?: string;
  files: CanvasProjectFile[];
  createdAt: number;
  restoredAt?: number;
};

export type CanvasAiTerminalCard = {
  id: string;
  command: string;
  status: 'requires_approval' | 'completed' | 'failed';
  terminalRunId?: string;
  createdAt: number;
};

export type CanvasAiSession = {
  mode: CanvasAiMode;
  contextFiles: string[];
  messages: CanvasAiMessage[];
  proposals: CanvasAiEditProposal[];
  checkpoints: CanvasAiCheckpoint[];
  terminalCards: CanvasAiTerminalCard[];
  createdAt: number;
  updatedAt: number;
};

export type CanvasProject = {
  id: string;
  title: string;
  rootPath: string;
  entryFile: string;
  files: CanvasProjectFile[];
  versions: CanvasProjectVersion[];
  composerPlans: CanvasComposerPlan[];
  terminalRuns: CanvasTerminalCommandResult[];
  aiSession?: CanvasAiSession;
  sourceRunId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CreateCanvasProjectInput = {
  title: string;
  html?: string;
  files?: Array<{
    path: string;
    content: string;
    language?: string;
  }>;
  artifactPath?: string;
  sourceRunId?: string;
};

export type UpdateCanvasProjectInput = {
  projectId: string;
  filePath: string;
  content: string;
  versionLabel?: string;
};

export type CreateCanvasFileInput = {
  projectId: string;
  filePath: string;
  content?: string;
};

export type CreateComposerPlanInput = {
  projectId: string;
  prompt: string;
  aiSteps?: Array<{
    title: string;
    detail: string;
    kind: CanvasComposerStep['kind'];
    filePaths?: string[];
    command?: string;
  }>;
};

export type RunCanvasCommandInput = {
  projectId: string;
  command: string;
  approved: boolean;
};

export type AddCanvasAiMessageInput = {
  projectId: string;
  role: CanvasAiMessage['role'];
  mode?: CanvasAiMode;
  content: string;
  referencedFiles?: string[];
  proposalId?: string;
  planId?: string;
  terminalRunId?: string;
};

export type SaveCanvasAiEditProposalInput = {
  projectId: string;
  prompt: string;
  mode: CanvasAiMode;
  summary: string;
  edits: Array<{
    filePath: string;
    content: string;
    rationale?: string;
  }>;
  verificationCommand?: string;
};

type CanvasProjectMetadata = Omit<CanvasProject, 'files'> & {
  files: Array<Omit<CanvasProjectFile, 'content'>>;
};

const defaultCanvasHtml = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Geist, Inter, ui-sans-serif, system-ui, sans-serif;
        background: #0a0a0a;
        color: #ffffff;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #0a0a0a;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 48px;
      }
      section {
        width: min(760px, 100%);
        border: 1px solid #2a2a2a;
        border-radius: 12px;
        background: #171717;
        padding: 32px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 32px;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #a3a3a3;
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${escapeHtml(title)}</h1>
        <p>Start building in Neura Canvas. Ask Neura to generate, iterate, or fix this project from the prompt bar.</p>
      </section>
    </main>
  </body>
</html>
`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const slugify = (value: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'canvas-project';
};

const detectLanguage = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'html';
  if (extension === '.css') return 'css';
  if (extension === '.json') return 'json';
  if (extension === '.ts' || extension === '.tsx') return 'typescript';
  if (extension === '.js' || extension === '.jsx') return 'javascript';
  if (extension === '.md' || extension === '.mdx') return 'markdown';
  return 'plaintext';
};

const isReadableCodeFile = (filePath: string) =>
  [
    '.css',
    '.html',
    '.js',
    '.json',
    '.jsx',
    '.md',
    '.mdx',
    '.ts',
    '.tsx',
    '.txt',
    '.yaml',
    '.yml',
  ].includes(path.extname(filePath).toLowerCase());

const normalizeProjectFilePath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('\0') || normalized.includes('..')) {
    throw new Error('Invalid Canvas file path.');
  }
  return normalized;
};

const resolveWithinProject = (rootPath: string, filePath: string) => {
  const normalized = normalizeProjectFilePath(filePath);
  const target = path.resolve(rootPath, normalized);
  const resolvedRoot = path.resolve(rootPath);
  if (
    target !== resolvedRoot &&
    !target.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Canvas file path escapes the project folder.');
  }
  return { normalized, target };
};

const metadataPathFor = (rootPath: string) =>
  path.join(rootPath, METADATA_FILE);

export class CanvasService {
  private static instance: CanvasService | null = null;

  static getInstance() {
    if (!CanvasService.instance) {
      CanvasService.instance = new CanvasService();
    }
    return CanvasService.instance;
  }

  getRootPath() {
    return CANVAS_ROOT;
  }

  async listProjects(): Promise<CanvasProject[]> {
    await fs.mkdir(CANVAS_ROOT, { recursive: true });
    const entries = await fs.readdir(CANVAS_ROOT, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return await this.readProjectByRoot(
              path.join(CANVAS_ROOT, entry.name),
            );
          } catch {
            return null;
          }
        }),
    );

    return projects
      .filter((project): project is CanvasProject => Boolean(project))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getProject(projectId: string) {
    const project = await this.findProject(projectId);
    if (!project) {
      throw new Error('Canvas project was not found.');
    }
    return project;
  }

  async createProject(input: CreateCanvasProjectInput) {
    const title = input.title.trim() || 'Untitled Canvas';
    const projectId = `canvas_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const rootPath = path.join(
      CANVAS_ROOT,
      `${slugify(title)}-${projectId.slice(-8)}`,
    );
    await fs.mkdir(rootPath, { recursive: true });

    const now = Date.now();
    const files = await this.resolveInitialFiles(input, title, now);
    for (const file of files) {
      const { target } = resolveWithinProject(rootPath, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, 'utf8');
    }

    const project: CanvasProject = {
      id: projectId,
      title,
      rootPath,
      entryFile: files[0]?.path || 'index.html',
      files,
      versions: [
        {
          id: `version_${now}_${randomUUID().slice(0, 8)}`,
          label: 'Initial version',
          createdAt: now,
          files,
        },
      ],
      composerPlans: [],
      terminalRuns: [],
      sourceRunId: input.sourceRunId,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeMetadata(project);
    return project;
  }

  async createFile(input: CreateCanvasFileInput) {
    const filePath = normalizeProjectFilePath(input.filePath);
    const project = await this.getProject(input.projectId);
    if (project.files.some((file) => file.path === filePath)) {
      throw new Error('Canvas file already exists.');
    }
    return this.updateProject({
      projectId: input.projectId,
      filePath,
      content: input.content || '',
      versionLabel: `Created ${filePath}`,
    });
  }

  async updateProject(input: UpdateCanvasProjectInput) {
    const project = await this.getProject(input.projectId);
    const { normalized, target } = resolveWithinProject(
      project.rootPath,
      input.filePath,
    );
    const now = Date.now();

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.content, 'utf8');

    const nextFile: CanvasProjectFile = {
      path: normalized,
      content: input.content,
      language: detectLanguage(normalized),
      updatedAt: now,
    };
    const nextFiles = [
      nextFile,
      ...project.files.filter((file) => file.path !== normalized),
    ].sort((left, right) => left.path.localeCompare(right.path));

    const nextProject: CanvasProject = {
      ...project,
      files: nextFiles,
      entryFile: project.entryFile || normalized,
      updatedAt: now,
      versions: [
        {
          id: `version_${now}_${randomUUID().slice(0, 8)}`,
          label: input.versionLabel?.trim() || 'Saved edit',
          createdAt: now,
          files: nextFiles,
        },
        ...project.versions,
      ].slice(0, MAX_VERSIONS),
    };

    await this.writeMetadata(nextProject);
    return nextProject;
  }

  async refreshProjectFiles(projectId: string) {
    const project = await this.getProject(projectId);
    const files = await this.scanProjectFiles(project.rootPath);
    const now = Date.now();
    const nextProject: CanvasProject = {
      ...project,
      files,
      entryFile:
        files.find((file) => file.path === project.entryFile)?.path ||
        files.find((file) => file.path === 'index.html')?.path ||
        files[0]?.path ||
        project.entryFile,
      updatedAt: now,
      versions: [
        {
          id: `version_${now}_${randomUUID().slice(0, 8)}`,
          label: 'Refreshed from disk',
          createdAt: now,
          files,
        },
        ...project.versions,
      ].slice(0, MAX_VERSIONS),
    };
    await this.writeMetadata(nextProject);
    return nextProject;
  }

  async getAiSession(projectId: string) {
    const project = await this.getProject(projectId);
    const nextProject = await this.persistAiSession(project);
    return nextProject.aiSession!;
  }

  async setAiMode(projectId: string, mode: CanvasAiMode) {
    const project = await this.getProject(projectId);
    const now = Date.now();
    const session = this.ensureAiSession(project, now);
    const nextProject: CanvasProject = {
      ...project,
      aiSession: {
        ...session,
        mode,
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return nextProject.aiSession!;
  }

  async setAiContext(projectId: string, contextFiles: string[]) {
    const project = await this.getProject(projectId);
    const allowed = new Set(project.files.map((file) => file.path));
    const normalizedFiles = contextFiles
      .map(normalizeProjectFilePath)
      .filter((filePath, index, all) => {
        return allowed.has(filePath) && all.indexOf(filePath) === index;
      })
      .slice(0, 24);
    const now = Date.now();
    const session = this.ensureAiSession(project, now);
    const nextProject: CanvasProject = {
      ...project,
      aiSession: {
        ...session,
        contextFiles: normalizedFiles,
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return nextProject.aiSession!;
  }

  async addAiMessage(input: AddCanvasAiMessageInput) {
    const project = await this.getProject(input.projectId);
    const content = input.content.trim();
    if (!content) {
      throw new Error('AI message content is required.');
    }
    const now = Date.now();
    const session = this.ensureAiSession(project, now);
    const message: CanvasAiMessage = {
      id: `ai_message_${now}_${randomUUID().slice(0, 8)}`,
      role: input.role,
      mode: input.mode || session.mode,
      content,
      createdAt: now,
      referencedFiles: input.referencedFiles,
      proposalId: input.proposalId,
      planId: input.planId,
      terminalRunId: input.terminalRunId,
    };
    const nextProject: CanvasProject = {
      ...project,
      aiSession: {
        ...session,
        messages: [...session.messages, message].slice(-100),
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return { project: nextProject, message };
  }

  async saveAiEditProposal(input: SaveCanvasAiEditProposalInput) {
    const project = await this.getProject(input.projectId);
    if (!input.edits.length) {
      throw new Error('At least one AI edit is required.');
    }
    const now = Date.now();
    const session = this.ensureAiSession(project, now);
    const proposal: CanvasAiEditProposal = {
      id: `ai_proposal_${now}_${randomUUID().slice(0, 8)}`,
      prompt: input.prompt.trim(),
      mode: input.mode,
      summary: input.summary.trim() || 'Neura proposed code changes.',
      status: 'proposed',
      edits: input.edits.map((edit) => ({
        filePath: normalizeProjectFilePath(edit.filePath),
        content: edit.content,
        rationale: edit.rationale,
        status: 'pending',
      })),
      verificationCommand: input.verificationCommand?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const nextProject: CanvasProject = {
      ...project,
      aiSession: {
        ...session,
        proposals: [proposal, ...session.proposals].slice(0, 30),
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return { project: nextProject, proposal };
  }

  async applyAiEditProposal(
    projectId: string,
    proposalId: string,
    filePaths?: string[],
  ) {
    const project = await this.getProject(projectId);
    const session = this.ensureAiSession(project);
    const proposal = session.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error('AI edit proposal was not found.');
    }
    const selected = new Set(
      (filePaths?.length ? filePaths : proposal.edits.map((edit) => edit.filePath))
        .map(normalizeProjectFilePath),
    );
    const editsToApply = proposal.edits.filter(
      (edit) => selected.has(edit.filePath) && edit.status === 'pending',
    );
    if (!editsToApply.length) {
      throw new Error('No pending AI edits matched the apply request.');
    }

    const checkpoint = await this.createAiCheckpoint(
      project,
      `Before ${proposal.summary.slice(0, 64)}`,
      proposal.id,
    );

    for (const edit of editsToApply) {
      await this.updateProject({
        projectId,
        filePath: edit.filePath,
        content: edit.content,
        versionLabel: `Neura AI: ${proposal.summary.slice(0, 72)}`,
      });
    }

    const refreshed = await this.getProject(projectId);
    const refreshedSession = this.ensureAiSession(refreshed);
    const now = Date.now();
    const nextProposals = refreshedSession.proposals.map((item) => {
      if (item.id !== proposalId) {
        return item;
      }
      const edits = item.edits.map((edit) =>
        selected.has(edit.filePath) ? { ...edit, status: 'applied' as const } : edit,
      );
      const hasPending = edits.some((edit) => edit.status === 'pending');
      return {
        ...item,
        checkpointId: checkpoint.id,
        edits,
        status: hasPending
          ? ('partially_applied' as const)
          : ('applied' as const),
        updatedAt: now,
      };
    });
    const finalProject: CanvasProject = {
      ...refreshed,
      aiSession: {
        ...refreshedSession,
        proposals: nextProposals,
        checkpoints: [checkpoint, ...refreshedSession.checkpoints].filter(
          (item, index, all) =>
            all.findIndex((candidate) => candidate.id === item.id) === index,
        ),
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(finalProject);
    const appliedProposal = finalProject.aiSession!.proposals.find(
      (item) => item.id === proposalId,
    )!;
    return { project: finalProject, proposal: appliedProposal, checkpoint };
  }

  async rejectAiEditProposal(
    projectId: string,
    proposalId: string,
    filePaths?: string[],
  ) {
    const project = await this.getProject(projectId);
    const session = this.ensureAiSession(project);
    const selected = filePaths?.length
      ? new Set(filePaths.map(normalizeProjectFilePath))
      : null;
    const now = Date.now();
    const proposals = session.proposals.map((proposal) => {
      if (proposal.id !== proposalId) {
        return proposal;
      }
      const edits = proposal.edits.map((edit) =>
        !selected || selected.has(edit.filePath)
          ? { ...edit, status: 'rejected' as const }
          : edit,
      );
      const hasPending = edits.some((edit) => edit.status === 'pending');
      return {
        ...proposal,
        edits,
        status: hasPending
          ? ('partially_applied' as const)
          : ('rejected' as const),
        updatedAt: now,
      };
    });
    const nextProject: CanvasProject = {
      ...project,
      aiSession: {
        ...session,
        proposals,
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    const proposal = nextProject.aiSession!.proposals.find(
      (item) => item.id === proposalId,
    );
    if (!proposal) {
      throw new Error('AI edit proposal was not found.');
    }
    return { project: nextProject, proposal };
  }

  async restoreAiCheckpoint(projectId: string, checkpointId: string) {
    const project = await this.getProject(projectId);
    const session = this.ensureAiSession(project);
    const checkpoint = session.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) {
      throw new Error('AI checkpoint was not found.');
    }

    const checkpointPaths = new Set(checkpoint.files.map((file) => file.path));
    for (const file of project.files) {
      if (!checkpointPaths.has(file.path)) {
        const { target } = resolveWithinProject(project.rootPath, file.path);
        await fs.rm(target, { force: true });
      }
    }
    for (const file of checkpoint.files) {
      const { target } = resolveWithinProject(project.rootPath, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, 'utf8');
    }

    const now = Date.now();
    const restoredCheckpoint = { ...checkpoint, restoredAt: now };
    const nextProject: CanvasProject = {
      ...project,
      files: checkpoint.files,
      versions: [
        {
          id: `version_${now}_${randomUUID().slice(0, 8)}`,
          label: `Restored ${checkpoint.label}`,
          createdAt: now,
          files: checkpoint.files,
        },
        ...project.versions,
      ].slice(0, MAX_VERSIONS),
      aiSession: {
        ...session,
        checkpoints: session.checkpoints.map((item) =>
          item.id === checkpointId ? restoredCheckpoint : item,
        ),
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return { project: nextProject, checkpoint: restoredCheckpoint };
  }

  async recordAiTerminalCard(
    projectId: string,
    command: string,
    status: CanvasAiTerminalCard['status'],
    terminalRunId?: string,
  ) {
    const project = await this.getProject(projectId);
    const now = Date.now();
    const session = this.ensureAiSession(project, now);
    const card: CanvasAiTerminalCard = {
      id: `ai_terminal_${now}_${randomUUID().slice(0, 8)}`,
      command,
      status,
      terminalRunId,
      createdAt: now,
    };
    const nextProject: CanvasProject = {
      ...project,
      aiSession: {
        ...session,
        terminalCards: [card, ...session.terminalCards].slice(0, 50),
        updatedAt: now,
      },
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return { project: nextProject, card };
  }

  async createComposerPlan(input: CreateComposerPlanInput) {
    const project = await this.getProject(input.projectId);
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Composer prompt is required.');
    }

    const now = Date.now();
    const steps: CanvasComposerStep[] = input.aiSteps?.length
      ? input.aiSteps.map((step) => ({
          id: `step_${randomUUID().slice(0, 8)}`,
          title: step.title,
          detail: step.detail,
          kind: step.kind,
          status: 'pending',
          filePaths: step.filePaths,
          command: step.command,
        }))
      : this.createHeuristicComposerSteps(project, prompt);

    const plan: CanvasComposerPlan = {
      id: `composer_${now}_${randomUUID().slice(0, 8)}`,
      prompt,
      status: 'draft',
      steps,
      createdAt: now,
      updatedAt: now,
    };
    const nextProject = {
      ...project,
      composerPlans: [plan, ...(project.composerPlans || [])].slice(0, 20),
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return { project: nextProject, plan };
  }

  private createHeuristicComposerSteps(
    project: CanvasProject,
    prompt: string,
  ): CanvasComposerStep[] {
    const targetFiles = this.inferTargetFiles(project, prompt);
    const verificationCommand = this.inferVerificationCommand(project);
    return [
      {
        id: `step_${randomUUID().slice(0, 8)}`,
        title: 'Understand project context',
        detail: `Inspect ${targetFiles.length ? targetFiles.join(', ') : 'the project files'} and identify the safest edit path.`,
        kind: 'plan',
        status: 'pending',
        filePaths: targetFiles,
      },
      {
        id: `step_${randomUUID().slice(0, 8)}`,
        title: 'Edit affected files',
        detail:
          'Apply focused multi-file changes in Canvas and keep unrelated code untouched.',
        kind: 'edit',
        status: 'pending',
        filePaths: targetFiles,
      },
      {
        id: `step_${randomUUID().slice(0, 8)}`,
        title: verificationCommand
          ? 'Run verification command'
          : 'Verify manually',
        detail: verificationCommand
          ? `Run ${verificationCommand} from the project root after changes are applied.`
          : 'Use the live preview and available project evidence to verify the change.',
        kind: 'verify',
        status: 'pending',
        command: verificationCommand,
      },
    ];
  }

  async approveComposerPlan(projectId: string, planId: string) {
    const project = await this.getProject(projectId);
    const now = Date.now();
    const nextProject: CanvasProject = {
      ...project,
      composerPlans: project.composerPlans.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              status: 'approved',
              updatedAt: now,
              steps: plan.steps.map((step) => ({
                ...step,
                status: 'approved',
              })),
            }
          : plan,
      ),
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    const plan = nextProject.composerPlans.find((item) => item.id === planId);
    if (!plan) {
      throw new Error('Composer plan was not found.');
    }
    return { project: nextProject, plan };
  }

  async rejectComposerPlan(projectId: string, planId: string) {
    const project = await this.getProject(projectId);
    const now = Date.now();
    const nextProject: CanvasProject = {
      ...project,
      composerPlans: project.composerPlans.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              status: 'failed',
              updatedAt: now,
              steps: plan.steps.map((step) => ({
                ...step,
                status: step.status === 'done' ? step.status : 'failed',
              })),
            }
          : plan,
      ),
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    const plan = nextProject.composerPlans.find((item) => item.id === planId);
    if (!plan) {
      throw new Error('Composer plan was not found.');
    }
    return { project: nextProject, plan };
  }

  async runCommand(input: RunCanvasCommandInput) {
    if (!input.approved) {
      throw new Error('Command execution requires explicit approval.');
    }
    const project = await this.getProject(input.projectId);
    const command = input.command.trim();
    if (!command) {
      throw new Error('Command is required.');
    }

    const startedAt = Date.now();
    const result = await this.spawnCommand(
      command,
      project.rootPath,
      startedAt,
    );
    const nextProject: CanvasProject = {
      ...project,
      terminalRuns: [result, ...(project.terminalRuns || [])].slice(
        0,
        MAX_TERMINAL_RUNS,
      ),
      updatedAt: result.completedAt,
    };
    await this.writeMetadata(nextProject);
    return { project: nextProject, result };
  }

  async revealProject(projectId: string) {
    const project = await this.getProject(projectId);
    shell.showItemInFolder(project.rootPath);
    return project.rootPath;
  }

  async openProject(projectId: string) {
    const project = await this.getProject(projectId);
    return shell.openPath(project.rootPath);
  }

  private async scanProjectFiles(rootPath: string) {
    const files: CanvasProjectFile[] = [];

    const walk = async (directory: string) => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === METADATA_FILE) {
          continue;
        }
        if (entry.isDirectory() && IGNORED_SCAN_DIRECTORIES.has(entry.name)) {
          continue;
        }

        const entryPath = path.join(directory, entry.name);
        const relativePath = path
          .relative(rootPath, entryPath)
          .replace(/\\/g, '/');
        if (entry.isDirectory()) {
          await walk(entryPath);
          continue;
        }
        if (!entry.isFile() || !isReadableCodeFile(relativePath)) {
          continue;
        }

        const stat = await fs.stat(entryPath);
        files.push({
          path: normalizeProjectFilePath(relativePath),
          language: detectLanguage(relativePath),
          content: await fs.readFile(entryPath, 'utf8'),
          updatedAt: stat.mtimeMs,
        });
      }
    };

    await walk(rootPath);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  private inferTargetFiles(project: CanvasProject, prompt: string) {
    const lowerPrompt = prompt.toLowerCase();
    const explicitMatches = project.files.filter((file) =>
      lowerPrompt.includes(file.path.toLowerCase()),
    );
    if (explicitMatches.length) {
      return explicitMatches.map((file) => file.path);
    }

    const prioritized = project.files.filter((file) =>
      ['index.html', 'src/App.tsx', 'src/app.tsx', 'src/main.tsx'].includes(
        file.path,
      ),
    );
    const sourceFiles = project.files.filter((file) =>
      /\.(html|tsx|jsx|ts|js|css)$/i.test(file.path),
    );
    return [...prioritized, ...sourceFiles]
      .map((file) => file.path)
      .filter((filePath, index, all) => all.indexOf(filePath) === index)
      .slice(0, 8);
  }

  private inferVerificationCommand(project: CanvasProject) {
    const packageFile = project.files.find(
      (file) => file.path === 'package.json',
    );
    if (!packageFile) {
      return '';
    }
    try {
      const packageJson = JSON.parse(packageFile.content) as {
        scripts?: Record<string, string>;
      };
      const scripts = packageJson.scripts || {};
      if (scripts.test) return 'npm test';
      if (scripts.typecheck) return 'npm run typecheck';
      if (scripts.build) return 'npm run build';
      if (scripts.lint) return 'npm run lint';
    } catch {
      return '';
    }
    return '';
  }

  private spawnCommand(
    command: string,
    cwd: string,
    startedAt: number,
  ): Promise<CanvasTerminalCommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const appendOutput = (current: string, chunk: Buffer) =>
        `${current}${chunk.toString('utf8')}`.slice(-MAX_COMMAND_OUTPUT_BYTES);

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, COMMAND_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        resolve({
          id: `terminal_${startedAt}_${randomUUID().slice(0, 8)}`,
          command,
          cwd,
          exitCode,
          stdout,
          stderr: timedOut
            ? `${stderr}\nCommand timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`
            : stderr,
          startedAt,
          completedAt: Date.now(),
          approved: true,
          timedOut,
        });
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          id: `terminal_${startedAt}_${randomUUID().slice(0, 8)}`,
          command,
          cwd,
          exitCode: null,
          stdout,
          stderr: error.message,
          startedAt,
          completedAt: Date.now(),
          approved: true,
          timedOut,
        });
      });
    });
  }

  private async resolveInitialFiles(
    input: CreateCanvasProjectInput,
    title: string,
    createdAt: number,
  ): Promise<CanvasProjectFile[]> {
    if (input.files?.length) {
      return input.files.map((file) => {
        const normalized = normalizeProjectFilePath(file.path);
        return {
          path: normalized,
          content: file.content,
          language: file.language || detectLanguage(normalized),
          updatedAt: createdAt,
        };
      });
    }

    if (input.artifactPath?.trim()) {
      const artifactPath = path.resolve(input.artifactPath);
      const stat = await fs.stat(artifactPath);
      if (stat.isDirectory()) {
        throw new Error('Canvas can import files, not folders.');
      }
      const fileName = path.basename(artifactPath);
      return [
        {
          path: normalizeProjectFilePath(fileName),
          content: await fs.readFile(artifactPath, 'utf8'),
          language: detectLanguage(fileName),
          updatedAt: createdAt,
        },
      ];
    }

    return [
      {
        path: 'index.html',
        content: input.html || defaultCanvasHtml(title),
        language: 'html',
        updatedAt: createdAt,
      },
    ];
  }

  private async findProject(projectId: string) {
    const projects = await this.listProjects();
    return projects.find((project) => project.id === projectId) || null;
  }

  private async readProjectByRoot(rootPath: string): Promise<CanvasProject> {
    const metadata = JSON.parse(
      await fs.readFile(metadataPathFor(rootPath), 'utf8'),
    ) as CanvasProjectMetadata;

    const files = await Promise.all(
      metadata.files.map(async (file) => {
        const { target } = resolveWithinProject(rootPath, file.path);
        return {
          ...file,
          content: await fs.readFile(target, 'utf8'),
        };
      }),
    );

    const project: CanvasProject = {
      ...metadata,
      rootPath,
      files,
      composerPlans: metadata.composerPlans || [],
      terminalRuns: metadata.terminalRuns || [],
    };
    return {
      ...project,
      aiSession: this.ensureAiSession(project),
    };
  }

  private async writeMetadata(project: CanvasProject) {
    const metadata: CanvasProjectMetadata = {
      ...project,
      files: project.files.map(({ content: _content, ...file }) => file),
    };
    await fs.writeFile(
      metadataPathFor(project.rootPath),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );
  }

  private ensureAiSession(project: CanvasProject, now = Date.now()): CanvasAiSession {
    const session = project.aiSession;
    if (session) {
      return {
        mode: session.mode || 'ask',
        contextFiles: session.contextFiles || [],
        messages: session.messages || [],
        proposals: session.proposals || [],
        checkpoints: session.checkpoints || [],
        terminalCards: session.terminalCards || [],
        createdAt: session.createdAt || project.createdAt || now,
        updatedAt: session.updatedAt || project.updatedAt || now,
      };
    }
    return {
      mode: 'ask',
      contextFiles: [],
      messages: [],
      proposals: [],
      checkpoints: [],
      terminalCards: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  private async persistAiSession(project: CanvasProject) {
    if (project.aiSession) {
      return project;
    }
    const now = Date.now();
    const nextProject: CanvasProject = {
      ...project,
      aiSession: this.ensureAiSession(project, now),
      updatedAt: now,
    };
    await this.writeMetadata(nextProject);
    return nextProject;
  }

  private async createAiCheckpoint(
    project: CanvasProject,
    label: string,
    proposalId?: string,
  ): Promise<CanvasAiCheckpoint> {
    const now = Date.now();
    const files = project.files.map((file) => ({ ...file }));
    return {
      id: `ai_checkpoint_${now}_${randomUUID().slice(0, 8)}`,
      label,
      proposalId,
      files,
      createdAt: now,
    };
  }
}
