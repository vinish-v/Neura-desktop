/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { FormEvent, memo, useMemo, useState } from 'react';
import {
  Bell,
  Boxes,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  GitBranch,
  Play,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useSetting } from '@renderer/hooks/useSetting';
import {
  BackgroundTaskRecord,
  TaskArtifact,
  TaskProgressItem,
  TaskRunRecord,
} from '@main/store/types';

const statusClass = {
  queued: 'border-white/10 bg-white/[0.035] text-muted-foreground',
  pending: 'border-white/10 bg-white/[0.035] text-muted-foreground',
  running: 'border-blue-400/25 bg-blue-400/10 text-blue-100',
  completed: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  failed: 'border-red-400/30 bg-red-400/10 text-red-100',
  cancelled: 'border-zinc-500/25 bg-zinc-500/10 text-zinc-200',
};

const formatDate = (value?: number) =>
  value ? new Date(value).toLocaleString() : 'Not started';

const AgentFlow = memo(({ progress }: { progress: TaskProgressItem[] }) => {
  const activeAgents = new Set(
    progress
      .map((item) => item.agentName)
      .filter((agentName): agentName is NonNullable<typeof agentName> =>
        Boolean(agentName),
      ),
  );
  const agents = ['planner', 'researcher', 'executor', 'critic'] as const;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {agents.map((agent, index) => (
        <div key={agent} className="flex items-center gap-2">
          <div
            className={`rounded-md border px-3 py-2 text-xs font-medium capitalize ${
              activeAgents.has(agent)
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.035] text-muted-foreground'
            }`}
          >
            {agent}
          </div>
          {index < agents.length - 1 && (
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  );
});

AgentFlow.displayName = 'AgentFlow';

const QueueForm = () => {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed) {
      return;
    }
    setSubmitting(true);
    try {
      await api.queueBackgroundTask({
        kind: 'multi_agent',
        goal: trimmed,
      });
      setGoal('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Boxes className="h-4 w-4" />
        Queue Multi-Agent Task
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Ask Neura to research, plan, execute, and verify..."
          className="min-h-10 flex-1 rounded-md border border-white/10 bg-black px-3 text-sm text-white outline-none placeholder:text-muted-foreground focus:border-white/25"
        />
        <Button
          type="submit"
          disabled={submitting || !goal.trim()}
          className="h-10"
        >
          <Play className="h-4 w-4" />
          Queue
        </Button>
      </div>
    </form>
  );
};

const BackgroundQueue = ({ tasks }: { tasks: BackgroundTaskRecord[] }) => {
  if (!tasks.length) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Bell className="h-4 w-4" />
          Background Queue
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No background tasks are queued.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Bell className="h-4 w-4" />
        Background Queue
      </div>
      <div className="grid gap-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="rounded-md border border-white/10 bg-black/30 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{task.goal}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {task.kind.replace(/_/g, ' ')} · {formatDate(task.startedAt)}
                </div>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] uppercase ${statusClass[task.status]}`}
              >
                {task.status}
              </span>
            </div>
            {task.error && (
              <div className="mt-2 text-xs text-red-200">{task.error}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

const ArtifactViewer = ({ artifacts }: { artifacts: TaskArtifact[] }) => {
  if (!artifacts.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <FileText className="h-4 w-4" />
        Artifacts
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {artifacts.map((artifact) => (
          <div
            key={artifact.id}
            className="rounded-md border border-white/10 bg-black/30 p-3"
          >
            <div className="truncate text-sm text-white">{artifact.title}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {artifact.path}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={() => api.revealPath({ path: artifact.path })}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Reveal
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={() => api.openPath({ path: artifact.path })}
              >
                Open
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const RunPanel = ({ run }: { run: TaskRunRecord }) => {
  const StatusIcon =
    run.status === 'completed'
      ? CheckCircle2
      : run.status === 'failed' || run.status === 'cancelled'
        ? XCircle
        : Clock;

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-black/30 p-2">
          <StatusIcon className="h-4 w-4 text-white/80" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-white">
              {run.originalGoal}
            </h2>
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] uppercase ${statusClass[run.status]}`}
            >
              {run.status}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] uppercase text-muted-foreground">
              {run.runMode.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Started {formatDate(run.startedAt)}
          </div>
          <div className="mt-4">
            <AgentFlow progress={run.progressItems} />
          </div>
          {run.currentStep && (
            <div className="mt-4 rounded-md border border-white/10 bg-black/25 p-3 text-sm text-muted-foreground">
              {run.currentStep}
            </div>
          )}
          {run.finalAnswer && (
            <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">
              {run.finalAnswer}
            </p>
          )}
          <div className="mt-4 grid gap-2">
            {run.progressItems.slice(-6).map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-white/10 bg-black/20 p-2"
              >
                <div className="text-xs font-medium text-white">
                  {item.title}
                </div>
                {item.detail && (
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
};

export default function Dashboard() {
  const { settings } = useSetting();
  const runs = useMemo(
    () =>
      ([...(settings.taskRuns || [])] as TaskRunRecord[]).sort(
        (a, b) => b.startedAt - a.startedAt,
      ),
    [settings.taskRuns],
  );
  const backgroundTasks = useMemo(
    () =>
      ([...(settings.backgroundTasks || [])] as BackgroundTaskRecord[]).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [settings.backgroundTasks],
  );
  const activeRuns = runs.filter((run) => run.status === 'running');
  const completedRuns = runs
    .filter((run) => run.status !== 'running')
    .slice(0, 8);
  const recentArtifacts = runs.flatMap((run) => run.artifacts).slice(0, 8);

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Active agents, background queue, task history, and generated
            artifacts.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <QueueForm />
            <section>
              <div className="mb-3 text-sm font-semibold text-white">
                Active Tasks
              </div>
              <div className="grid gap-3">
                {activeRuns.length ? (
                  activeRuns.map((run) => (
                    <RunPanel key={run.runId} run={run} />
                  ))
                ) : (
                  <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm text-muted-foreground">
                    No tasks are currently running.
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className="mb-3 text-sm font-semibold text-white">
                Recent History
              </div>
              <div className="grid gap-3">
                {completedRuns.map((run) => (
                  <RunPanel key={run.runId} run={run} />
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <BackgroundQueue tasks={backgroundTasks} />
            <ArtifactViewer artifacts={recentArtifacts} />
          </div>
        </div>
      </div>
    </div>
  );
}
