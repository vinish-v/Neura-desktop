/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import {
  Code2,
  Eye,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  Play,
  Plus,
  Save,
  Send,
  Sparkles,
  Wrench,
} from 'lucide-react';
import Editor from '@monaco-editor/react';
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

type CanvasProject = {
  id: string;
  title: string;
  rootPath: string;
  entryFile: string;
  files: CanvasProjectFile[];
  versions: CanvasProjectVersion[];
  createdAt: number;
  updatedAt: number;
};

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));

const canvasGoal = (
  project: CanvasProject,
  filePath: string,
  instruction: string,
) => `Work inside the Neura Canvas project at ${project.rootPath}.
Primary file: ${filePath}.
Instruction: ${instruction}

Update the project files directly, preserve existing behavior unless the instruction says otherwise, and save the result as artifacts that can be reopened in Neura Canvas.`;

export default function Canvas() {
  const location = useLocation();
  const requestedProjectId = (location.state as { projectId?: string } | null)
    ?.projectId;
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeFilePath, setActiveFilePath] = useState('index.html');
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState(false);
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
  const preview = useMemo(() => {
    if (!activeFile) {
      return '';
    }
    if (activeFile.language === 'html' || activeFile.path.endsWith('.html')) {
      return code;
    }
    return `<pre style="margin:0;min-height:100vh;padding:24px;background:#0a0a0a;color:#fff;font:13px/1.7 Geist Mono,Consolas,monospace;white-space:pre-wrap;">${code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;
  }, [activeFile, code]);

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
    return list;
  };

  useEffect(() => {
    (async () => {
      try {
        await refreshProjects(requestedProjectId);
      } catch (error) {
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
  }, [activeFile?.path, activeProject?.id]);

  const createProject = async () => {
    setSaving(true);
    try {
      const project = await api.createCanvasProject({
        title: 'Untitled Canvas',
      });
      await refreshProjects(project.id);
      toast.success('Canvas project created.');
    } catch (error) {
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
      setProjects((current) =>
        [project, ...current.filter((item) => item.id !== project.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
      setActiveProjectId(project.id);
      setDirty(false);
      toast.success('Canvas project saved.');
      return project;
    } catch (error) {
      toast.error('Could not save Canvas project.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const queueCanvasTask = async (instruction: string) => {
    if (!activeProject || !activeFile) {
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) {
      return;
    }

    setQueueing(true);
    try {
      const savedProject = dirty
        ? await saveProject('Saved before Canvas task')
        : activeProject;
      if (!savedProject) {
        return;
      }

      await api.queueBackgroundTask({
        kind: 'multi_agent',
        goal: canvasGoal(savedProject, activeFile.path, trimmed),
      });
      setPrompt('');
      toast.success('Canvas task queued.');
    } catch (error) {
      toast.error('Could not queue Canvas task.');
    } finally {
      setQueueing(false);
    }
  };

  const restoreVersion = async (version: CanvasProjectVersion) => {
    const file =
      version.files.find((item) => item.path === activeFilePath) ||
      version.files[0];
    if (!file || !activeProject) {
      return;
    }
    setCode(file.content);
    setActiveFilePath(file.path);
    setDirty(true);
    toast.info('Version loaded. Save to apply it to the project.');
  };

  const revealProject = async () => {
    if (!activeProject) {
      return;
    }
    await api.revealCanvasProject({ projectId: activeProject.id });
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
            Create a project to edit code, preview UI, and send iteration work
            to Neura&apos;s background agents.
          </p>
          <Button className="mt-5" onClick={createProject} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Canvas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] bg-[#0a0a0a] text-white">
      <aside className="flex min-h-0 flex-col border-r border-[#2a2a2a] bg-[#0f0f0f]">
        <div className="border-b border-[#2a2a2a] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Canvas</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {projects.length} project{projects.length === 1 ? '' : 's'}
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={createProject}
              disabled={saving}
            >
              <Plus className="h-4 w-4" />
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
              onClick={() => saveProject()}
              disabled={saving || !dirty}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Apply to Project
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(340px,3fr)]">
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
                    queueCanvasTask(
                      'Regenerate this UI with a clean, production-quality implementation.',
                    )
                  }
                  disabled={queueing}
                >
                  <Sparkles className="h-4 w-4" />
                  Regenerate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    queueCanvasTask(
                      'Find and fix bugs in this Canvas project. Preserve the intended UI.',
                    )
                  }
                  disabled={queueing}
                >
                  <Wrench className="h-4 w-4" />
                  Fix Bug
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-[#0f0f0f]">
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
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-[#2a2a2a] bg-[#0a0a0a] p-3">
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void queueCanvasTask(prompt);
                  }
                }}
                placeholder="Iterate with prompt..."
                className="h-9 flex-1 rounded-md border border-[#2a2a2a] bg-[#171717] px-3 text-sm text-white outline-none placeholder:text-muted-foreground focus:border-blue-400/50"
              />
              <Button
                size="sm"
                onClick={() => queueCanvasTask(prompt)}
                disabled={!prompt.trim() || queueing}
              >
                {queueing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send to Neura
              </Button>
            </div>
          </section>

          <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_240px] bg-[#0a0a0a]">
            <section className="flex min-h-0 flex-col">
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

            <section className="min-h-0 border-t border-[#2a2a2a] bg-[#0f0f0f]">
              <div className="flex h-10 items-center justify-between border-b border-[#2a2a2a] px-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <History className="h-4 w-4" />
                  Version History
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    queueCanvasTask(
                      'Make this Canvas UI darker, cleaner, and closer to Neura’s dark developer-tool design system.',
                    )
                  }
                  disabled={queueing}
                >
                  <Play className="h-4 w-4" />
                  Make Darker
                </Button>
              </div>
              <div className="h-[198px] overflow-y-auto p-3">
                <div className="space-y-2">
                  {activeProject.versions.map((version) => (
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
          </aside>
        </div>
      </section>
    </div>
  );
}
