import { executeTask, emit, errorBackoffMs, onAlarm, armTimer, stopTimer } from './service/timer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CronState, CronEvent } from './service/state';
import type { ScheduledTask } from './types';

// Mock chrome.alarms
Object.defineProperty(globalThis, 'chrome', {
  value: {
    alarms: {
      create: vi.fn(),
      clear: vi.fn(() => Promise.resolve()),
    },
  },
  writable: true,
  configurable: true,
});

// Mock run-log
vi.mock('../cron/run-log', () => ({
  appendRunLog: vi.fn(() => Promise.resolve()),
}));

// Mock store
vi.mock('../cron/store', () => ({
  ensureLoaded: vi.fn(() => Promise.resolve()),
  persist: vi.fn(() => Promise.resolve()),
  markDirty: vi.fn(),
  markRemoved: vi.fn(),
}));

// Mock @extension/storage (for reapCronSessions import)
vi.mock('@extension/storage', () => ({
  reapCronSessions: vi.fn(() => Promise.resolve(0)),
}));

const makeTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  name: 'Test task',
  enabled: true,
  createdAt: 1000,
  updatedAt: 1000,
  schedule: { kind: 'every', everyMs: 60_000, anchorMs: 0 },
  payload: { kind: 'agentTurn', message: 'hello' },
  state: {},
  ...overrides,
});

const makeState = (tasks: ScheduledTask[] = []): CronState => ({
  deps: {
    nowMs: () => Date.now(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    executeTask: vi.fn(async () => ({ status: 'ok' as const })),
    onEvent: vi.fn(),
  },
  store: { tasks },
  started: true,
  running: false,
  op: Promise.resolve(),
});

describe('executeTask', () => {
  it('marks task as running and emits started event', async () => {
    const task = makeTask();
    const state = makeState([task]);
    const startTime = Date.now();
    state.deps.nowMs = () => startTime;

    await executeTask(state, task, startTime, { forced: false });

    expect(state.deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', action: 'started' }),
    );
  });

  it('calls executeTask dep and emits finished event on success', async () => {
    const task = makeTask();
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const, chatId: 'chat-1' }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(state.deps.executeTask).toHaveBeenCalledWith(task);
    expect(state.deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', action: 'finished', status: 'ok' }),
    );
  });

  it('updates task state after successful execution', async () => {
    const task = makeTask();
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.state.runningAtMs).toBeUndefined();
    expect(task.state.lastStatus).toBe('ok');
    expect(task.state.lastRunAtMs).toBeDefined();
    expect(task.state.lastDurationMs).toBeDefined();
    expect(task.state.lastError).toBeUndefined();
  });

  it('records error status when executeTask throws', async () => {
    const task = makeTask();
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => {
      throw new Error('executor failed');
    });

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.state.lastStatus).toBe('error');
    expect(task.state.lastError).toBe('Error: executor failed');
  });

  it('disables one-shot "at" task after successful run', async () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: Date.now() - 1000 },
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.enabled).toBe(false);
    expect(task.state.nextRunAtMs).toBeUndefined();
  });

  it('deletes one-shot "at" task with deleteAfterRun on success', async () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: Date.now() - 1000 },
      deleteAfterRun: true,
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(state.store!.tasks).toHaveLength(0);
    expect(state.deps.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', action: 'removed' }),
    );
  });

  it('disables one-shot "at" task after failed run (no infinite retry)', async () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: Date.now() - 1000 },
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({
      status: 'error' as const,
      error: 'executor failed',
    }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.enabled).toBe(false);
    expect(task.state.nextRunAtMs).toBeUndefined();
    expect(task.state.lastStatus).toBe('error');
    expect(task.state.lastError).toBe('executor failed');
  });

  it('does not delete one-shot task on error', async () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: Date.now() - 1000 },
      deleteAfterRun: true,
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({
      status: 'error' as const,
      error: 'failed',
    }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(state.store!.tasks).toHaveLength(1);
  });

  it('does not delete one-shot task with deleteAfterRun on forced run', async () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: Date.now() + 60_000 },
      deleteAfterRun: true,
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, Date.now(), { forced: true });

    // Task should still exist — forced run should not trigger deleteAfterRun
    expect(state.store!.tasks).toHaveLength(1);
    expect(task.enabled).toBe(true);
    expect(task.state.lastStatus).toBe('ok');
  });

  it('does not disable one-shot task on forced run', async () => {
    const futureMs = Date.now() + 60_000;
    const task = makeTask({
      schedule: { kind: 'at', atMs: futureMs },
      state: { nextRunAtMs: futureMs },
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, Date.now(), { forced: true });

    // Task should remain enabled with its scheduled time preserved
    expect(task.enabled).toBe(true);
    expect(task.state.lastStatus).toBe('ok');
  });

  it('recomputes nextRunAtMs for recurring task', async () => {
    const now = Date.now();
    const task = makeTask({
      schedule: { kind: 'every', everyMs: 60_000, anchorMs: now - 90_000 },
      state: { nextRunAtMs: now - 1000 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, now, { forced: false });

    expect(task.state.nextRunAtMs).toBeDefined();
    expect(task.state.nextRunAtMs!).toBeGreaterThan(now);
  });
});

describe('error backoff', () => {
  it('increments consecutiveErrors on error', async () => {
    const task = makeTask({ state: { consecutiveErrors: 0 } });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({
      status: 'error' as const,
      error: 'fail',
    }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.state.consecutiveErrors).toBe(1);
  });

  it('resets consecutiveErrors on success', async () => {
    const task = makeTask({ state: { consecutiveErrors: 3 } });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({ status: 'ok' as const }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.state.consecutiveErrors).toBe(0);
  });

  it('applies 30s backoff on first error for recurring task', async () => {
    const now = 1_000_000;
    const task = makeTask({
      schedule: { kind: 'every', everyMs: 60_000, anchorMs: 0 },
      state: { consecutiveErrors: 0 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;
    state.deps.executeTask = vi.fn(async () => ({
      status: 'error' as const,
      error: 'fail',
    }));

    await executeTask(state, task, now, { forced: false });

    expect(task.state.consecutiveErrors).toBe(1);
    // backoff for 1 error = 30s. Normal next would be ~now+60s.
    // Since endedAt = now, backoff = now + 30_000
    // Normal next from every schedule would be >= now
    // The actual nextRunAtMs should be max(normalNext, now + 30_000)
    expect(task.state.nextRunAtMs).toBeDefined();
    expect(task.state.nextRunAtMs!).toBeGreaterThanOrEqual(now + 30_000);
  });

  it('applies increasing backoff on consecutive errors', async () => {
    const now = 1_000_000;
    const task = makeTask({
      schedule: { kind: 'every', everyMs: 60_000, anchorMs: 0 },
      state: { consecutiveErrors: 2 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;
    state.deps.executeTask = vi.fn(async () => ({
      status: 'error' as const,
      error: 'fail again',
    }));

    await executeTask(state, task, now, { forced: false });

    expect(task.state.consecutiveErrors).toBe(3);
    // backoff for 3 errors = 5 * 60_000 = 300_000 (5 min)
    expect(task.state.nextRunAtMs).toBeDefined();
    expect(task.state.nextRunAtMs!).toBeGreaterThanOrEqual(now + 5 * 60_000);
  });

  it('does not apply backoff to one-shot tasks (they get disabled)', async () => {
    const task = makeTask({
      schedule: { kind: 'at', atMs: Date.now() - 1000 },
      state: { consecutiveErrors: 0 },
    });
    const state = makeState([task]);
    state.deps.executeTask = vi.fn(async () => ({
      status: 'error' as const,
      error: 'fail',
    }));

    await executeTask(state, task, Date.now(), { forced: false });

    expect(task.enabled).toBe(false);
    expect(task.state.nextRunAtMs).toBeUndefined();
    expect(task.state.consecutiveErrors).toBe(1);
  });
});

describe('errorBackoffMs', () => {
  it('returns 30s for 1 error', () => {
    expect(errorBackoffMs(1)).toBe(30_000);
  });

  it('returns 60s for 2 errors', () => {
    expect(errorBackoffMs(2)).toBe(60_000);
  });

  it('returns 5m for 3 errors', () => {
    expect(errorBackoffMs(3)).toBe(5 * 60_000);
  });

  it('returns 15m for 4 errors', () => {
    expect(errorBackoffMs(4)).toBe(15 * 60_000);
  });

  it('returns 1h for 5+ errors', () => {
    expect(errorBackoffMs(5)).toBe(60 * 60_000);
    expect(errorBackoffMs(10)).toBe(60 * 60_000);
    expect(errorBackoffMs(100)).toBe(60 * 60_000);
  });
});

describe('emit', () => {
  it('calls onEvent when provided', () => {
    const handler = vi.fn();
    const state = makeState();
    state.deps.onEvent = handler;
    const evt: CronEvent = { taskId: 'x', action: 'started' };
    emit(state, evt);
    expect(handler).toHaveBeenCalledWith(evt);
  });

  it('silently ignores errors from onEvent', () => {
    const state = makeState();
    state.deps.onEvent = () => {
      throw new Error('handler crash');
    };
    expect(() => emit(state, { taskId: 'x', action: 'started' })).not.toThrow();
  });

  it('does nothing when onEvent is not set', () => {
    const state = makeState();
    state.deps.onEvent = undefined;
    expect(() => emit(state, { taskId: 'x', action: 'started' })).not.toThrow();
  });
});

describe('onAlarm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when already running', async () => {
    const state = makeState();
    state.running = true;

    await onAlarm(state);

    // executeTask should not have been called
    expect(state.deps.executeTask).not.toHaveBeenCalled();
  });

  it('runs due jobs and persists state', async () => {
    const now = Date.now();
    const task = makeTask({
      state: { nextRunAtMs: now - 1000 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;

    await onAlarm(state);

    expect(state.deps.executeTask).toHaveBeenCalledWith(task);
    expect(state.running).toBe(false);
  });

  it('skips disabled tasks', async () => {
    const now = Date.now();
    const task = makeTask({
      enabled: false,
      state: { nextRunAtMs: now - 1000 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;

    await onAlarm(state);

    expect(state.deps.executeTask).not.toHaveBeenCalled();
  });

  it('skips tasks that are already running', async () => {
    const now = Date.now();
    const task = makeTask({
      state: { nextRunAtMs: now - 1000, runningAtMs: now - 500 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;

    await onAlarm(state);

    expect(state.deps.executeTask).not.toHaveBeenCalled();
  });

  it('skips tasks not yet due', async () => {
    const now = Date.now();
    const task = makeTask({
      state: { nextRunAtMs: now + 60_000 },
    });
    const state = makeState([task]);
    state.deps.nowMs = () => now;

    await onAlarm(state);

    expect(state.deps.executeTask).not.toHaveBeenCalled();
  });

  it('skips tasks without nextRunAtMs', async () => {
    const task = makeTask({ state: {} });
    const state = makeState([task]);

    await onAlarm(state);

    expect(state.deps.executeTask).not.toHaveBeenCalled();
  });
});

describe('armTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears alarm when no next wake time', () => {
    // State with no tasks = no next wake
    const state = makeState([]);

    armTimer(state);

    expect(chrome.alarms.clear).toHaveBeenCalledWith('deepchat-cron');
  });

  it('creates alarm with correct when value', () => {
    const now = Date.now();
    const futureMs = now + 60_000;
    const task = makeTask({
      enabled: true,
      state: { nextRunAtMs: futureMs },
    });
    const state = makeState([task]);

    armTimer(state);

    expect(chrome.alarms.create).toHaveBeenCalledWith('deepchat-cron', {
      when: expect.any(Number),
    });
  });
});

describe('stopTimer', () => {
  it('clears the cron alarm', () => {
    stopTimer();
    expect(chrome.alarms.clear).toHaveBeenCalledWith('deepchat-cron');
  });
});
