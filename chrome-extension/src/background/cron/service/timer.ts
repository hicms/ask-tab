// ── Scheduler timer & execution ─────────────
// uses chrome.alarms

import { computeTaskNextRunAtMs, nextWakeAtMs } from './jobs';
import { locked } from './locked';
import { appendRunLog } from '../run-log';
import { ensureLoaded, persist, markDirty, markRemoved } from '../store';
import { reapCronSessions } from '@extension/storage';
import type { ScheduledTask } from '../types';
import type { CronEvent, CronState } from './state';

const CRON_ALARM_NAME = 'deepchat-cron';

const ERROR_BACKOFF_SCHEDULE_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

const errorBackoffMs = (consecutiveErrors: number): number => {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_SCHEDULE_MS.length - 1);
  return ERROR_BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
};

const armTimer = (state: CronState): void => {
  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    chrome.alarms.clear(CRON_ALARM_NAME).catch(() => {});
    return;
  }
  // Chrome alarms require at least 30s in the future for `when`
  const when = Math.max(nextAt, Date.now() + 1000);
  chrome.alarms.create(CRON_ALARM_NAME, { when });
};

const onAlarm = async (state: CronState): Promise<void> => {
  if (state.running) return;
  state.running = true;
  try {
    await locked(state, async () => {
      await ensureLoaded(state);
      await runDueJobs(state);
      await persist(state);
      armTimer(state);
    });
  } finally {
    state.running = false;
  }

  // Reap old cron-generated sessions (throttled internally)
  try {
    const reaped = await reapCronSessions();
    if (reaped > 0) {
      state.deps.log.info('Reaped old cron sessions', { count: reaped });
    }
  } catch {
    /* best-effort */
  }
};

const runDueJobs = async (state: CronState): Promise<void> => {
  if (!state.store) return;
  const now = state.deps.nowMs();
  const due = state.store.tasks.filter(t => {
    if (!t.enabled) return false;
    if (typeof t.state.runningAtMs === 'number') return false;
    const next = t.state.nextRunAtMs;
    return typeof next === 'number' && now >= next;
  });
  if (due.length > 0) {
    state.deps.log.debug('Due tasks found', {
      count: due.length,
      tasks: due.map(t => ({ id: t.id, name: t.name, nextRunAtMs: t.state.nextRunAtMs })),
      nowMs: now,
    });
  }
  for (const task of due) {
    await executeTask(state, task, now, { forced: false });
  }
};

const executeTask = async (
  state: CronState,
  task: ScheduledTask,
  nowMs: number,
  opts: { forced: boolean },
): Promise<void> => {
  const startedAt = state.deps.nowMs();
  state.deps.log.info('Task execution started', {
    taskId: task.id,
    name: task.name,
    kind: task.payload.kind,
    forced: opts.forced,
    scheduledAtMs: task.state.nextRunAtMs,
    startedAtMs: startedAt,
    delayMs: task.state.nextRunAtMs ? startedAt - task.state.nextRunAtMs : undefined,
  });
  task.state.runningAtMs = startedAt;
  task.state.lastError = undefined;
  markDirty(task.id);
  emit(state, { taskId: task.id, action: 'started', runAtMs: startedAt });

  let deleted = false;

  const finish = async (status: 'ok' | 'error' | 'skipped', err?: string, chatId?: string) => {
    const endedAt = state.deps.nowMs();
    task.state.runningAtMs = undefined;
    task.state.lastRunAtMs = startedAt;
    task.state.lastStatus = status;
    task.state.lastDurationMs = Math.max(0, endedAt - startedAt);
    task.state.lastError = err;

    // Track consecutive errors
    if (status === 'error') {
      task.state.consecutiveErrors = (task.state.consecutiveErrors ?? 0) + 1;
    } else {
      task.state.consecutiveErrors = 0;
    }

    markDirty(task.id);

    // Auto-delete one-shot tasks only on natural (non-forced) runs
    const shouldDelete =
      !opts.forced &&
      task.schedule.kind === 'at' &&
      status === 'ok' &&
      task.deleteAfterRun === true;

    if (!shouldDelete) {
      if (task.schedule.kind === 'at' && (status === 'ok' || status === 'error')) {
        // One-shot tasks: disable and clear nextRunAtMs (forced or not)
        if (!opts.forced) task.enabled = false;
        task.state.nextRunAtMs = undefined;
      } else if (task.enabled) {
        const normalNext = computeTaskNextRunAtMs(task, endedAt);

        // Apply error backoff for recurring tasks
        if (
          status === 'error' &&
          normalNext !== undefined &&
          task.state.consecutiveErrors &&
          task.state.consecutiveErrors > 0
        ) {
          const backoffNext = endedAt + errorBackoffMs(task.state.consecutiveErrors);
          task.state.nextRunAtMs = Math.max(normalNext, backoffNext);
          state.deps.log.info('Applied error backoff', {
            taskId: task.id,
            consecutiveErrors: task.state.consecutiveErrors,
            backoffMs: errorBackoffMs(task.state.consecutiveErrors),
            nextRunAtMs: task.state.nextRunAtMs,
          });
        } else {
          task.state.nextRunAtMs = normalNext;
        }
      } else {
        task.state.nextRunAtMs = undefined;
      }
    }

    emit(state, {
      taskId: task.id,
      action: 'finished',
      status,
      error: err,
      runAtMs: startedAt,
      durationMs: task.state.lastDurationMs,
      nextRunAtMs: task.state.nextRunAtMs,
      chatId,
    });

    // Append run log
    await appendRunLog({
      taskId: task.id,
      status,
      error: err,
      durationMs: task.state.lastDurationMs,
      chatId,
    }).catch(() => {});

    state.deps.log.info('Task execution finished', {
      taskId: task.id,
      name: task.name,
      status,
      durationMs: task.state.lastDurationMs,
      willDelete: shouldDelete,
      error: err,
    });

    if (shouldDelete && state.store) {
      state.store.tasks = state.store.tasks.filter(t => t.id !== task.id);
      deleted = true;
      markRemoved(task.id);
      state.deps.log.debug('Task auto-deleted (deleteAfterRun)', {
        taskId: task.id,
        name: task.name,
      });
      emit(state, { taskId: task.id, action: 'removed' });
    }
  };

  try {
    const result = await state.deps.executeTask(task);
    await finish(result.status, result.error, result.chatId);
  } catch (err) {
    await finish('error', String(err));
  } finally {
    task.updatedAt = nowMs;
    if (!deleted) markDirty(task.id);
  }
};

const stopTimer = (): void => {
  chrome.alarms.clear(CRON_ALARM_NAME).catch(() => {});
};

const emit = (state: CronState, evt: CronEvent): void => {
  try {
    state.deps.onEvent?.(evt);
  } catch {
    /* ignore */
  }
};

export { CRON_ALARM_NAME, armTimer, onAlarm, executeTask, stopTimer, emit, errorBackoffMs };
