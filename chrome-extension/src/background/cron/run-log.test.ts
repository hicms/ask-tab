import { appendRunLog, readRunLogs } from './run-log';
import { chatDb } from '@storage-internal/chat-db';
import { describe, expect, it, beforeEach } from 'vitest';

beforeEach(async () => {
  await chatDb.taskRunLogs.clear();
});

describe('appendRunLog', () => {
  it('writes a run log entry to IndexedDB', async () => {
    await appendRunLog({
      taskId: 't1',
      status: 'ok',
      durationMs: 1234,
      chatId: 'c1',
    });

    const logs = await chatDb.taskRunLogs.where('taskId').equals('t1').toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('ok');
    expect(logs[0].durationMs).toBe(1234);
    expect(logs[0].chatId).toBe('c1');
    expect(logs[0].timestamp).toBeGreaterThan(0);
    expect(logs[0].id).toBeTruthy();
  });

  it('stores error information', async () => {
    await appendRunLog({
      taskId: 't1',
      status: 'error',
      error: 'connection timeout',
    });

    const logs = await chatDb.taskRunLogs.where('taskId').equals('t1').toArray();
    expect(logs[0].status).toBe('error');
    expect(logs[0].error).toBe('connection timeout');
  });
});

describe('readRunLogs', () => {
  it('returns logs for a specific task', async () => {
    await chatDb.taskRunLogs.bulkPut([
      { id: 'r1', taskId: 't1', timestamp: 1000, status: 'ok' },
      { id: 'r2', taskId: 't2', timestamp: 2000, status: 'ok' },
      { id: 'r3', taskId: 't1', timestamp: 3000, status: 'error' },
    ]);

    const logs = await readRunLogs('t1');
    expect(logs).toHaveLength(2);
    expect(logs.every(l => l.taskId === 't1')).toBe(true);
  });

  it('returns logs sorted by timestamp', async () => {
    await chatDb.taskRunLogs.bulkPut([
      { id: 'r1', taskId: 't1', timestamp: 3000, status: 'ok' },
      { id: 'r2', taskId: 't1', timestamp: 1000, status: 'ok' },
      { id: 'r3', taskId: 't1', timestamp: 2000, status: 'error' },
    ]);

    const logs = await readRunLogs('t1');
    expect(logs.map(l => l.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await chatDb.taskRunLogs.put({
        id: `r${i}`,
        taskId: 't1',
        timestamp: i * 1000,
        status: 'ok',
      });
    }

    const logs = await readRunLogs('t1', 3);
    expect(logs).toHaveLength(3);
    // Should return the 3 most recent
    expect(logs[0].timestamp).toBe(7000);
    expect(logs[2].timestamp).toBe(9000);
  });

  it('returns empty array for unknown task', async () => {
    const logs = await readRunLogs('nonexistent');
    expect(logs).toEqual([]);
  });
});
