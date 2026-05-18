/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Trash2,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import type { BackgroundTaskRecord, ScheduledTaskRecord } from '@main/store/types';
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
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleGoal, setScheduleGoal] = useState('');
  const [scheduleInterval, setScheduleInterval] = useState(60);
  const [tasks, setTasks] = useState<BackgroundTaskRecord[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskRecord[]>(
    [],
  );
  const [localApiStatus, setLocalApiStatus] = useState<Awaited<
    ReturnType<typeof api.getLocalTaskApiStatus>
  > | null>(null);
  const [localApiToken, setLocalApiToken] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [background, scheduled, apiStatus] = await Promise.all([
      api.listBackgroundTasks(),
      api.listScheduledTasks(),
      api.getLocalTaskApiStatus(),
    ]);
    setTasks(background);
    setScheduledTasks(scheduled);
    setLocalApiStatus(apiStatus);
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

  const createSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = scheduleName.trim();
    const scheduledGoal = scheduleGoal.trim();
    if (!name || !scheduledGoal || busy) {
      return;
    }
    setBusy(true);
    try {
      await api.createScheduledTask({
        name,
        goal: scheduledGoal,
        intervalMinutes: scheduleInterval,
      });
      setScheduleName('');
      setScheduleGoal('');
      setScheduleInterval(60);
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

  const runScheduleNow = async (id: string) => {
    await api.runScheduledTaskNow({ id });
    await refresh();
  };

  const pauseSchedule = async (task: ScheduledTaskRecord) => {
    if (task.status === 'paused') {
      await api.resumeScheduledTask({ id: task.id });
    } else {
      await api.pauseScheduledTask({ id: task.id });
    }
    await refresh();
  };

  const deleteSchedule = async (id: string) => {
    await api.deleteScheduledTask({ id });
    await refresh();
  };

  const enableLocalApi = async () => {
    const result = await api.enableLocalTaskApi({});
    setLocalApiStatus(result);
    setLocalApiToken(result.token);
  };

  const disableLocalApi = async () => {
    const result = await api.disableLocalTaskApi();
    setLocalApiStatus(result);
    setLocalApiToken('');
  };

  const regenerateLocalApiToken = async () => {
    const result = await api.regenerateLocalTaskApiToken();
    setLocalApiStatus(result);
    setLocalApiToken(result.token);
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

  const renderScheduledTask = (task: ScheduledTaskRecord) => (
    <article
      key={task.id}
      className="rounded-[26px] border border-[#f6f1e8]/[0.1] bg-[#11100e]/78 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-[#f6f1e8]/[0.1] bg-[#f6f1e8]/[0.045]">
          <CalendarClock className="h-4 w-4 text-[#f6f1e8]/62" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-[15px] font-semibold text-[#f6f1e8]">
            {task.name}
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-[#f6f1e8]/54">
            {task.goal}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#f6f1e8]/42">
            <span>Every {task.intervalMinutes} min</span>
            <span>/</span>
            <span>Next {formatTime(task.nextRunAt)}</span>
            {task.history[0] ? (
              <>
                <span>/</span>
                <span>{task.history[0].message}</span>
              </>
            ) : null}
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
            task.status === 'active'
              ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
              : 'border-[#f6f1e8]/[0.12] bg-[#f6f1e8]/[0.045] text-[#f6f1e8]/58',
          )}
        >
          {task.status}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
          onClick={() => runScheduleNow(task.id)}
        >
          <Play className="h-3.5 w-3.5" />
          Run now
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70 hover:bg-[#f6f1e8]/[0.08] hover:text-[#f6f1e8]"
          onClick={() => pauseSchedule(task)}
        >
          <Pause className="h-3.5 w-3.5" />
          {task.status === 'paused' ? 'Resume' : 'Pause'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-red-300/20 bg-transparent text-red-100/80 hover:bg-red-300/10 hover:text-red-100"
          onClick={() => deleteSchedule(task.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </article>
  );

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

          <form
            onSubmit={createSchedule}
            className="mt-4 overflow-hidden rounded-[32px] border border-[#f6f1e8]/[0.12] bg-[#11100e]/95"
          >
            <div className="grid gap-3 p-4">
              <Input
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                placeholder="Schedule name"
                className="border-[#f6f1e8]/[0.12] bg-black/20 text-[#f6f1e8] placeholder:text-[#f6f1e8]/32"
              />
              <Textarea
                value={scheduleGoal}
                onChange={(event) => setScheduleGoal(event.target.value)}
                placeholder="Describe recurring work..."
                className="min-h-[110px] resize-none border-[#f6f1e8]/[0.12] bg-black/20 text-[#f6f1e8] placeholder:text-[#f6f1e8]/32"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-[#f6f1e8]/46">
                  Interval minutes
                  <Input
                    value={scheduleInterval}
                    min={1}
                    type="number"
                    onChange={(event) =>
                      setScheduleInterval(Number(event.target.value) || 1)
                    }
                    className="h-9 w-24 border-[#f6f1e8]/[0.12] bg-black/20 text-[#f6f1e8]"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={
                    busy || !scheduleName.trim() || !scheduleGoal.trim()
                  }
                  className="rounded-full bg-[#f6f1e8] px-5 text-black hover:bg-white disabled:bg-[#f6f1e8]/[0.08] disabled:text-[#f6f1e8]/28"
                >
                  <CalendarClock className="h-4 w-4" />
                  Create schedule
                </Button>
              </div>
            </div>
          </form>

          <section className="mt-4 rounded-[32px] border border-[#f6f1e8]/[0.12] bg-[#11100e]/95 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#f6f1e8]">
                  <KeyRound className="h-4 w-4" />
                  Local task API
                </div>
                <p className="mt-1 max-w-[420px] text-xs leading-5 text-[#f6f1e8]/42">
                  Localhost-only task intake for scripts and launchers. Requests
                  need a bearer token and queue real background Hermes tasks.
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
                  localApiStatus?.enabled
                    ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                    : 'border-[#f6f1e8]/[0.12] bg-[#f6f1e8]/[0.045] text-[#f6f1e8]/58',
                )}
              >
                {localApiStatus?.enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
            {localApiStatus ? (
              <div className="mt-3 rounded-2xl border border-[#f6f1e8]/[0.08] bg-black/20 p-3 text-xs text-[#f6f1e8]/48">
                <div>{localApiStatus.baseUrl}</div>
                <div className="mt-1">
                  Token: {localApiStatus.tokenPresent ? 'stored as hash' : 'not generated'}
                </div>
                {localApiStatus.setupGap ? (
                  <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-2 text-amber-100">
                    {localApiStatus.setupGap}
                  </div>
                ) : null}
                {localApiToken ? (
                  <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-2 font-mono text-[11px] text-amber-100">
                    {localApiToken}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {localApiStatus?.enabled ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70"
                    onClick={regenerateLocalApiToken}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Regenerate token
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full border-red-300/20 bg-transparent text-red-100/80"
                    onClick={disableLocalApi}
                  >
                    Disable
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full border-[#f6f1e8]/[0.12] bg-transparent text-[#f6f1e8]/70"
                  onClick={enableLocalApi}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Enable API
                </Button>
              )}
            </div>
          </section>
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
            {scheduledTasks.length ? (
              <div className="mb-5 grid gap-3">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#f6f1e8]/42">
                  Recurring
                </div>
                {scheduledTasks.map(renderScheduledTask)}
              </div>
            ) : null}
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
