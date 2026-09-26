// ── Dexie-backed run log for scheduled tasks ──

import { appendTaskRunLog, getTaskRunLogs } from '@extension/storage';
import { nanoid } from 'nanoid';
import type { DbTaskRunLog } from '@extension/storage';

export type RunLogEntry = {
  taskId: string;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  durationMs?: number;
  chatId?: string;
};

export const appendRunLog = async (entry: RunLogEntry): Promise<void> => {
  const row: DbTaskRunLog = {
    id: nanoid(),
    taskId: entry.taskId,
    timestamp: Date.now(),
    status: entry.status,
    error: entry.error,
    durationMs: entry.durationMs,
    chatId: entry.chatId,
  };
  await appendTaskRunLog(row);
};

export const readRunLogs = async (taskId: string, limit = 50): Promise<DbTaskRunLog[]> =>
  getTaskRunLogs(taskId, limit);
