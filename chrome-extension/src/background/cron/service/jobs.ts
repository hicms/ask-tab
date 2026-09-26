// ── Job state logic ─────────────────────────

import { computeNextRunAtMs } from '../schedule';
import { nanoid } from 'nanoid';
import type {
  ScheduledTask,
  ScheduledTaskCreate,
  ScheduledTaskPatch,
  TaskPayload,
  TaskPayloadPatch,
} from '../types';
import type { CronState } from './state';

const findTaskOrThrow = (state: CronState, id: string): ScheduledTask => {
  const task = state.store?.tasks.find(t => t.id === id);
  if (!task) throw new Error(`unknown task id: ${id}`);
  return task;
};

const computeTaskNextRunAtMs = (task: ScheduledTask, nowMs: number): number | undefined => {
  if (!task.enabled) return undefined;
  if (task.schedule.kind === 'at') {
    if (task.state.lastStatus === 'ok' && task.state.lastRunAtMs) return undefined;
    return task.schedule.atMs;
  }
  return computeNextRunAtMs(task.schedule, nowMs);
};

const recomputeNextRuns = (state: CronState): void => {
  if (!state.store) return;
  const now = state.deps.nowMs();
  for (const task of state.store.tasks) {
    if (!task.state) task.state = {};
    if (!task.enabled) {
      task.state.nextRunAtMs = undefined;
      task.state.runningAtMs = undefined;
      continue;
    }
    task.state.nextRunAtMs = computeTaskNextRunAtMs(task, now);
  }
};

const nextWakeAtMs = (state: CronState): number | undefined => {
  const tasks = state.store?.tasks ?? [];
  const enabled = tasks.filter(t => t.enabled && typeof t.state.nextRunAtMs === 'number');
  if (enabled.length === 0) return undefined;
  return enabled.reduce(
    (min, t) => Math.min(min, t.state.nextRunAtMs as number),
    enabled[0].state.nextRunAtMs as number,
  );
};

const createTask = (state: CronState, input: ScheduledTaskCreate): ScheduledTask => {
  const now = state.deps.nowMs();
  const task: ScheduledTask = {
    id: nanoid(),
    name: input.name.trim() || 'Untitled task',
    description: input.description?.trim() || undefined,
    enabled: input.enabled !== false,
    deleteAfterRun: input.deleteAfterRun,
    timeoutMs: input.timeoutMs,
    delivery: input.delivery,
    createdAt: now,
    updatedAt: now,
    schedule: input.schedule,
    payload: input.payload,
    state: { ...input.state },
  };
  task.state.nextRunAtMs = computeTaskNextRunAtMs(task, now);
  return task;
};

const applyTaskPatch = (task: ScheduledTask, patch: ScheduledTaskPatch): void => {
  if ('name' in patch && typeof patch.name === 'string') task.name = patch.name.trim() || task.name;
  if ('description' in patch) task.description = patch.description?.trim() || undefined;
  if (typeof patch.enabled === 'boolean') task.enabled = patch.enabled;
  if (typeof patch.deleteAfterRun === 'boolean') task.deleteAfterRun = patch.deleteAfterRun;
  if (typeof patch.timeoutMs === 'number') task.timeoutMs = patch.timeoutMs;
  if ('delivery' in patch) task.delivery = patch.delivery;
  if (patch.schedule) task.schedule = patch.schedule;
  if (patch.payload) task.payload = mergePayload(task.payload, patch.payload);
  if (patch.state) task.state = { ...task.state, ...patch.state };
};

const mergePayload = (existing: TaskPayload, patch: TaskPayloadPatch): TaskPayload => {
  if (patch.kind !== existing.kind) return buildPayloadFromPatch(patch);

  if (patch.kind === 'chatInject' && existing.kind === 'chatInject') {
    return {
      kind: 'chatInject',
      chatId: typeof patch.chatId === 'string' ? patch.chatId : existing.chatId,
      message: typeof patch.message === 'string' ? patch.message : existing.message,
    };
  }

  if (patch.kind === 'agentTurn' && existing.kind === 'agentTurn') {
    return {
      kind: 'agentTurn',
      message: typeof patch.message === 'string' ? patch.message : existing.message,
      model: typeof patch.model === 'string' ? patch.model : existing.model,
      timeoutMs: typeof patch.timeoutMs === 'number' ? patch.timeoutMs : existing.timeoutMs,
    };
  }

  return buildPayloadFromPatch(patch);
};

const buildPayloadFromPatch = (patch: TaskPayloadPatch): TaskPayload => {
  if (patch.kind === 'chatInject') {
    if (typeof patch.chatId !== 'string' || !patch.chatId) {
      throw new Error('chatInject payload requires chatId');
    }
    if (typeof patch.message !== 'string' || !patch.message) {
      throw new Error('chatInject payload requires message');
    }
    return { kind: 'chatInject', chatId: patch.chatId, message: patch.message };
  }

  if (typeof patch.message !== 'string' || !patch.message) {
    throw new Error('agentTurn payload requires message');
  }
  return {
    kind: 'agentTurn',
    message: patch.message,
    model: patch.model,
    timeoutMs: patch.timeoutMs,
  };
};

const isTaskDue = (task: ScheduledTask, nowMs: number, opts: { forced: boolean }): boolean => {
  if (opts.forced) return true;
  return (
    task.enabled && typeof task.state.nextRunAtMs === 'number' && nowMs >= task.state.nextRunAtMs
  );
};

export {
  findTaskOrThrow,
  computeTaskNextRunAtMs,
  recomputeNextRuns,
  nextWakeAtMs,
  createTask,
  applyTaskPatch,
  isTaskDue,
};
