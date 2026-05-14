/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import {
  CheckCircle2,
  Code2,
  Eye,
  FilePlus2,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  Play,
  RefreshCcw,
  Save,
  Send,
  Sparkles,
  SplitSquareHorizontal,
  Terminal,
  Wrench,
} from 'lucide-react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { toast } from 'sonner';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/utils';

type CanvasProjectFile = {
  path: string;
  language: string;
  content: string;
  updatedAt: number;
};

type CanvasProjectVersion = {
  id: string;
  label: string;
  createdAt: number;
  files: CanvasProjectFile[];
};

type CanvasComposerStep = {
  id: string;
  title: string;
  detail: string;
  kind: 'plan' | 'edit' | 'terminal' | 'verify';
  status: 'pending' | 'approved' | 'running' | 'done' | 'failed';
  filePaths?: string[];
  command?: string;
};

type CanvasComposerPlan = {
  id: string;
  prompt: string;
  status: 'draft' | 'approved' | 'running' | 'completed' | 'failed';
  steps: CanvasComposerStep[];
  createdAt: number;
  updatedAt: number;
};

type CanvasTerminalCommandResult = {
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

type CanvasProject = {
  id: string;
  title: string;
  rootPath: string;
  entryFile: string;
  files: CanvasProjectFile[];
  versions: CanvasProjectVersion[];
  composerPlans: CanvasComposerPlan[];
  terminalRuns: CanvasTerminalCommandResult[];
  createdAt: number;
  updatedAt: number;
};

type CanvasIdeStatus = {
  available: boolean;
  executablePath: string | null;
  configuredBy: 'env' | 'installed' | 'repo' | null;
  bridge: {
    running: boolean;
    url: string | null;
    activeSessions: number;
  };
};

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));

const previewHtml = (file: CanvasProjectFile | null, code: string) => {
  if (!file) {
    return '';
  }
  if (file.language === 'html' || file.path.endsWith('.html')) {
    return code;
  }
  return `<pre style="margin:0;min-height:100vh;padding:24px;background:#0a0a0a;color:#fff;font:13px/1.7 Geist Mono,Consolas,monospace;white-space:pre-wrap;">${code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;
};

const composerGoal = (
  project: CanvasProject,
  plan: CanvasComposerPlan | null,
  instruction: string,
) => `You are Neura Canvas Composer Mode, a Cursor-style coding agent.
Project root: ${project.rootPath}
User request: ${instruction}

Approved plan:
${plan ? plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n') : 'No explicit plan was approved. Create a safe plan before editing.'}

Requirements:
- Inspect the existing project files before editing.
- Apply real multi-file changes directly under the project root.
- Do not use mock, fake, placeholder-only, or hardcoded behavior.
- Run an appropriate verification command when one exists.
- Preserve unrelated files and return a concise changed-files and verification summary.`;

export default function Canvas() {
  const location = useLocation();
  const requestedProjectId = (location.state as { projectId?: string } | null)
    ?.projectId;
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeFilePath, setActiveFilePath] = useState('index.html');
  const [code, setCode] = useState('');
  const [composerPrompt, setComposerPrompt] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('');
  const [pendingCommand, setPendingCommand] = useState('');
  const [newFilePath, setNewFilePath] = useState('');
  const [viewMode, setViewMode] = useState<'editor' | 'diff'>('editor');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [ideOpening, setIdeOpening] = useState(false);
  const [ideStatus, setIdeStatus] = useState<CanvasIdeStatus | null>(null);
  const [dirty, setDirty] = useState(false);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects],
  );
  const activeFile = useMemo(
    () =>
      activeProject?.files.find((file) => file.path === activeFilePath) ||
      activeProject?.files[0] ||
      null,
    [activeFilePath, activeProject],
  );
  const activePlan = activeProject?.composerPlans[0] || null;
  const preview = useMemo(
    () => previewHtml(activeFile, code),
    [activeFile, code],
  );

  const updateProjectState = (project: CanvasProject) => {
    setProjects((current) =>
      [project, ...current.filter((item) => item.id !== project.id)].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    );
    setActiveProjectId(project.id);
  };

  const refreshProjects = async (preferredProjectId?: string) => {
    const list = await api.listCanvasProjects();
    setProjects(list);
    const nextProject =
      list.find((project) => project.id === preferredProjectId) ||
      list.find((project) => project.id === requestedProjectId) ||
      list[0] ||
      null;
    if (nextProject) {
      setActiveProjectId(nextProject.id);
      const nextFile =
        nextProject.files.find((file) => file.path === nextProject.entryFile) ||
        nextProject.files[0];
      setActiveFilePath(nextFile?.path || 'index.html');
      setCode(nextFile?.content || '');
      setDirty(false);
    }
  };

  const refreshIdeStatus = async () => {
    const status = await api.getCanvasIdeStatus();
    setIdeStatus(status);
    return status;
  };

  useEffect(() => {
    (async () => {
      try {
        await refreshProjects(requestedProjectId);
        await refreshIdeStatus();
      } catch {
        toast.error('Could not load Canvas projects.');
      } finally {
        setLoading(false);
      }
    })();
  }, [requestedProjectId]);

  useEffect(() => {
    if (activeFile) {
      setCode(activeFile.content);
      setDirty(false);
    }
  }, [activeFile?.path, activeFile?.updatedAt, activeProject?.id]);

  const createProject = async () => {
    setSaving(true);
    try {
      const project = await api.createCanvasProject({
        title: 'Untitled Canvas',
      });
      await refreshProjects(project.id);
      toast.success('Canvas project created.');
    } catch {
      toast.error('Could not create Canvas project.');
    } finally {
      setSaving(false);
    }
  };

  const saveProject = async (label = 'Saved edit') => {
    if (!activeProject || !activeFile) {
      return null;
    }
    setSaving(true);
    try {
      const project = await api.updateCanvasProject({
        projectId: activeProject.id,
        filePath: activeFile.path,
        content: code,
        versionLabel: label,
      });
      updateProjectState(project);
      setDirty(false);
      toast.success('Canvas project saved.');
      return project;
    } catch {
      toast.error('Could not save Canvas project.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const createFile = async () => {
    if (!activeProject || !newFilePath.trim()) {
      return;
    }
    setSaving(true);
    try {
      const project = await api.createCanvasFile({
        projectId: activeProject.id,
        filePath: newFilePath,
      });
      updateProjectState(project);
      setActiveFilePath(newFilePath.trim().replace(/\\/g, '/'));
      setNewFilePath('');
      toast.success('File created.');
    } catch {
      toast.error('Could not create file.');
    } finally {
      setSaving(false);
    }
  };

  const refreshFromDisk = async () => {
    if (!activeProject) {
      return;
    }
    setSaving(true);
    try {
      const project = await api.refreshCanvasProjectFiles({
        projectId: activeProject.id,
      });
      updateProjectState(project);
      toast.success('Workspace refreshed from disk.');
    } catch {
      toast.error('Could not refresh workspace.');
    } finally {
      setSaving(false);
    }
  };

  const createPlan = async (prompt = composerPrompt) => {
    if (!activeProject || !prompt.trim()) {
      return;
    }
    setPlanning(true);
    try {
      const { project } = await api.createCanvasComposerPlan({
        projectId: activeProject.id,
        prompt,
      });
      updateProjectState(project);
      setComposerPrompt(prompt);
      toast.success('Composer plan created.');
    } catch {
      toast.error('Could not create Composer plan.');
    } finally {
      setPlanning(false);
    }
  };

  const queueComposerTask = async (instruction: string) => {
    if (!activeProject) {
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) {
      return;
    }

    setQueueing(true);
    try {
      const savedProject = dirty
        ? await saveProject('Saved before Composer task')
        : activeProject;
      if (!savedProject) {
        return;
      }
      let approvedPlan = activePlan;
      if (activePlan?.status === 'draft') {
        const result = await api.approveCanvasComposerPlan({
          projectId: savedProject.id,
          planId: activePlan.id,
        });
        approvedPlan = result.plan;
        updateProjectState(result.project);
      }

      await api.queueBackgroundTask({
        kind: 'multi_agent',
        goal: composerGoal(savedProject, approvedPlan, trimmed),
      });
      setComposerPrompt('');
      toast.success('Composer agent task queued.');
    } catch {
      toast.error('Could not queue Composer task.');
    } finally {
      setQueueing(false);
    }
  };

  const requestCommandApproval = () => {
    const command = terminalCommand.trim();
    if (!command) {
      return;
    }
    setPendingCommand(command);
    toast.info('Review the command, then approve to run it.');
  };

  const runApprovedCommand = async () => {
    if (!activeProject || !pendingCommand) {
      return;
    }
    setTerminalBusy(true);
    try {
      const { project, result } = await api.runCanvasCommand({
        projectId: activeProject.id,
        command: pendingCommand,
        approved: true,
      });
      updateProjectState(project);
      setPendingCommand('');
      setTerminalCommand('');
      if (result.exitCode === 0) {
        toast.success('Command completed.');
      } else {
        toast.error('Command failed. Check terminal output.');
      }
    } catch {
      toast.error('Could not run command.');
    } finally {
      setTerminalBusy(false);
    }
  };

  const restoreVersion = (version: CanvasProjectVersion) => {
    const file =
      version.files.find((item) => item.path === activeFilePath) ||
      version.files[0];
    if (!file) {
      return;
    }
    setCode(file.content);
    setActiveFilePath(file.path);
    setDirty(true);
    setViewMode('diff');
    toast.info('Version loaded in diff view. Save to apply it.');
  };

  const revealProject = async () => {
    if (activeProject) {
      await api.revealCanvasProject({ projectId: activeProject.id });
    }
  };

  const openNeuraIde = async () => {
    if (!activeProject) {
      return;
    }
    setIdeOpening(true);
    try {
      const status = ideStatus || (await refreshIdeStatus());
      if (!status.available) {
        throw new Error(
          'Neura IDE is not installed. Install the separate Neura IDE app, build apps/neura-ide, or configure NEURA_IDE_EXECUTABLE.',
        );
      }
      if (dirty) {
        const savedProject = await saveProject('Saved before opening Neura IDE');
        if (!savedProject) {
          return;
        }
      }
      const result = await api.openCanvasIde({ projectId: activeProject.id });
      toast.success(
        `Neura IDE opened for ${result.rootPath}${result.pid ? ` (pid ${result.pid})` : ''}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not open Neura IDE. Install the separate Neura IDE app or configure NEURA_IDE_EXECUTABLE.',
      );
      void refreshIdeStatus().catch(() => undefined);
    } finally {
      setIdeOpening(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0a] text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading Canvas
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0a] p-8 text-white">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#171717]">
            <Code2 className="h-5 w-5 text-blue-300" />
          </div>
          <h1 className="text-xl font-semibold">Neura Canvas</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create a project to edit code, preview UI, and run Composer agent
            workflows.
          </p>
          <Button className="mt-5" onClick={createProject} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
            New Canvas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)_340px] bg-[#0a0a0a] text-white">
      <aside className="flex min-h-0 flex-col border-r border-[#2a2a2a] bg-[#0f0f0f]">
        <div className="border-b border-[#2a2a2a] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Workspace</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {activeProject.files.length} file
                {activeProject.files.length === 1 ? '' : 's'}
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={refreshFromDisk}
              disabled={saving}
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={newFilePath}
              onChange={(event) => setNewFilePath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void createFile();
                }
              }}
              placeholder="src/App.tsx"
              className="h-8 min-w-0 flex-1 rounded-md border border-[#2a2a2a] bg-[#111] px-2 text-xs text-white outline-none placeholder:text-[#666] focus:border-blue-400/50"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={createFile}
              disabled={saving || !newFilePath.trim()}
            >
              <FilePlus2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
            Projects
          </div>
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  const nextFile =
                    project.files.find(
                      (file) => file.path === project.entryFile,
                    ) || project.files[0];
                  setActiveProjectId(project.id);
                  setActiveFilePath(nextFile?.path || 'index.html');
                }}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition',
                  project.id === activeProject.id
                    ? 'border-blue-400/50 bg-blue-500/10'
                    : 'border-transparent hover:border-[#2a2a2a] hover:bg-[#171717]',
                )}
              >
                <div className="truncate text-sm font-medium">
                  {project.title}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {formatTime(project.updatedAt)}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 mb-2 px-1 text-xs font-medium text-muted-foreground">
            Files
          </div>
          <div className="space-y-1">
            {activeProject.files.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setActiveFilePath(file.path)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                  file.path === activeFilePath
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-muted-foreground hover:bg-[#171717] hover:text-white',
                )}
              >
                <Code2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{file.path}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#2a2a2a] px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">
                {activeProject.title}
              </h1>
              {dirty && (
                <span className="rounded-full border border-blue-400/30 px-2 py-0.5 text-[11px] text-blue-200">
                  Unsaved
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {activeProject.rootPath}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={revealProject}>
              <FolderOpen className="h-4 w-4" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openNeuraIde}
              disabled={ideOpening}
              title={
                ideStatus?.available === false
                  ? 'Install Neura IDE or set NEURA_IDE_EXECUTABLE'
                  : ideStatus?.executablePath || 'Open in Neura IDE'
              }
            >
              {ideOpening ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Code2 className="h-4 w-4" />
              )}
              Neura IDE
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setViewMode(viewMode === 'diff' ? 'editor' : 'diff')
              }
            >
              <SplitSquareHorizontal className="h-4 w-4" />
              {viewMode === 'diff' ? 'Editor' : 'Diff'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveProject()}
              disabled={saving || !dirty}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Apply
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_220px]">
          <div className="grid min-h-0 grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
            <section className="flex min-h-0 flex-col border-r border-[#2a2a2a]">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#2a2a2a] px-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  {activeFile?.path || 'index.html'}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      createPlan(
                        'Regenerate this UI with a clean, production-quality implementation.',
                      )
                    }
                    disabled={planning}
                  >
                    <Sparkles className="h-4 w-4" />
                    Plan Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      createPlan(
                        'Find and fix bugs in this Canvas project. Preserve the intended UI.',
                      )
                    }
                    disabled={planning}
                  >
                    <Wrench className="h-4 w-4" />
                    Plan Fix
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 bg-[#0f0f0f]">
                {viewMode === 'diff' ? (
                  <DiffEditor
                    language={activeFile?.language || 'html'}
                    theme="vs-dark"
                    original={activeFile?.content || ''}
                    modified={code}
                    onMount={(editor) => {
                      editor.getModifiedEditor().onDidChangeModelContent(() => {
                        setCode(editor.getModifiedEditor().getValue());
                        setDirty(true);
                      });
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontFamily:
                        'Geist Mono, SFMono-Regular, Consolas, Liberation Mono, monospace',
                      fontSize: 13,
                      lineHeight: 22,
                      renderSideBySide: true,
                      scrollBeyondLastLine: false,
                    }}
                  />
                ) : (
                  <Editor
                    language={activeFile?.language || 'html'}
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => {
                      setCode(value || '');
                      setDirty(true);
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontFamily:
                        'Geist Mono, SFMono-Regular, Consolas, Liberation Mono, monospace',
                      fontSize: 13,
                      lineHeight: 22,
                      padding: { top: 16, bottom: 16 },
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      smoothScrolling: true,
                      renderLineHighlight: 'line',
                      overviewRulerBorder: false,
                    }}
                  />
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col bg-[#0a0a0a]">
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#2a2a2a] px-4 text-xs text-muted-foreground">
                <Eye className="h-4 w-4" />
                Live Preview
              </div>
              <iframe
                title="Neura Canvas Preview"
                srcDoc={preview}
                sandbox="allow-scripts"
                className="h-full w-full flex-1 bg-white"
              />
            </section>
          </div>

          <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] border-t border-[#2a2a2a] bg-[#0f0f0f]">
            <div className="flex min-h-0 flex-col border-r border-[#2a2a2a]">
              <div className="flex h-10 items-center justify-between border-b border-[#2a2a2a] px-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Terminal className="h-4 w-4" />
                  Terminal
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={requestCommandApproval}
                  disabled={!terminalCommand.trim() || terminalBusy}
                >
                  Request Approval
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
                {pendingCommand && (
                  <div className="mb-3 rounded-lg border border-blue-400/30 bg-blue-500/10 p-3">
                    <div className="text-blue-200">Approve command</div>
                    <div className="mt-2 break-all text-white">
                      {pendingCommand}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        onClick={runApprovedCommand}
                        disabled={terminalBusy}
                      >
                        {terminalBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Approve & Run
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingCommand('')}
                        disabled={terminalBusy}
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                )}
                {(activeProject.terminalRuns || []).length ? (
                  <div className="space-y-3">
                    {activeProject.terminalRuns.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] p-3"
                      >
                        <div className="flex items-center justify-between gap-3 text-muted-foreground">
                          <span className="truncate">$ {run.command}</span>
                          <span
                            className={cn(
                              'shrink-0',
                              run.exitCode === 0
                                ? 'text-emerald-400'
                                : 'text-red-400',
                            )}
                          >
                            exit {run.exitCode ?? 'n/a'}
                          </span>
                        </div>
                        {run.stdout && (
                          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[#d4d4d4]">
                            {run.stdout}
                          </pre>
                        )}
                        {run.stderr && (
                          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-red-300">
                            {run.stderr}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    Approved command output appears here.
                  </div>
                )}
              </div>
              <div className="flex h-11 shrink-0 gap-2 border-t border-[#2a2a2a] p-2">
                <input
                  value={terminalCommand}
                  onChange={(event) => setTerminalCommand(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      requestCommandApproval();
                    }
                  }}
                  placeholder="npm run build"
                  className="h-7 min-w-0 flex-1 rounded-md border border-[#2a2a2a] bg-[#111] px-2 font-mono text-xs text-white outline-none placeholder:text-[#666] focus:border-blue-400/50"
                />
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <History className="h-4 w-4" />
                Version History
              </div>
              <div className="space-y-2">
                {activeProject.versions.slice(0, 8).map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => restoreVersion(version)}
                    className="w-full rounded-lg border border-[#2a2a2a] bg-[#171717] p-3 text-left transition hover:border-blue-400/40"
                  >
                    <div className="flex items-center gap-2 text-sm text-white">
                      <GitBranch className="h-4 w-4 text-blue-300" />
                      <span className="truncate">{version.label}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatTime(version.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[#2a2a2a] bg-[#0f0f0f]">
        <div className="border-b border-[#2a2a2a] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-blue-300" />
            Composer Mode
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Generate a plan, approve it, then let Neura edit files and verify in
            the background.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <textarea
            value={composerPrompt}
            onChange={(event) => setComposerPrompt(event.target.value)}
            placeholder="Add authentication, fix the landing page, migrate this to React..."
            className="h-28 w-full resize-none rounded-lg border border-[#2a2a2a] bg-[#111] p-3 text-sm text-white outline-none placeholder:text-[#666] focus:border-blue-400/50"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => createPlan()}
              disabled={!composerPrompt.trim() || planning}
            >
              {planning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Plan
            </Button>
            <Button
              onClick={() => queueComposerTask(composerPrompt)}
              disabled={!composerPrompt.trim() || queueing}
            >
              {queueing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Agent Mode
            </Button>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Current Plan
            </div>
            {activePlan ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-[#2a2a2a] bg-[#171717] p-3">
                  <div className="text-sm text-white">{activePlan.prompt}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {activePlan.status} · {formatTime(activePlan.updatedAt)}
                  </div>
                </div>
                {activePlan.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#2a2a2a] text-[11px] text-muted-foreground">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">
                          {step.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {step.detail}
                        </div>
                        {step.filePaths?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {step.filePaths.map((filePath) => (
                              <span
                                key={filePath}
                                className="rounded border border-[#2a2a2a] px-1.5 py-0.5 text-[11px] text-blue-200"
                              >
                                {filePath}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#2a2a2a] p-4 text-sm text-muted-foreground">
                No plan yet. Describe the change and click Plan.
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[#2a2a2a] p-3">
          <Button
            className="w-full"
            onClick={() =>
              queueComposerTask(
                'Make this Canvas UI darker, cleaner, and closer to Neura developer-tool standards.',
              )
            }
            disabled={queueing}
          >
            <Play className="h-4 w-4" />
            Iterate Current UI
          </Button>
        </div>
      </aside>
    </div>
  );
}
