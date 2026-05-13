/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ComponentType,
  ChangeEvent,
  FormEvent,
  memo,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowUp,
  Bell,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  Laptop,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { api } from '@renderer/api';
import ImageGallery from '@renderer/components/ImageGallery';
import { TaskRunPanel } from '@renderer/components/RunMessages/TaskRunPanel';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/utils';
import { useSetting } from '@renderer/hooks/useSetting';
import { useStore } from '@renderer/hooks/useStore';
import {
  BackgroundTaskRecord,
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

type LocalAttachment = File & { path?: string };

const formatBytes = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const attachmentSummary = (attachments: LocalAttachment[]) =>
  attachments
    .map((file) => {
      const location = file.path ? `, path: ${file.path}` : '';
      return `- ${file.name} (${file.type || 'file'}, ${formatBytes(file.size)}${location})`;
    })
    .join('\n');

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

const panelClass =
  'rounded-2xl border border-white/10 bg-[#0b0b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]';

const SectionHeader = ({
  icon: Icon,
  title,
  meta,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  meta?: string;
}) => (
  <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
    <Icon className="h-4 w-4 text-white/65" />
    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
      {title}
    </div>
    {meta ? (
      <span className="shrink-0 rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[11px] text-muted-foreground">
        {meta}
      </span>
    ) : null}
  </div>
);

const RunPrompt = memo(() => {
  const [goal, setGoal] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runNow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed && !attachments.length) {
      return;
    }
    const attachmentText = attachmentSummary(attachments);
    const instructions = attachmentText
      ? `${trimmed || 'Analyze the uploaded files.'}\n\nAttached files:\n${attachmentText}`
      : trimmed;
    setRunning(true);
    try {
      await api.setInstructions({ instructions });
      await api.runAgent();
      setGoal('');
      setAttachments([]);
    } finally {
      setRunning(false);
    }
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(
      event.target.files || [],
    ) as LocalAttachment[];
    if (selected.length) {
      setAttachments((current) => [...current, ...selected]);
    }
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <form
      onSubmit={runNow}
      className="mx-auto flex w-full max-w-[960px] flex-col items-center"
    >
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="mb-12 text-center text-[48px] font-normal leading-none tracking-normal text-[#f4f4f0] md:text-[54px]"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        What can I do for you?
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.45, ease: 'easeOut' }}
        className="w-full rounded-[28px] border border-white/10 bg-[#242424] p-4 shadow-[0_30px_90px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.045)]"
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          onChange={handleFiles}
        />
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Assign a task or ask anything"
          className="min-h-[86px] w-full resize-none bg-transparent px-1 py-1 text-[17px] leading-7 text-white outline-none placeholder:text-[#7f7f7f]"
        />
        {attachments.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="flex max-w-[260px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/85"
                title={file.path || file.name}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-white/65" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-white/45">
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  className="ml-1 rounded-full text-white/45 transition hover:text-white"
                  onClick={() => removeAttachment(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-between pt-3">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 rounded-full border border-white/10 bg-[#2b2b2b] text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Upload media or files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <div className="ml-auto flex items-center gap-3">
            <Button
              type="submit"
              size="icon"
              disabled={running || (!goal.trim() && !attachments.length)}
              className="h-10 w-10 rounded-full bg-[#3b3b3b] text-white hover:bg-[#4a4a4a] disabled:opacity-60"
              aria-label="Run task"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </motion.div>
    </form>
  );
});

RunPrompt.displayName = 'RunPrompt';

const RuntimeBar = memo(() => {
  const taskState = useStore((state) => state.taskState);
  const computerRuntime = useStore((state) => state.computerRuntime);
  const thinking = useStore((state) => state.thinking);
  const paused = computerRuntime?.status === 'paused';
  const status = taskState?.status || computerRuntime?.status || 'idle';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-full border border-white/10 bg-[#0b0b0b]/95 px-3 py-2">
      <span
        className={cn(
          'rounded-full border px-2.5 py-1 text-[11px] uppercase',
          taskState?.status && statusClass[taskState.status],
          !taskState?.status &&
            'border-white/10 bg-white/[0.035] text-muted-foreground',
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
          variant="ghost"
          className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-white/10 hover:text-white"
          disabled={!thinking}
          onClick={() => api.pauseRun()}
        >
          <PauseCircle className="h-3.5 w-3.5" />
          Pause
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-white/10 hover:text-white"
          disabled={!paused}
          onClick={() => api.resumeRun()}
        >
          <Play className="h-3.5 w-3.5" />
          Resume
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-white/10 hover:text-white"
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

RuntimeBar.displayName = 'RuntimeBar';

const QueuePanel = memo(({ tasks }: { tasks: BackgroundTaskRecord[] }) => {
  const cancelTask = async (id: string) => {
    await api.cancelBackgroundTask({ id });
  };
  const retryTask = async (id: string) => {
    await api.retryBackgroundTask({ id });
  };

  return (
    <section className={panelClass}>
      <SectionHeader icon={Bell} title="Background queue" meta={`${tasks.length}`} />
      {!tasks.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Queued and background jobs appear here after you send work to run
          later.
        </p>
      ) : (
        <div className="grid gap-2 p-3">
          {tasks.slice(0, 4).map((task) => (
            <div
              key={task.id}
              className="rounded-xl border border-white/10 bg-black/30 p-3"
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
                    className="h-7 rounded-full px-2 text-xs"
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
                    className="h-7 rounded-full px-2 text-xs"
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
    <section className={panelClass}>
      <SectionHeader icon={ExternalLink} title="Sources" meta={`${sources.length}`} />
      {!sources.length ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Research URLs and captured excerpts are recorded here when Neura
          browses.
        </p>
      ) : (
        <div className="grid gap-2 p-3">
          {sources.slice(-6).map((source) => (
            <button
              type="button"
              key={source.id}
              className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left transition hover:border-white/20"
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
    <section className={panelClass}>
      <SectionHeader icon={Clock} title="Recent work" meta={`${runs.length}`} />
      <div className="grid gap-2 p-3 md:grid-cols-2">
        {runs.slice(0, 4).map((run) => {
          const Icon = StatusIcon[run.status] || Clock;
          return (
            <div
              key={run.runId}
              className="rounded-xl border border-white/10 bg-black/30 p-3"
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
                  className="h-7 rounded-full px-2 text-xs"
                  onClick={() => exportRun(run)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full px-2 text-xs"
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

const ArtifactPanel = memo(({ activeRun }: { activeRun: TaskRunRecord | null }) => {
  const artifacts = activeRun?.artifacts || [];

  return (
    <section className={panelClass}>
      <SectionHeader icon={FolderOpen} title="Artifacts" meta={`${artifacts.length}`} />
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
              className="rounded-xl border border-white/10 bg-black/30 p-3"
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
                  className="h-7 rounded-full px-2 text-xs"
                  onClick={() => api.revealPath({ path: artifact.path })}
                >
                  Reveal
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full px-2 text-xs"
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

ArtifactPanel.displayName = 'ArtifactPanel';

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
  const runStatus = activeRun?.status || 'idle';
  const hasLiveRuntime =
    Boolean(taskState) ||
    Boolean(computerRuntime?.status && computerRuntime.status !== 'idle');

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#191919]">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 px-4 xl:px-6">
        <section className="flex min-h-[calc(100vh-64px)] flex-col justify-center px-2 pb-10 pt-10 md:px-8">
          <RunPrompt />
          {hasLiveRuntime ? (
            <div className="mt-5">
              <RuntimeBar />
            </div>
          ) : null}
        </section>

        <section className="grid min-w-0 gap-5 pb-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <main className={cn(panelClass, 'min-w-0 overflow-hidden')}>
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/35">
                <Laptop className="h-4 w-4 text-white/70" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">
                  Neura&apos;s Computer
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {computerRuntime?.display ||
                    computerRuntime?.activity ||
                    'No active browser or desktop session'}
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] uppercase text-muted-foreground">
                {computerRuntime?.mode || 'local'}
              </span>
              <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-muted-foreground">
                {formatDuration(activeRun?.startedAt, activeRun?.completedAt)}
              </span>
            </div>
            <div className="h-[580px] min-h-0 xl:h-[calc(100vh-360px)] xl:min-h-[520px]">
              <ImageGallery messages={messages} />
            </div>
          </main>

          <aside className="grid min-w-0 content-start gap-5">
            <section className={panelClass}>
              <SectionHeader icon={Bot} title="Run status" meta={runStatus} />
              <div className="grid grid-cols-2 gap-2 p-3">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
                    <Globe2 className="h-3.5 w-3.5" />
                    Sources
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {sources.length}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Approvals
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {activeRun?.approvalEvents?.length || 0}
                  </div>
                </div>
              </div>
            </section>
            <TaskRunPanel taskState={activeRun} />
          </aside>
        </section>

        <section className="grid min-w-0 gap-5 pb-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="grid min-w-0 gap-5">
            <QueuePanel tasks={backgroundTasks} />
            <RecentRuns
              runs={runs.filter((run) => run.runId !== activeRun?.runId)}
            />
          </div>
          <aside className="grid min-w-0 content-start gap-5">
            <SourcesPanel sources={sources} />
            <ArtifactPanel activeRun={activeRun} />
          </aside>
        </section>
      </div>
    </div>
  );
}
