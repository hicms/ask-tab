// ── Dexie-backed store for scheduled tasks ──

import { listScheduledTasks, bulkPutScheduledTasks, deleteScheduledTask } from '@extension/storage';
import type { CronState } from './service/state';
import type { ScheduledTask, TaskPayload, TaskSchedule, TaskState } from './types';
import type { DbScheduledTask } from '@extension/storage';

const STUCK_RUN_MS = 2 * 60 * 60 * 1000;

// ── Type-safe mapping between DB and domain types ──

const dbToTask = (db: DbScheduledTask): ScheduledTask => ({
  id: db.id,
  name: db.name,
  description: db.description,
  enabled: db.enabled,
  deleteAfterRun: db.deleteAfterRun,
  timeoutMs: db.timeoutMs,
  createdAt: db.createdAt,
  updatedAt: db.updatedAt,
  schedule: db.schedule as TaskSchedule,
  payload: db.payload as TaskPayload,
  state: db.state as TaskState,
});

const taskToDb = (task: ScheduledTask): DbScheduledTask => ({
  id: task.id,
  name: task.name,
  description: task.description,
  enabled: task.enabled,
  deleteAfterRun: task.deleteAfterRun,
  timeoutMs: task.timeoutMs,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  schedule: task.schedule,
  payload: task.payload,
  state: task.state,
});

// ── Dirty tracking ──

const dirtyIds = new Set<string>();
const removedIds = new Set<string>();

const markDirty = (id: string): void => {
  dirtyIds.add(id);
};

const markRemoved = (id: string): void => {
  removedIds.add(id);
  dirtyIds.delete(id);
};

const ensureLoaded = async (state: CronState): Promise<void> => {
  if (state.store) return;
  const rows = await listScheduledTasks();
  const tasks = rows.map(dbToTask);
  const now = state.deps.nowMs();
  for (const task of tasks) {
    if (!task.state) task.state = {};
    const runningAt = task.state.runningAtMs;
    if (typeof runningAt === 'number' && now - runningAt > STUCK_RUN_MS) {
      state.deps.log.warn('Clearing stuck running marker', {
        taskId: task.id,
        runningAtMs: runningAt,
      });
      task.state.runningAtMs = undefined;
      dirtyIds.add(task.id);
    }
  }
  state.store = { tasks };
};

const persist = async (state: CronState): Promise<void> => {
  if (!state.store) return;

  // Write only dirty tasks
  if (dirtyIds.size > 0) {
    const dirtyTasks = state.store.tasks.filter(t => dirtyIds.has(t.id)).map(taskToDb);
    if (dirtyTasks.length > 0) {
      await bulkPutScheduledTasks(dirtyTasks);
    }
    dirtyIds.clear();
  }

  // Delete removed tasks (with run log cleanup)
  for (const id of removedIds) {
    await deleteScheduledTask(id).catch(() => {});
  }
  removedIds.clear();
};

export { ensureLoaded, persist, markDirty, markRemoved };
