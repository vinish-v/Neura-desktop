/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Play,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useSetting } from '@renderer/hooks/useSetting';
import { TaskRunRecord } from '@main/store/types';

const statusIcon = {
  pending: Clock,
  running: Clock,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
};

const formatDate = (value?: number) =>
  value ? new Date(value).toLocaleString() : 'Not finished';

const RunCard = ({ run }: { run: TaskRunRecord }) => {
  const StatusIcon = statusIcon[run.status] || Clock;
  const retryRun = async () => {
    await api.setInstructions({ instructions: run.originalGoal });
    await api.runAgent();
  };
  const exportSummary = async () => {
    const outputPath = await api.exportRunSummary({ runId: run.runId });
    await api.revealPath({ path: outputPath });
  };

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-md bg-black/20 p-2">
          <StatusIcon className="h-4 w-4 text-teal-200" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-white">
              {run.originalGoal}
            </h2>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
              {run.runMode.replace(/_/g, ' ')}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
              {run.status}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={retryRun}
            >
              <Play className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={exportSummary}
            >
              <Download className="h-3.5 w-3.5" />
              Export Summary
            </Button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDate(run.startedAt)} to {formatDate(run.completedAt)}
          </div>

          {run.finalAnswer && (
            <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
              {run.finalAnswer}
            </p>
          )}

          {run.sourcesVisited.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
                Sources
              </div>
              <div className="space-y-1">
                {run.sourcesVisited.slice(0, 4).map((source) => (
                  <div
                    key={source}
                    className="truncate text-xs text-blue-200"
                    title={source}
                  >
                    {source}
                  </div>
                ))}
              </div>
            </div>
          )}

          {run.artifacts.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Artifacts
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {run.artifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className="rounded-md border border-white/10 bg-black/10 p-2"
                    title={artifact.path}
                  >
                    <div className="truncate text-xs text-white">
                      {artifact.title}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {artifact.path}
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => api.revealPath({ path: artifact.path })}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
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

          {run.approvalEvents.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Approvals
              </div>
              <div className="flex flex-wrap gap-2">
                {run.approvalEvents.map((event) => (
                  <span
                    key={event.id}
                    className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-muted-foreground"
                    title={event.target}
                  >
                    {event.action}: {event.status.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

export default function Projects() {
  const { settings } = useSetting();
  const runs = ([...(settings.taskRuns || [])] as TaskRunRecord[]).sort(
    (a, b) => b.startedAt - a.startedAt,
  );

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run history, artifacts, sources, and approval trail.
          </p>
        </div>
        <div className="space-y-3">
          {runs.length ? (
            runs.map((run) => <RunCard key={run.runId} run={run} />)
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/[0.055] p-8 text-center text-sm text-muted-foreground">
              No runs yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
