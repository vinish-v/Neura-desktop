/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FileImage,
  FileSearch,
  FileText,
  FolderOpen,
  Loader2,
  MonitorPlay,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { TaskState } from '@main/store/types';
import { cn } from '@renderer/utils';
import { api } from '@renderer/api';
import { Markdown } from '@renderer/components/markdown';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

type ArtifactPreviewState = {
  title: string;
  path: string;
  kind: 'text' | 'binary' | 'unsupported';
  text?: string;
  dataUrl?: string;
  mimeType?: string;
  reason?: string;
};

type WorkspaceEntry = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: number;
};

type WorkspaceRoot = {
  rootPath: string;
  entries: WorkspaceEntry[];
};

const statusIcon = {
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: AlertCircle,
  cancelled: AlertCircle,
};

const DEBUG_PROGRESS_PATTERN =
  /\b(regex|pattern|validator|validated \d+ local computer actor|command output contains|planner checklist|planner step|raw|screenshot observed|predictionParsed|FullyQualifiedErrorId|CategoryInfo)\b|previous response was not executable|authorized benign UI automation|Action Space|previous action had invalid coordinates|browser state has not changed after repeated actions|previous browser DOM action could not be executed|continue autonomously: take a fresh screenshot\/DOM map|do not finish with this recovery message|element id was stale|take a fresh screenshot\/DOM map|Could not (?:type into|click) that DOM element|Refresh the DOM map or use coordinate click\/type|reply with finished\(content=|visible current DOM element/i;

const cleanProgressText = (value?: string) =>
  (value || '')
    .replace(/\s+/g, ' ')
    .replace(/^step (started|completed)\s*-\s*/i, '')
    .trim();

const publicProgressTitle = (title: string) => {
  if (/local validator passed/i.test(title)) {
    return 'Checked the result';
  }
  if (/run_command completed/i.test(title)) {
    return 'Command completed';
  }
  if (/process_worker:\s*run_command/i.test(title)) {
    return 'Running command';
  }
  if (/visual_worker:/i.test(title)) {
    return title.replace(/^visual_worker:\s*/i, 'Computer action: ');
  }
  if (/local computer actor plan/i.test(title)) {
    return 'Prepared local computer task';
  }
  return title;
};

const publicProgressDetail = (detail?: string) => {
  const cleaned = cleanProgressText(detail);
  if (!cleaned || DEBUG_PROGRESS_PATTERN.test(cleaned)) {
    return undefined;
  }
  return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
};

const publicFinalAnswer = (answer?: string) => {
  const cleaned = (answer || '').trim();
  return cleaned && !DEBUG_PROGRESS_PATTERN.test(cleaned) ? cleaned : '';
};

export function TaskRunPanel({ taskState }: { taskState: TaskState | null }) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [previewState, setPreviewState] = useState<ArtifactPreviewState | null>(
    null,
  );
  const [workspaceState, setWorkspaceState] = useState<WorkspaceRoot[]>([]);
  const finalAnswer = publicFinalAnswer(taskState?.finalAnswer);
  const artifacts = taskState?.artifacts.slice(-6) || [];
  const todoItems = taskState?.todoItems || [];
  const latestProgress = useMemo(
    () =>
      (taskState?.progressItems || [])
        .map((item) => ({
          ...item,
          title: publicProgressTitle(item.title),
          detail: publicProgressDetail(item.detail),
        }))
        .filter(
          (item) =>
            item.status === 'failed' ||
            !DEBUG_PROGRESS_PATTERN.test(item.title),
        )
        .slice(-5),
    [taskState?.progressItems],
  );

  if (!taskState) {
    return null;
  }

  const previewArtifact = async (artifact: (typeof artifacts)[number]) => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const preview = await api.readArtifactPreview({ path: artifact.path });
      if (preview.kind === 'text') {
        setPreviewState({
          title: artifact.title,
          path: artifact.path,
          kind: 'text',
          text: preview.text,
          mimeType: preview.mimeType,
        });
        return;
      }
      if (preview.kind === 'binary') {
        setPreviewState({
          title: artifact.title,
          path: artifact.path,
          kind: 'binary',
          dataUrl: preview.dataUrl,
          mimeType: preview.mimeType,
        });
        return;
      }
      setPreviewState({
        title: artifact.title,
        path: artifact.path,
        kind: 'unsupported',
        reason: preview.reason,
      });
    } catch (error) {
      setPreviewState({
        title: artifact.title,
        path: artifact.path,
        kind: 'unsupported',
        reason:
          error instanceof Error
            ? error.message
            : 'Unable to preview this artifact.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openWorkspaceExplorer = async () => {
    setWorkspaceOpen(true);
    setWorkspaceLoading(true);
    try {
      const roots = await api.listWorkspaceEntries({
        paths: artifacts.map((artifact) => artifact.path),
      });
      setWorkspaceState(roots);
    } catch {
      setWorkspaceState([]);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const formatBytes = (value: number) => {
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const StatusIcon = statusIcon[taskState.status] || Loader2;
  const requestedApprovals = taskState.approvalEvents.filter(
    (event) => event.status === 'requested',
  );

  return (
    <section className="neura-glass mb-4 rounded-2xl p-4 text-sm">
      <div className="flex items-center gap-3 text-white">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
          <StatusIcon
            className={cn(
              'h-4 w-4',
              taskState.status === 'running'
                ? 'animate-spin text-blue-300'
                : '',
              taskState.status === 'completed' ? 'text-emerald-300' : '',
              taskState.status === 'failed' ? 'text-red-300' : '',
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-base font-semibold">
            {taskState.runMode.replace(/_/g, ' ')}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {taskState.runId}
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-3 py-1 text-xs capitalize',
            taskState.status === 'running' &&
              'border-blue-300/25 bg-blue-300/10 text-blue-100',
            taskState.status === 'completed' &&
              'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
            taskState.status === 'failed' &&
              'border-red-300/25 bg-red-300/10 text-red-100',
            taskState.status === 'pending' &&
              'border-white/10 bg-white/5 text-muted-foreground',
          )}
        >
          {taskState.status}
        </span>
      </div>

      {finalAnswer && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Final answer
          </div>
          <div className="max-h-[72vh] min-h-[140px] overflow-y-auto rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-3 text-sm leading-6 text-white/85">
            <div className="break-words [&_li]:my-1 [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_ul]:pl-5">
              <Markdown>{finalAnswer}</Markdown>
            </div>
          </div>
        </div>
      )}

      {todoItems.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Steps
          </div>
          <div className="grid gap-2">
            {todoItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    item.status === 'done' &&
                      'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
                    item.status === 'failed' &&
                      'border-red-400/40 bg-red-400/10 text-red-200',
                    item.status === 'in_progress' &&
                      'border-blue-400/40 bg-blue-400/10 text-blue-200',
                    item.status === 'pending' &&
                      'border-white/10 bg-white/5 text-muted-foreground',
                  )}
                >
                  {item.status === 'done' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : item.status === 'in_progress' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : item.status === 'failed' ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : null}
                </span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {latestProgress.length > 0 && (
        <div className="mt-4 space-y-2">
          {latestProgress.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-black/10 px-3 py-2"
            >
              <div className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                    item.status === 'done' && 'bg-emerald-400',
                    item.status === 'failed' && 'bg-red-400',
                    item.status === 'in_progress' && 'bg-blue-400',
                    item.status === 'pending' && 'bg-slate-400',
                  )}
                />
                <span className="min-w-0 break-words text-muted-foreground">
                  {item.title}
                </span>
              </div>
              {item.detail && (
                <div className="mt-1 whitespace-pre-wrap break-words pl-3.5 text-[11px] leading-4 text-muted-foreground">
                  {item.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {taskState.progressItems.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-white"
            onClick={() => setShowDiagnostics((value) => !value)}
          >
            {showDiagnostics ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Diagnostics
          </Button>
          {showDiagnostics && (
            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] leading-4 text-muted-foreground">
              {taskState.progressItems.slice(-12).map((item) => (
                <div key={item.id} className="mb-2 last:mb-0">
                  <div className="text-white/70">
                    {item.status}: {item.title}
                  </div>
                  {item.detail ? (
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {item.detail}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
              Artifacts
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={openWorkspaceExplorer}
            >
              <FileSearch className="h-3.5 w-3.5" />
              Browse workspace
            </Button>
          </div>
          <div className="grid gap-2">
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5"
                title={artifact.path}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-blue-300" />
                  <span className="truncate text-xs text-white">
                    {artifact.title}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
                    {artifact.kind}
                  </span>
                </div>
                <div className="mt-1 truncate pl-5 text-[11px] text-muted-foreground">
                  {artifact.path}
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => void previewArtifact(artifact)}
                  >
                    <MonitorPlay className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => api.revealPath({ path: artifact.path })}
                  >
                    Reveal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => api.openPath({ path: artifact.path })}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {taskState.approvalEvents.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Approval Events
          </div>
          <div className="space-y-2">
            {taskState.approvalEvents.slice(-4).map((event) => (
              <div
                key={event.id}
                className="rounded-md border border-white/10 bg-black/10 px-2 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-white">{event.action}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-2 py-0.5 text-[10px] uppercase',
                      event.status === 'requested' &&
                        'bg-amber-400/15 text-amber-200',
                      event.status === 'approved' &&
                        'bg-emerald-400/15 text-emerald-200',
                      event.status === 'denied' && 'bg-red-400/15 text-red-200',
                      event.status === 'auto_approved' &&
                        'bg-blue-400/15 text-blue-200',
                    )}
                  >
                    {event.status.replace('_', ' ')}
                  </span>
                </div>
                {event.target && (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {event.target}
                  </div>
                )}
                {event.status === 'requested' && (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        api.resolveApproval({
                          runId: taskState.runId,
                          eventId: event.id,
                          approved: false,
                        })
                      }
                    >
                      Deny
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        api.resolveApproval({
                          runId: taskState.runId,
                          eventId: event.id,
                          approved: true,
                        })
                      }
                    >
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {requestedApprovals.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-200">
              Agent execution is waiting for your approval.
            </div>
          )}
        </div>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden border border-white/20 bg-black/95 text-white">
          <DialogHeader>
            <DialogTitle className="truncate">
              {previewState?.title}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {previewState?.path}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-[68vh] overflow-auto rounded-md border border-white/10 bg-black/40 p-3">
            {previewLoading && (
              <div className="text-sm text-muted-foreground">
                Loading preview...
              </div>
            )}
            {!previewLoading && previewState?.kind === 'text' && (
              <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-white/90">
                {previewState.text}
              </pre>
            )}
            {!previewLoading &&
              previewState?.kind === 'binary' &&
              previewState.mimeType?.startsWith('image/') && (
                <img
                  src={previewState.dataUrl}
                  alt={previewState.title}
                  className="max-h-[64vh] w-auto max-w-full rounded-md border border-white/10"
                />
              )}
            {!previewLoading &&
              previewState?.kind === 'binary' &&
              previewState.mimeType === 'application/pdf' && (
                <iframe
                  src={previewState.dataUrl}
                  title={previewState.title}
                  className="h-[64vh] w-full rounded-md border border-white/10 bg-white"
                />
              )}
            {!previewLoading && previewState?.kind === 'unsupported' && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <div>{previewState.reason || 'Preview is not available.'}</div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      previewState?.path &&
                      api.revealPath({ path: previewState.path })
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Reveal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      previewState?.path &&
                      api.openPath({ path: previewState.path })
                    }
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open externally
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-hidden border border-white/20 bg-black/95 text-white">
          <DialogHeader>
            <DialogTitle>Workspace Explorer</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Browse generated files and artifacts for this run.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 h-[68vh] overflow-auto space-y-4 rounded-md border border-white/10 bg-black/40 p-3">
            {workspaceLoading && (
              <div className="text-sm text-muted-foreground">
                Loading workspace...
              </div>
            )}
            {!workspaceLoading && workspaceState.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No workspace files were found for this run.
              </div>
            )}
            {!workspaceLoading &&
              workspaceState.map((root) => (
                <section
                  key={root.rootPath}
                  className="rounded-md border border-white/10 bg-black/20 p-3"
                >
                  <div className="mb-2 break-words text-xs text-blue-200">
                    {root.rootPath}
                  </div>
                  <div className="space-y-2">
                    {root.entries.map((entry) => (
                      <div
                        key={entry.path}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5"
                      >
                        {entry.type === 'directory' ? (
                          <FolderOpen className="h-3.5 w-3.5 text-blue-300" />
                        ) : entry.name.match(
                            /\.(png|jpg|jpeg|webp|gif|svg)$/i,
                          ) ? (
                          <FileImage className="h-3.5 w-3.5 text-emerald-300" />
                        ) : (
                          <FileCode2 className="h-3.5 w-3.5 text-slate-300" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-white">
                          {entry.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {entry.type === 'file'
                            ? formatBytes(entry.sizeBytes)
                            : 'dir'}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(entry.modifiedAt).toLocaleString()}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => api.revealPath({ path: entry.path })}
                        >
                          Reveal
                        </Button>
                        {entry.type === 'file' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              void previewArtifact({
                                id: entry.path,
                                title: entry.name,
                                kind: 'other',
                                path: entry.path,
                                sourceRunId: taskState.runId,
                                createdAt: entry.modifiedAt,
                              })
                            }
                          >
                            Preview
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
