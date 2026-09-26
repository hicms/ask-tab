import { ensureLoaded, persist, markDirty, markRemoved } from './store';
import { chatDb } from '@storage-internal/chat-db';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { CronState } from './service/state';

const makeState = (): CronState => ({
  deps: {
    nowMs: () => Date.now(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    executeTask: async () => ({ status: 'ok' }),
  },
  store: null,
  started: false,
  running: false,
  op: Promise.resolve(),
});

beforeEach(async () => {
  await chatDb.scheduledTasks.clear();
  await chatDb.taskRunLogs.clear();
});

describe('ensureLoaded', () => {
  it('loads tasks from IndexedDB', async () => {
    await chatDb.scheduledTasks.put({
      id: 't1',
      name: 'Test',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      schedule: { kind: 'every', everyMs: 60000 },
      payload: { kind: 'agentTurn', message: 'hello' },
      state: {},
    });
    const state = makeState();
    await ensureLoaded(state);
    expect(state.store).not.toBeNull();
    expect(state.store!.tasks).toHaveLength(1);
    expect(state.store!.tasks[0].name).toBe('Test');
  });

  it('does not reload if already loaded', async () => {
    const state = makeState();
    state.store = { tasks: [] };
    await ensureLoaded(state);
    expect(state.store.tasks).toHaveLength(0);
  });

  it('clears stuck running markers older than 2 hours', async () => {
    const twoHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    await chatDb.scheduledTasks.put({
      id: 't1',
      name: 'Stuck',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      schedule: { kind: 'every', everyMs: 60000 },
      payload: { kind: 'agentTurn', message: 'test' },
      state: { runningAtMs: twoHoursAgo },
    });
    const state = makeState();
    await ensureLoaded(state);
    expect(state.store!.tasks[0].state.runningAtMs).toBeUndefined();
    expect(state.deps.log.warn).toHaveBeenCalledWith(
      'Clearing stuck running marker',
      expect.objectContaining({ taskId: 't1' }),
    );
  });

  it('does not clear recent running markers', async () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    await chatDb.scheduledTasks.put({
      id: 't1',
      name: 'Running',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      schedule: { kind: 'every', everyMs: 60000 },
      payload: { kind: 'agentTurn', message: 'test' },
      state: { runningAtMs: fiveMinAgo },
    });
    const state = makeState();
    await ensureLoaded(state);
    expect(state.store!.tasks[0].state.runningAtMs).toBe(fiveMinAgo);
  });
});

describe('persist with dirty tracking', () => {
  it('only writes dirty tasks', async () => {
    await chatDb.scheduledTasks.bulkPut([
      {
        id: 't1',
        name: 'Task 1',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        schedule: { kind: 'every', everyMs: 60000 },
        payload: { kind: 'agentTurn', message: 'a' },
        state: {},
      },
      {
        id: 't2',
        name: 'Task 2',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        schedule: { kind: 'every', everyMs: 60000 },
        payload: { kind: 'agentTurn', message: 'b' },
        state: {},
      },
    ]);

    const state = makeState();
    await ensureLoaded(state);

    // Only modify task 1
    state.store!.tasks[0].name = 'Updated Task 1';
    markDirty('t1');

    await persist(state);

    // Verify t1 was updated
    const t1 = await chatDb.scheduledTasks.get('t1');
    expect(t1!.name).toBe('Updated Task 1');

    // Verify t2 was NOT rewritten (still has original name)
    const t2 = await chatDb.scheduledTasks.get('t2');
    expect(t2!.name).toBe('Task 2');
  });

  it('does nothing when no tasks are dirty', async () => {
    const state = makeState();
    state.store = { tasks: [] };
    // Should not throw or do anything
    await persist(state);
  });

  it('handles markRemoved by deleting from IndexedDB', async () => {
    await chatDb.scheduledTasks.put({
      id: 't1',
      name: 'To Delete',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      schedule: { kind: 'every', everyMs: 60000 },
      payload: { kind: 'agentTurn', message: 'test' },
      state: {},
    });
    await chatDb.taskRunLogs.put({
      id: 'r1',
      taskId: 't1',
      timestamp: Date.now(),
      status: 'ok',
    });

    const state = makeState();
    await ensureLoaded(state);
    state.store!.tasks = [];
    markRemoved('t1');

    await persist(state);

    expect(await chatDb.scheduledTasks.get('t1')).toBeUndefined();
    expect(await chatDb.taskRunLogs.where('taskId').equals('t1').count()).toBe(0);
  });
});
