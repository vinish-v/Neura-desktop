/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ComponentType, FormEvent, memo, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  ListChecks,
  PauseCircle,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  TerminalSquare,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';
import ImageGallery from '@renderer/components/ImageGallery';
import { TaskRunPanel } from '@renderer/components/RunMessages/TaskRunPanel';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/utils';
import { useSetting } from '@renderer/hooks/useSetting';
import { useStore } from '@renderer/hooks/useStore';
import {
  BackgroundTaskRecord,
  TaskState,
  TaskRunRecord,
  TaskSourceRecord,
} from '@main/store/types';

const statusClass = {
  queued: 'border-white/10 bg-white/[0.035] text-muted-foreground',
  pending: 'border-white/10 bg-white/[0.035] text-muted-foreground',
  running: 'border-blue-400/25 bg-blue-400/10 text-blue-100',
  completed: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  failed: 'border-red-400/30 bg-red-400/10 text-red-100',
  cancelled: 'border-zinc-500/25 bg-zinc-500/10 text-zinc-200',
};

const promptSeeds = [
  {
    label: 'Research',
    value:
      'Research this deeply using credible sources, save evidence, and return a cited final answer: ',
  },
  {
    label: 'Use Browser',
    value:
      'Use my local browser session. Ask for takeover only if authentication or a sensitive action blocks you: ',
  },
  {
    label: 'Work Locally',
    value:
      'Use local files and tools, show evidence, and produce artifacts only after validation: ',
  },
];

const formatDate = (value?: number) =>
  value ? new Date(value).toLocaleString() : 'Not started';

const formatDuration = (startedAt?: number, completedAt?: number) => {
  if (!startedAt) {
    return '0m';
  }
  const end = completedAt || Date.now();
  const totalSeconds = Math.max(0, Math.round((end - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const sectionClass =
  'rounded-lg border border-white/10 bg-[#0b0b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]';

const SectionTitle = ({
  icon: Icon,
  title,
  meta,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  meta?: string;
}) => (
  <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
    <Icon className="h-4 w-4 text-white/70" />
    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
      {title}
    </div>
    {meta ? (
      <span className="shrink-0 text-[11px] uppercase text-muted-foreground">
        {meta}
      </span>
    ) : null}
  </div>
);

const RunPrompt = memo(() => {
  const [goal, setGoal] = useState('');
  const [queueing, setQueueing] = useState(false);
  const [running, setRunning] = useState(false);

  const runNow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed) {
      return;
    }
    setRunning(true);
    try {
      await api.setInstructions({ instructions: trimmed });
      await api.runAgent();
      setGoal('');
    } finally {
      setRunning(false);
    }
  };

  const queue = async () => {
    const trimmed = goal.trim();
    if (!trimmed) {
      return;
    }
    setQueueing(true);
    try {
      await api.queueBackgroundTask({
        kind: 'multi_agent',
        goal: trimmed,
      });
      setGoal('');
    } finally {
      setQueueing(false);
    }
  };

  const applySeed = (value: string) => {
    setGoal((current) => (current.trim() ? `${value}${current}` : value));
  };

  return (
    <form onSubmit={runNow} className="flex min-h-0 flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold leading-tight text-white">
          Agent Workspace
        </h1>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Give Neura a goal. It plans, operates the local browser or desktop,
          records evidence, and hands back artifacts you can inspect.
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-black p-2">
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Ask Neura to complete a real task..."
          className="min-h-28 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-2 pt-2">
          {promptSeeds.map((seed) => (
            <Button
              key={seed.label}
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-white/10 hover:text-white"
              onClick={() => applySeed(seed.value)}
            >
              {seed.label}
            </Button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={running || queueing || !goal.trim()}
              className="h-8"
              onClick={queue}
            >
              <Boxes className="h-3.5 w-3.5" />
              Queue
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={running || queueing || !goal.trim()}
              className="h-8"
            >
              <Send className="h-3.5 w-3.5" />
              Run
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
});

RunPrompt.displayName = 'RunPrompt';

const RuntimeControls = memo(() => {
  const taskState = useStore((state) => state.taskState);
  const computerRuntime = useStore((state) => state.computerRuntime);
  const thinking = useStore((state) => state.thinking);
  const paused = computerRuntime?.status === 'paused';
  const status = taskState?.status || computerRuntime?.status || 'idle';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#0b0b0b] px-3 py-2">
      <span
        className={cn(
          'rounded-md border px-2 py-1 text-[11px] uppercase',
          taskState?.status && statusClass[taskState.status],
          !taskState?.status && 'border-white/10 bg-white/[0.035] text-white/60',
        )}
      >
        {status}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {taskState?.phase || computerRuntime?.activity || 'Ready for local work'}
        {taskState?.activeAgent ? ` / ${taskState.activeAgent}` : ''}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          disabled={!thinking}
          onClick={() => api.pauseRun()}
        >
          <PauseCircle className="h-3.5 w-3.5" />
          Pause
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          disabled={!paused}
          onClick={() => api.resumeRun()}
        >
          <Play className="h-3.5 w-3.5" />
          Resume
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          disabled={!taskState || taskState.status !== 'running'}
          onClick={() => api.stopRun()}
        >
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      </div>
    </div>
  );
});

RuntimeControls.displayName = 'RuntimeControls';

const QueuePanel = memo(({ tasks }: { tasks: BackgroundTaskRecord[] }) => {
  const cancelTask = async (id: string) => {
    await api.cancelBackgroundTask({ id });
  };
  const retryTask = async (id: string) => {
    await api.retryBackgroundTask({ id });
  };

  return (
    <section className={sectionClass}>
      <SectionTitle icon={Bell} title="Queue" meta={`${tasks.length}`} />
      {!tasks.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Queued and background jobs appear here after you send a task to run
          later.
        </p>
      ) : (
        <div className="grid gap-2 p-3">
          {tasks.slice(0, 5).map((task) => (
            <div
              key={task.id}
              className="rounded-md border border-white/10 bg-black/35 p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm leading-5 text-white">
                    {task.goal}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {task.kind.replace(/_/g, ' ')} | {formatDate(task.startedAt)}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${statusClass[task.status]}`}
                >
                  {task.cancelRequested ? 'cancelling' : task.status}
                </span>
              </div>
              {task.error && (
                <div className="mt-2 text-xs text-red-200">{task.error}</div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                {(task.status === 'queued' || task.status === 'running') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => cancelTask(task.id)}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
                {task.status !== 'queued' && task.status !== 'running' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => retryTask(task.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

QueuePanel.displayName = 'QueuePanel';

const SourcesPanel = memo(({ sources }: { sources: TaskSourceRecord[] }) => {
  return (
    <section className={sectionClass}>
      <SectionTitle icon={ExternalLink} title="Sources" meta={`${sources.length}`} />
      {!sources.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Research URLs and captured excerpts are recorded here when Neura
          browses.
        </p>
      ) : (
        <div className="grid gap-2 p-3">
          {sources.slice(-8).map((source) => (
            <button
              type="button"
              key={source.id}
              className="min-w-0 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-left transition hover:border-blue-400/40"
              onClick={() => api.openExternal({ url: source.url })}
            >
              <div className="truncate text-xs text-blue-200">
                {source.title || source.url}
              </div>
              {source.excerpt && (
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {source.excerpt}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
});

SourcesPanel.displayName = 'SourcesPanel';

const RecentRuns = memo(({ runs }: { runs: TaskRunRecord[] }) => {
  if (!runs.length) {
    return null;
  }

  const retryRun = async (run: TaskRunRecord) => {
    await api.setInstructions({ instructions: run.originalGoal });
    await api.runAgent();
  };
  const exportRun = async (run: TaskRunRecord) => {
    const outputPath = await api.exportRunSummary({ runId: run.runId });
    await api.revealPath({ path: outputPath });
  };

  const StatusIcon = {
    completed: CheckCircle2,
    failed: AlertCircle,
    cancelled: XCircle,
    running: Clock,
    pending: Clock,
  };

  return (
    <section className={sectionClass}>
      <SectionTitle icon={Clock} title="Recent Runs" meta={`${runs.length}`} />
      <div className="grid gap-2 p-3">
        {runs.slice(0, 4).map((run) => {
          const Icon = StatusIcon[run.status] || Clock;
          return (
            <div
              key={run.runId}
              className="rounded-md border border-white/10 bg-black/35 p-3"
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/70" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm leading-5 text-white">
                    {run.originalGoal}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {run.runMode.replace(/_/g, ' ')} | {run.status} |{' '}
                    {formatDate(run.completedAt || run.startedAt)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => exportRun(run)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => retryRun(run)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});

RecentRuns.displayName = 'RecentRuns';

const ArtifactRail = memo(({ activeRun }: { activeRun: TaskRunRecord | TaskState | null }) => {
  const artifacts = activeRun?.artifacts || [];

  return (
    <section className={sectionClass}>
      <SectionTitle icon={FolderOpen} title="Artifacts" meta={`${artifacts.length}`} />
      {!artifacts.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Files, reports, exports, and generated bundles appear here after a run
          produces them.
        </p>
      ) : (
        <div className="grid gap-2 p-3">
          {artifacts.slice(-4).map((artifact) => (
            <div
              key={artifact.id}
              className="rounded-md border border-white/10 bg-black/35 p-3"
            >
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">
                    {artifact.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {artifact.path}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
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
      )}
    </section>
  );
});

ArtifactRail.displayName = 'ArtifactRail';

const RunStats = memo(({ activeRun }: { activeRun: TaskRunRecord | TaskState | null }) => {
  const stats = [
    {
      label: 'Phase',
      value: activeRun?.phase || activeRun?.status || 'Idle',
      icon: ListChecks,
    },
    {
      label: 'Sources',
      value: `${activeRun?.sourceRecords?.length || activeRun?.sourcesVisited?.length || 0}`,
      icon: Globe2,
    },
    {
      label: 'Tools',
      value: `${activeRun?.toolCalls?.length || 0}`,
      icon: TerminalSquare,
    },
    {
      label: 'Approvals',
      value: `${activeRun?.approvalEvents?.length || 0}`,
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-lg border border-white/10 bg-[#0b0b0b] px-3 py-2"
        >
          <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
            <stat.icon className="h-3.5 w-3.5" />
            {stat.label}
          </div>
          <div className="mt-1 truncate text-sm font-medium text-white">
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
});

RunStats.displayName = 'RunStats';

export default function Dashboard() {
  const { settings } = useSetting();
  const taskState = useStore((state) => state.taskState);
  const storeMessages = useStore((state) => state.messages);
  const messages = storeMessages || [];
  const computerRuntime = useStore((state) => state.computerRuntime);
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
  const activeRun =
    taskState ||
    runs.find((run) => run.status === 'running') ||
    runs.find((run) => run.status !== 'cancelled') ||
    null;
  const sources = activeRun
    ? activeRun.sourceRecords?.length
      ? activeRun.sourceRecords
      : (activeRun.sourcesVisited || []).map((url, index) => ({
          id: `${activeRun.runId}-source-${index}`,
          url,
          capturedAt: activeRun.startedAt,
        }))
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050505]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid min-h-full gap-4 p-4 xl:grid-cols-[280px_minmax(360px,1fr)_340px]">
          <aside className="grid min-w-0 content-start gap-4">
            <section className={cn(sectionClass, 'p-4')}>
              <RunPrompt />
            </section>
            <RuntimeControls />
            <RunStats activeRun={activeRun} />
            <QueuePanel tasks={backgroundTasks} />
            <RecentRuns
              runs={runs.filter((run) => run.runId !== activeRun?.runId)}
            />
          </aside>

          <main className="grid min-h-[680px] min-w-0 gap-4 xl:min-h-0">
            <section className="overflow-hidden rounded-lg border border-white/10 bg-[#080808] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <BookOpenCheck className="h-4 w-4 text-white/70" />
                    Live Operator
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {computerRuntime?.display ||
                      computerRuntime?.activity ||
                      'No active browser or desktop session'}
                  </div>
                </div>
                <span className="rounded-md border border-white/10 bg-black px-2.5 py-1 text-[11px] uppercase text-muted-foreground">
                  {computerRuntime?.mode || 'local'}
                </span>
                <span className="rounded-md border border-white/10 bg-black px-2.5 py-1 text-[11px] uppercase text-muted-foreground">
                  {formatDuration(activeRun?.startedAt, activeRun?.completedAt)}
                </span>
              </div>
              <div className="h-[calc(100vh-172px)] min-h-[560px]">
                <ImageGallery messages={messages} />
              </div>
            </section>
          </main>

          <aside className="grid min-w-0 content-start gap-4">
            <TaskRunPanel taskState={activeRun} />
            <SourcesPanel sources={sources} />
            <ArtifactRail activeRun={activeRun} />
          </aside>
        </div>
      </div>
    </div>
  );
}
