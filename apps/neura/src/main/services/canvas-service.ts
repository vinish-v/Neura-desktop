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

export type CanvasProject = {
  id: string;
  title: string;
  rootPath: string;
  entryFile: string;
  files: CanvasProjectFile[];
  versions: CanvasProjectVersion[];
  composerPlans: CanvasComposerPlan[];
  terminalRuns: CanvasTerminalCommandResult[];
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
};

export type RunCanvasCommandInput = {
  projectId: string;
  command: string;
  approved: boolean;
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

  async createComposerPlan(input: CreateComposerPlanInput) {
    const project = await this.getProject(input.projectId);
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Composer prompt is required.');
    }

    const now = Date.now();
    const targetFiles = this.inferTargetFiles(project, prompt);
    const verificationCommand = this.inferVerificationCommand(project);
    const steps: CanvasComposerStep[] = [
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

    return {
      ...metadata,
      rootPath,
      files,
      composerPlans: metadata.composerPlans || [],
      terminalRuns: metadata.terminalRuns || [],
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
}
