import { chatDb } from '@storage-internal/chat-db';
import {
  listScheduledTasks,
  getScheduledTask,
  bulkPutScheduledTasks,
  deleteScheduledTask,
  appendTaskRunLog,
  getTaskRunLogs,
} from '@storage-internal/chat-storage';
import { describe, expect, it, beforeEach } from 'vitest';
import type { DbScheduledTask, DbTaskRunLog } from '@storage-internal/chat-db';

const makeDbTask = (overrides: Partial<DbScheduledTask> & { id: string }): DbScheduledTask => ({
  name: 'Test task',
  enabled: true,
  createdAt: 1000,
  updatedAt: 1000,
  schedule: { kind: 'every', everyMs: 60000 },
  payload: { kind: 'agentTurn', message: 'hello' },
  state: {},
  ...overrides,
});

beforeEach(async () => {
  await chatDb.scheduledTasks.clear();
  await chatDb.taskRunLogs.clear();
});

describe('scheduledTasks CRUD', () => {
  it('listScheduledTasks returns all tasks', async () => {
    await chatDb.scheduledTasks.bulkPut([makeDbTask({ id: 't1' }), makeDbTask({ id: 't2' })]);
    const tasks = await listScheduledTasks();
    expect(tasks).toHaveLength(2);
  });

  it('getScheduledTask returns a task by id', async () => {
    await chatDb.scheduledTasks.put(makeDbTask({ id: 't1', name: 'Special' }));
    const task = await getScheduledTask('t1');
    expect(task).toBeDefined();
    expect(task!.name).toBe('Special');
  });

  it('getScheduledTask returns undefined for missing id', async () => {
    const task = await getScheduledTask('nonexistent');
    expect(task).toBeUndefined();
  });

  it('bulkPutScheduledTasks upserts tasks', async () => {
    await bulkPutScheduledTasks([makeDbTask({ id: 't1', name: 'V1' })]);
    await bulkPutScheduledTasks([makeDbTask({ id: 't1', name: 'V2' })]);
    const task = await getScheduledTask('t1');
    expect(task!.name).toBe('V2');
  });

  it('deleteScheduledTask removes task and its run logs', async () => {
    await chatDb.scheduledTasks.put(makeDbTask({ id: 't1' }));
    await chatDb.taskRunLogs.bulkPut([
      { id: 'r1', taskId: 't1', timestamp: 1000, status: 'ok' },
      { id: 'r2', taskId: 't1', timestamp: 2000, status: 'error' },
      { id: 'r3', taskId: 't2', timestamp: 3000, status: 'ok' },
    ]);

    await deleteScheduledTask('t1');

    expect(await getScheduledTask('t1')).toBeUndefined();
    expect(await chatDb.taskRunLogs.where('taskId').equals('t1').count()).toBe(0);
    // t2's log should still exist
    expect(await chatDb.taskRunLogs.where('taskId').equals('t2').count()).toBe(1);
  });
});

describe('taskRunLogs CRUD', () => {
  it('appendTaskRunLog adds an entry', async () => {
    const entry: DbTaskRunLog = {
      id: 'r1',
      taskId: 't1',
      timestamp: Date.now(),
      status: 'ok',
      durationMs: 500,
    };
    await appendTaskRunLog(entry);
    const logs = await getTaskRunLogs('t1');
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe('r1');
  });

  it('getTaskRunLogs returns logs sorted by timestamp', async () => {
    await chatDb.taskRunLogs.bulkPut([
      { id: 'r1', taskId: 't1', timestamp: 3000, status: 'ok' },
      { id: 'r2', taskId: 't1', timestamp: 1000, status: 'ok' },
      { id: 'r3', taskId: 't1', timestamp: 2000, status: 'error' },
    ]);
    const logs = await getTaskRunLogs('t1');
    expect(logs.map(l => l.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it('getTaskRunLogs respects limit — returns most recent', async () => {
    for (let i = 0; i < 10; i++) {
      await chatDb.taskRunLogs.put({
        id: `r${i}`,
        taskId: 't1',
        timestamp: i * 1000,
        status: 'ok',
      });
    }
    const logs = await getTaskRunLogs('t1', 3);
    expect(logs).toHaveLength(3);
    expect(logs[0].timestamp).toBe(7000);
  });

  it('appendTaskRunLog prunes when exceeding 200 entries', async () => {
    // Add 201 entries
    for (let i = 0; i < 201; i++) {
      await chatDb.taskRunLogs.put({
        id: `r${i}`,
        taskId: 't1',
        timestamp: i,
        status: 'ok',
      });
    }

    // Append one more — should trigger prune
    await appendTaskRunLog({
      id: 'r-new',
      taskId: 't1',
      timestamp: 999999,
      status: 'ok',
    });

    const count = await chatDb.taskRunLogs.where('taskId').equals('t1').count();
    expect(count).toBeLessThanOrEqual(200);
  });
});
