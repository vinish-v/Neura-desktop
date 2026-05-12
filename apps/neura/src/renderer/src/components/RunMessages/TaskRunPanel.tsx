/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileText,
  FolderOpen,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { TaskState } from '@main/store/types';
import { cn } from '@renderer/utils';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';

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
  const finalAnswer = publicFinalAnswer(taskState?.finalAnswer);
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

  const StatusIcon = statusIcon[taskState.status] || Loader2;
  const artifacts = taskState.artifacts.slice(-6);
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
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" />
            Artifacts
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

      {finalAnswer && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Final answer
          </div>
          <div className="max-h-[50vh] min-h-[96px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] px-3 py-2 text-sm leading-6 text-white/85">
            {finalAnswer}
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
    </section>
  );
}
