/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import type { BackgroundTaskRecord } from '@main/store/types';
import { cn } from '@renderer/utils';

const statusClass = {
  queued: 'border-[#f6f1e8]/[0.12] bg-[#f6f1e8]/[0.045] text-[#f6f1e8]/58',
  running: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  completed: 'border-[#f6f1e8]/[0.12] bg-[#f6f1e8]/[0.045] text-[#f6f1e8]/58',
  failed: 'border-red-300/25 bg-red-300/10 text-red-100',
  cancelled: 'border-zinc-400/20 bg-zinc-400/10 text-zinc-200',
};

const statusIcon = {
  queued: Clock3,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
};

const formatTime = (value?: number) =>
  value ? new Date(value).toLocaleString() : 'Not started';

export default function Scheduled() {
  const [goal, setGoal] = useState('');
  const [tasks, setTasks] = useState<BackgroundTaskRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setTasks(await api.listBackgroundTasks());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(
    () => ({
      active: tasks.filter((task) =>
        ['queued', 'running'].includes(task.status),
      ),
      finished: tasks.filter(
        (task) => !['queued', 'running'].includes(task.status),
      ),
    }),
    [tasks],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    try {
      await api.queueBackgroundTask({
        kind: 'multi_agent',
        goal: trimmed,
      });
      setGoal('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string) => {
    await api.retryBackgroundTask({ id });
    await refresh();
  };

  const cancel = async (id: string) => {
    await api.cancelBackgroundTask({ id });
    await refresh();
  };

  const renderTask = (task: BackgroundTaskRecord) => {
    const Icon = statusIcon[task.status] || Clock3;
    return (
      <article
        key={task.id}
        className="rounded-[26px] border border-[#f6f1e8]/[0.1] bg-[#11100e]/78 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-[#f6f1e8]/[0.1] bg-[#f6f1e8]/[0.045]">
            <Icon
              className={cn(
                'h-4 w-4 text-[#f6f1e8]/62',
                task.status === 'running' && 'animate-spin text-emerald-100',
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[15px] font-semibold leading-6 text-[#f6f1e8]">
              {task.goal}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#f6f1e8]/42">
              <span>{task.kind.replace(/_/g, ' ')}</span>
              <span>/</span>
              <span>{formatTime(task.startedAt || task.createdAt)}</span>
            </div>
            {task.error ? (
              <p className="mt-3 text-sm leading-5 text-red-100/80">
                {task.error}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
              statusClass[task.status],
            )}
          >
            {task.cancelRequested ? 'cancelling' : task.status}
          </span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {(task.status === 'queued' || task.status === 'running') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
              onClick={() => cancel(task.id)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          {!['queued', 'running'].includes(task.status) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
              onClick={() => retry(task.id)}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="neura-home-page h-full overflow-y-auto px-5 py-8 md:px-8">
      <div className="mx-auto grid min-h-full max-w-[1240px] gap-8 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <section className="flex flex-col justify-center">
          <div className="mb-7 flex w-fit items-center gap-2 rounded-full border border-[#f6f1e8]/[0.1] bg-[#f6f1e8]/[0.045] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]/58">
            <span className="h-1.5 w-1.5 rounded-full bg-[#f6f1e8]" />
            Scheduled work
          </div>
          <h1 className="max-w-[520px] text-[54px] font-semibold leading-[0.92] tracking-normal text-[#f6f1e8] md:text-[76px]">
            Queue the next mission.
          </h1>
          <p className="mt-6 max-w-[480px] text-sm leading-6 text-[#f6f1e8]/48">
            Scheduled tasks are sent through Neura&apos;s autonomous runtime and
            run in the background with the same browser, shell, file, and
            artifact support as live work.
          </p>

          <form
            onSubmit={submit}
            className="mt-10 overflow-hidden rounded-[32px] border border-[#f6f1e8]/[0.12] bg-[#11100e]/95 shadow-[0_34px_110px_rgba(0,0,0,0.42)]"
          >
            <Textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Describe the work to queue..."
              className="min-h-[150px] resize-none border-0 bg-transparent px-5 py-5 text-[16px] leading-7 text-[#f6f1e8] shadow-none placeholder:text-[#f6f1e8]/32 focus-visible:ring-0"
            />
            <div className="flex items-center justify-between border-t border-[#f6f1e8]/[0.08] bg-black/20 px-4 py-4">
              <span className="text-xs text-[#f6f1e8]/38">
                Runs as a background task
              </span>
              <Button
                type="submit"
                disabled={busy || !goal.trim()}
                className="rounded-full bg-[#f6f1e8] px-5 text-black hover:bg-white disabled:bg-[#f6f1e8]/[0.08] disabled:text-[#f6f1e8]/28"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Queue task
              </Button>
            </div>
          </form>
        </section>

        <section className="py-4 xl:py-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]/42">
                Queue
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-[#f6f1e8]">
                Active and completed tasks
              </h2>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
              onClick={refresh}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="grid gap-3">
            {[...grouped.active, ...grouped.finished].length ? (
              [...grouped.active, ...grouped.finished]
                .slice(0, 12)
                .map(renderTask)
            ) : (
              <div className="rounded-[28px] border border-[#f6f1e8]/[0.1] bg-[#11100e]/72 p-8 text-center">
                <CalendarClock className="mx-auto h-8 w-8 text-[#f6f1e8]/42" />
                <div className="mt-4 text-sm font-semibold text-[#f6f1e8]">
                  No queued work yet
                </div>
                <p className="mt-2 text-sm text-[#f6f1e8]/42">
                  Add a mission and Neura will run it through the background
                  autonomous task path.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
