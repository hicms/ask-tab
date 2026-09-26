import {
  createTask,
  applyTaskPatch,
  computeTaskNextRunAtMs,
  recomputeNextRuns,
  nextWakeAtMs,
  findTaskOrThrow,
  isTaskDue,
} from './service/jobs';
import { describe, expect, it } from 'vitest';
import type { CronState } from './service/state';
import type { ScheduledTask } from './types';

const makeState = (tasks: ScheduledTask[] = []): CronState => ({
  deps: {
    nowMs: () => Date.now(),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    executeTask: async () => ({ status: 'ok' }),
  },
  store: { tasks },
  started: false,
  running: false,
  op: Promise.resolve(),
});

const makeTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  name: 'Test task',
  enabled: true,
  createdAt: 1000,
  updatedAt: 1000,
  schedule: { kind: 'every', everyMs: 60_000 },
  payload: { kind: 'agentTurn', message: 'hello' },
  state: {},
  ...overrides,
});

describe('createTask', () => {
  it('creates a task with a generated id and timestamps', () => {
    const now = 5000;
    const state = makeState();
    state.deps.nowMs = () => now;
    const task = createTask(state, {
      name: 'My Task',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      payload: { kind: 'agentTurn', message: 'do something' },
    });
    expect(task.id).toBeTruthy();
    expect(task.name).toBe('My Task');
    expect(task.createdAt).toBe(now);
    expect(task.updatedAt).toBe(now);
    expect(task.enabled).toBe(true);
    expect(task.state.nextRunAtMs).toBeDefined();
  });

  it('defaults name to "Untitled task" when empty', () => {
    const state = makeState();
    const task = createTask(state, {
      name: '  ',
      enabled: true,
      schedule: { kind: 'at', atMs: Date.now() + 10000 },
      payload: { kind: 'agentTurn', message: 'test' },
    });
    expect(task.name).toBe('Untitled task');
  });

  it('defaults enabled to true when not specified as false', () => {
    const state = makeState();
    const task = createTask(state, {
      name: 'test',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      payload: { kind: 'agentTurn', message: 'test' },
    });
    expect(task.enabled).toBe(true);
  });
});

describe('computeTaskNextRunAtMs', () => {
  it('returns undefined when task is disabled', () => {
    const task = makeTask({ enabled: false });
    expect(computeTaskNextRunAtMs(task, 1000)).toBeUndefined();
  });

  it('returns undefined for one-shot "at" after successful run', () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: 5000 },
      state: { lastStatus: 'ok', lastRunAtMs: 5000 },
    });
    expect(computeTaskNextRunAtMs(task, 6000)).toBeUndefined();
  });

  it('returns atMs for one-shot "at" that has not run yet', () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: 5000 },
      state: {},
    });
    expect(computeTaskNextRunAtMs(task, 1000)).toBe(5000);
  });

  it('returns atMs for one-shot "at" that failed', () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: 5000 },
      state: { lastStatus: 'error', lastRunAtMs: 5000 },
    });
    expect(computeTaskNextRunAtMs(task, 6000)).toBe(5000);
  });

  it('computes next run for "every" schedule', () => {
    const task = makeTask({
      schedule: { kind: 'every', everyMs: 60_000, anchorMs: 0 },
    });
    const result = computeTaskNextRunAtMs(task, 90_000);
    expect(result).toBe(120_000);
  });
});

describe('applyTaskPatch', () => {
  it('updates name', () => {
    const task = makeTask({ name: 'Old name' });
    applyTaskPatch(task, { name: 'New name' });
    expect(task.name).toBe('New name');
  });

  it('does not clear name when patching with empty string', () => {
    const task = makeTask({ name: 'Keep this' });
    applyTaskPatch(task, { name: '' });
    expect(task.name).toBe('Keep this');
  });

  it('updates enabled flag', () => {
    const task = makeTask({ enabled: true });
    applyTaskPatch(task, { enabled: false });
    expect(task.enabled).toBe(false);
  });

  it('updates schedule', () => {
    const task = makeTask({ schedule: { kind: 'every', everyMs: 60_000 } });
    applyTaskPatch(task, { schedule: { kind: 'at', atMs: 99999 } });
    expect(task.schedule).toEqual({ kind: 'at', atMs: 99999 });
  });

  it('merges agentTurn payload partially', () => {
    const task = makeTask({
      payload: { kind: 'agentTurn', message: 'old', model: 'gpt-4' },
    });
    applyTaskPatch(task, { payload: { kind: 'agentTurn', message: 'new' } });
    expect(task.payload).toEqual({ kind: 'agentTurn', message: 'new', model: 'gpt-4' });
  });

  it('replaces payload when kind changes', () => {
    const task = makeTask({
      payload: { kind: 'agentTurn', message: 'old' },
    });
    applyTaskPatch(task, {
      payload: { kind: 'chatInject', chatId: 'c1', message: 'inject' },
    });
    expect(task.payload).toEqual({ kind: 'chatInject', chatId: 'c1', message: 'inject' });
  });

  it('throws when building chatInject payload without chatId', () => {
    const task = makeTask({
      payload: { kind: 'agentTurn', message: 'old' },
    });
    expect(() =>
      applyTaskPatch(task, { payload: { kind: 'chatInject', message: 'test' } }),
    ).toThrow('chatInject payload requires chatId');
  });

  it('throws when building agentTurn payload without message', () => {
    const task = makeTask({
      payload: { kind: 'chatInject', chatId: 'c1', message: 'old' },
    });
    expect(() => applyTaskPatch(task, { payload: { kind: 'agentTurn' } })).toThrow(
      'agentTurn payload requires message',
    );
  });

  it('merges chatInject payload partially (same kind)', () => {
    const task = makeTask({
      payload: { kind: 'chatInject', chatId: 'c1', message: 'old message' },
    });
    applyTaskPatch(task, { payload: { kind: 'chatInject', message: 'new message' } });
    expect(task.payload).toEqual({
      kind: 'chatInject',
      chatId: 'c1',
      message: 'new message',
    });
  });

  it('merges chatInject payload — updates chatId only', () => {
    const task = makeTask({
      payload: { kind: 'chatInject', chatId: 'c1', message: 'keep' },
    });
    applyTaskPatch(task, { payload: { kind: 'chatInject', chatId: 'c2' } });
    expect(task.payload).toEqual({
      kind: 'chatInject',
      chatId: 'c2',
      message: 'keep',
    });
  });

  it('throws when building chatInject payload without message', () => {
    const task = makeTask({
      payload: { kind: 'agentTurn', message: 'old' },
    });
    expect(() => applyTaskPatch(task, { payload: { kind: 'chatInject', chatId: 'c1' } })).toThrow(
      'chatInject payload requires message',
    );
  });

  it('falls through to buildPayloadFromPatch when same kind but unmatched (edge)', () => {
    // This covers the fallthrough at line 106
    const task = makeTask({
      payload: { kind: 'agentTurn', message: 'old' },
    });
    applyTaskPatch(task, {
      payload: { kind: 'agentTurn', message: 'new', model: 'gpt-4o', timeoutMs: 5000 },
    });
    expect(task.payload).toEqual({
      kind: 'agentTurn',
      message: 'new',
      model: 'gpt-4o',
      timeoutMs: 5000,
    });
  });

  it('updates timeoutMs', () => {
    const task = makeTask();
    applyTaskPatch(task, { timeoutMs: 120_000 });
    expect(task.timeoutMs).toBe(120_000);
  });
});

describe('isTaskDue', () => {
  it('returns true when forced', () => {
    const task = makeTask({ enabled: false, state: {} });
    expect(isTaskDue(task, 1000, { forced: true })).toBe(true);
  });

  it('returns true when enabled and nextRunAtMs has passed', () => {
    const task = makeTask({ state: { nextRunAtMs: 1000 } });
    expect(isTaskDue(task, 2000, { forced: false })).toBe(true);
  });

  it('returns false when disabled', () => {
    const task = makeTask({ enabled: false, state: { nextRunAtMs: 1000 } });
    expect(isTaskDue(task, 2000, { forced: false })).toBe(false);
  });

  it('returns false when nextRunAtMs is in the future', () => {
    const task = makeTask({ state: { nextRunAtMs: 5000 } });
    expect(isTaskDue(task, 2000, { forced: false })).toBe(false);
  });

  it('returns false when nextRunAtMs is undefined', () => {
    const task = makeTask({ state: {} });
    expect(isTaskDue(task, 2000, { forced: false })).toBe(false);
  });
});

describe('findTaskOrThrow', () => {
  it('returns the task when found', () => {
    const task = makeTask({ id: 'abc' });
    const state = makeState([task]);
    expect(findTaskOrThrow(state, 'abc')).toBe(task);
  });

  it('throws when task not found', () => {
    const state = makeState([]);
    expect(() => findTaskOrThrow(state, 'missing')).toThrow('unknown task id: missing');
  });
});

describe('nextWakeAtMs', () => {
  it('returns undefined when no enabled tasks with nextRunAtMs', () => {
    const state = makeState([makeTask({ enabled: false })]);
    expect(nextWakeAtMs(state)).toBeUndefined();
  });

  it('returns the minimum nextRunAtMs across enabled tasks', () => {
    const state = makeState([
      makeTask({ id: 'a', state: { nextRunAtMs: 5000 } }),
      makeTask({ id: 'b', state: { nextRunAtMs: 3000 } }),
      makeTask({ id: 'c', state: { nextRunAtMs: 8000 } }),
    ]);
    expect(nextWakeAtMs(state)).toBe(3000);
  });

  it('ignores disabled tasks', () => {
    const state = makeState([
      makeTask({ id: 'a', enabled: false, state: { nextRunAtMs: 1000 } }),
      makeTask({ id: 'b', state: { nextRunAtMs: 5000 } }),
    ]);
    expect(nextWakeAtMs(state)).toBe(5000);
  });
});

describe('recomputeNextRuns', () => {
  it('clears nextRunAtMs for disabled tasks', () => {
    const task = makeTask({ enabled: false, state: { nextRunAtMs: 5000, runningAtMs: 1000 } });
    const state = makeState([task]);
    recomputeNextRuns(state);
    expect(task.state.nextRunAtMs).toBeUndefined();
    expect(task.state.runningAtMs).toBeUndefined();
  });

  it('computes nextRunAtMs for enabled tasks', () => {
    const task = makeTask({
      schedule: { kind: 'every', everyMs: 60_000, anchorMs: 0 },
      state: {},
    });
    const state = makeState([task]);
    state.deps.nowMs = () => 90_000;
    recomputeNextRuns(state);
    expect(task.state.nextRunAtMs).toBe(120_000);
  });

  it('initializes empty state object', () => {
    const task = makeTask();
    (task as { state: unknown }).state = undefined;
    const state = makeState([task]);
    recomputeNextRuns(state);
    expect(task.state).toBeDefined();
  });
});
