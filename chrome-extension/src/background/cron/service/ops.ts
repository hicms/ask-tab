// ── CRUD operations ─────────────────────────

import {
  applyTaskPatch,
  computeTaskNextRunAtMs,
  createTask,
  findTaskOrThrow,
  isTaskDue,
  nextWakeAtMs,
  recomputeNextRuns,
} from './jobs';
import { locked } from './locked';
import { armTimer, emit, executeTask, stopTimer } from './timer';
import { ensureLoaded, persist, markDirty, markRemoved } from '../store';
import type { ScheduledTaskCreate, ScheduledTaskPatch } from '../types';
import type { CronState } from './state';

const start = async (state: CronState): Promise<void> => {
  await locked(state, async () => {
    await ensureLoaded(state);
    recomputeNextRuns(state);
    // Mark all tasks dirty after recompute since nextRunAtMs may have changed
    for (const t of state.store?.tasks ?? []) markDirty(t.id);
    await persist(state);
    armTimer(state);
    state.started = true;
    state.deps.log.info('Cron started', {
      tasks: state.store?.tasks.length ?? 0,
      nextWakeAtMs: nextWakeAtMs(state) ?? null,
    });
  });
};

const stop = (): void => {
  stopTimer();
};

const status = async (state: CronState) =>
  locked(state, async () => {
    await ensureLoaded(state);
    return {
      running: state.started,
      tasks: state.store?.tasks.length ?? 0,
      nextWakeAtMs: nextWakeAtMs(state) ?? null,
    };
  });

const list = async (state: CronState, opts?: { includeDisabled?: boolean }) =>
  locked(state, async () => {
    await ensureLoaded(state);
    const includeDisabled = opts?.includeDisabled === true;
    const tasks = (state.store?.tasks ?? []).filter(t => includeDisabled || t.enabled);
    return tasks.sort((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0));
  });

const add = async (state: CronState, input: ScheduledTaskCreate) =>
  locked(state, async () => {
    await ensureLoaded(state);
    const task = createTask(state, input);
    state.store?.tasks.push(task);
    markDirty(task.id);
    await persist(state);
    armTimer(state);
    emit(state, {
      taskId: task.id,
      action: 'added',
      nextRunAtMs: task.state.nextRunAtMs,
    });
    return task;
  });

const update = async (state: CronState, id: string, patch: ScheduledTaskPatch) =>
  locked(state, async () => {
    await ensureLoaded(state);
    const task = findTaskOrThrow(state, id);
    const now = state.deps.nowMs();
    applyTaskPatch(task, patch);
    task.updatedAt = now;
    markDirty(task.id);
    if (task.enabled) {
      task.state.nextRunAtMs = computeTaskNextRunAtMs(task, now);
    } else {
      task.state.nextRunAtMs = undefined;
      task.state.runningAtMs = undefined;
    }
    await persist(state);
    armTimer(state);
    emit(state, {
      taskId: id,
      action: 'updated',
      nextRunAtMs: task.state.nextRunAtMs,
    });
    return task;
  });

const remove = async (state: CronState, id: string) =>
  locked(state, async () => {
    await ensureLoaded(state);
    const before = state.store?.tasks.length ?? 0;
    if (!state.store) return { ok: false, removed: false } as const;
    state.store.tasks = state.store.tasks.filter(t => t.id !== id);
    const removed = state.store.tasks.length !== before;
    if (removed) markRemoved(id);
    await persist(state);
    armTimer(state);
    if (removed) emit(state, { taskId: id, action: 'removed' });
    return { ok: true, removed } as const;
  });

/** Tasks currently executing — prevents re-entrant forced runs when a spawned LLM
 *  calls the scheduler tool's 'run' action on the same task. Checked BEFORE the
 *  lock to avoid deadlock: the lock is held for the entire executeTask duration,
 *  so a re-entrant locked() call from within the LLM tool handler would deadlock. */
const executingTasks = new Set<string>();

const run = async (state: CronState, id: string, mode?: 'due' | 'force') => {
  if (executingTasks.has(id)) {
    return { ok: true, ran: false, reason: 'already-running' as const };
  }
  return locked(state, async () => {
    await ensureLoaded(state);
    const task = findTaskOrThrow(state, id);
    const now = state.deps.nowMs();
    const due = isTaskDue(task, now, { forced: mode === 'force' });
    if (!due) return { ok: true, ran: false, reason: 'not-due' as const };
    executingTasks.add(id);
    try {
      await executeTask(state, task, now, { forced: mode === 'force' });
    } finally {
      executingTasks.delete(id);
    }
    await persist(state);
    armTimer(state);
    return { ok: true, ran: true } as const;
  });
};

export { start, stop, status, list, add, update, remove, run };
