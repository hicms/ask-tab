// ── Cron service state ──────────────────────

import type { ScheduledTask } from '../types';

export type CronEvent = {
  taskId: string;
  action: 'added' | 'updated' | 'removed' | 'started' | 'finished';
  runAtMs?: number;
  durationMs?: number;
  status?: 'ok' | 'error' | 'skipped';
  error?: string;
  nextRunAtMs?: number;
  chatId?: string;
};

export type TaskExecResult = {
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  chatId?: string;
};

export type CronLogger = {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
};

export type CronDeps = {
  nowMs?: () => number;
  log: CronLogger;
  executeTask: (task: ScheduledTask) => Promise<TaskExecResult>;
  onEvent?: (evt: CronEvent) => void;
};

export type CronDepsInternal = Omit<CronDeps, 'nowMs'> & {
  nowMs: () => number;
};

export type CronStore = {
  tasks: ScheduledTask[];
};

export type CronState = {
  deps: CronDepsInternal;
  store: CronStore | null;
  started: boolean;
  running: boolean;
  op: Promise<unknown>;
};

export const createCronState = (deps: CronDeps): CronState => ({
  deps: { ...deps, nowMs: deps.nowMs ?? (() => Date.now()) },
  store: null,
  started: false,
  running: false,
  op: Promise.resolve(),
});

export type CronStatusSummary = {
  running: boolean;
  tasks: number;
  nextWakeAtMs: number | null;
};
