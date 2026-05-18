/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ChangeEvent, FormEvent, memo, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  CheckCircle2,
  FileText,
  Image,
  Laptop,
  Loader2,
  PauseCircle,
  Play,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { api } from '@renderer/api';
import ImageGallery from '@renderer/components/ImageGallery';
import { TaskRunPanel } from '@renderer/components/RunMessages/TaskRunPanel';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/utils';
import { useSetting } from '@renderer/hooks/useSetting';
import { useStore } from '@renderer/hooks/useStore';
import { TaskRunRecord } from '@main/store/types';

const statusClass = {
  queued: 'border-white/10 bg-white/[0.035] text-muted-foreground',
  pending: 'border-white/10 bg-white/[0.035] text-muted-foreground',
  running: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
  completed: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  failed: 'border-red-300/30 bg-red-300/10 text-red-100',
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

const formatDuration = (startedAt?: number, completedAt?: number) => {
  if (!startedAt) {
    return '0s';
  }
  const end = completedAt || Date.now();
  const totalSeconds = Math.max(0, Math.round((end - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const panelClass =
  'rounded-[22px] border border-white/[0.085] bg-[#0b0c0d]/95 shadow-[0_24px_90px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)]';

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
    setAttachments((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const canSubmit = Boolean(goal.trim() || attachments.length);

  return (
    <form
      onSubmit={runNow}
      className="mx-auto flex w-full max-w-[980px] flex-col items-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="mb-10 flex flex-col items-center text-center"
      >
        <div className="mb-5 flex h-11 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-[12px] font-medium uppercase tracking-[0.14em] text-white/54">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.55)]" />
          Neura runtime ready
        </div>
        <h1 className="max-w-[760px] text-[46px] font-semibold leading-[0.98] tracking-normal text-[#f7f7f3] md:text-[64px]">
          Give Neura a mission.
        </h1>
        <p className="mt-5 max-w-[620px] text-[15px] leading-6 text-white/48">
          Neura handles browser work, shell commands, files, memory, research,
          and delegation. Neura shows the cockpit when execution starts.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="w-full overflow-hidden rounded-[26px] border border-white/[0.1] bg-[#111214] shadow-[0_32px_110px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.05)]"
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          onChange={handleFiles}
        />
        <div className="px-5 pt-5">
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Ask Neura to scrape jobs, build a report, control the browser, edit files, or research anything..."
            className="min-h-[118px] w-full resize-none bg-transparent text-[17px] leading-7 text-white outline-none placeholder:text-white/32"
          />
        </div>
        {attachments.length ? (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {attachments.map((file, index) => {
              const AttachmentIcon = file.type?.startsWith('image/')
                ? Image
                : FileText;

              return (
                <div
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex max-w-[260px] items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.045] px-3 py-1.5 text-xs text-white/82"
                  title={file.path || file.name}
                >
                  <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-cyan-200/75" />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-white/42">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    className="ml-1 rounded-full text-white/42 transition hover:text-white"
                    onClick={() => removeAttachment(index)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-white/[0.07] bg-black/20 px-4 py-4">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 rounded-full border border-white/[0.08] bg-white/[0.045] text-white/78 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Upload media or files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={running || !canSubmit}
            className="h-11 w-11 rounded-full bg-[#f5f5f0] text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition hover:bg-white disabled:bg-white/[0.08] disabled:text-white/28"
            aria-label="Run task"
          >
            {running ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowUp className="h-5 w-5" />
            )}
          </Button>
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
  const status = taskState?.status || computerRuntime?.status || 'running';

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-wrap items-center gap-2 rounded-full border border-white/[0.09] bg-[#0b0c0d]/95 px-3 py-2 shadow-[0_14px_50px_rgba(0,0,0,0.24)]">
      <span
        className={cn(
          'rounded-full border px-2.5 py-1 text-[11px] uppercase',
          taskState?.status && statusClass[taskState.status],
          !taskState?.status &&
            'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
        )}
      >
        {status}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-white/52">
        {taskState?.phase || computerRuntime?.activity || 'Neura is executing'}
        {taskState?.activeAgent ? ` / ${taskState.activeAgent}` : ''}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 rounded-full px-3 text-xs text-white/55 hover:bg-white/[0.08] hover:text-white"
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
          className="h-8 rounded-full px-3 text-xs text-white/55 hover:bg-white/[0.08] hover:text-white"
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
          className="h-8 rounded-full px-3 text-xs text-white/55 hover:bg-white/[0.08] hover:text-white"
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
  const liveRun =
    taskState?.status === 'running'
      ? taskState
      : runs.find((run) => run.status === 'running') || null;
  const hasLiveRuntime =
    Boolean(liveRun) ||
    Boolean(
      computerRuntime?.status &&
        computerRuntime.status !== 'idle' &&
        computerRuntime.status !== 'completed',
    );

  return (
    <div className="neura-command-page h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1380px] flex-col px-5 md:px-8">
        <section
          className={cn(
            'flex flex-col justify-center transition-[min-height,padding] duration-300',
            hasLiveRuntime
              ? 'min-h-[420px] pb-8 pt-12'
              : 'min-h-[calc(100vh-64px)] py-10',
          )}
        >
          <RunPrompt />
          {hasLiveRuntime ? (
            <div className="mt-6">
              <RuntimeBar />
            </div>
          ) : null}
        </section>

        {hasLiveRuntime ? (
          <section className="grid min-w-0 gap-5 pb-8 xl:grid-cols-[minmax(0,1fr)_390px]">
            <main className={cn(panelClass, 'min-w-0 overflow-hidden')}>
              <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.075] px-4 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045]">
                  <Laptop className="h-4 w-4 text-cyan-100/80" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">
                    Neura Computer
                  </div>
                  <div className="mt-1 truncate text-xs text-white/48">
                    {computerRuntime?.display ||
                      computerRuntime?.activity ||
                      'Live browser and desktop frames appear here'}
                  </div>
                </div>
                <span className="rounded-full border border-white/[0.08] bg-black/35 px-3 py-1 text-[11px] uppercase text-white/48">
                  {computerRuntime?.mode || 'local'}
                </span>
                <span className="rounded-full border border-white/[0.08] bg-black/35 px-3 py-1 text-[11px] text-white/48">
                  {formatDuration(liveRun?.startedAt, liveRun?.completedAt)}
                </span>
              </div>
              <div className="h-[560px] min-h-0 xl:h-[calc(100vh-430px)] xl:min-h-[480px]">
                <ImageGallery messages={messages} />
              </div>
            </main>

            <aside className="grid min-w-0 content-start gap-5">
              <section className={panelClass}>
                <div className="flex items-center gap-2 border-b border-white/[0.075] px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 text-cyan-100/75" />
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                    Run trace
                  </div>
                  <span className="rounded-full border border-white/[0.08] bg-black/35 px-2 py-0.5 text-[11px] text-white/48">
                    {liveRun?.status || computerRuntime?.status || 'live'}
                  </span>
                </div>
                <TaskRunPanel taskState={liveRun} />
              </section>
            </aside>
          </section>
        ) : null}
      </div>
    </div>
  );
}
