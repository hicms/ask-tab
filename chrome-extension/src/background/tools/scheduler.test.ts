import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronService } from '../cron';

// ---------------------------------------------------------------------------
// Chrome API mocks — required before importing scheduler (cron depends on it)
// ---------------------------------------------------------------------------

Object.defineProperty(globalThis, 'chrome', {
  value: {
    alarms: {
      create: vi.fn(),
      clear: vi.fn(() => Promise.resolve()),
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
    },
  },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../cron', () => ({
  readRunLogs: vi.fn(async () => [{ runAtMs: 1000, status: 'ok' }]),
}));

vi.mock('@extension/storage', () => ({
  listScheduledTasks: vi.fn(() => Promise.resolve([])),
  bulkPutScheduledTasks: vi.fn(() => Promise.resolve()),
  deleteScheduledTask: vi.fn(() => Promise.resolve()),
  getTaskRunLogs: vi.fn(() => Promise.resolve([])),
  appendTaskRunLog: vi.fn(() => Promise.resolve()),
  serverModelsStorage: { get: vi.fn(() => Promise.resolve([])) },
  selectedModelStorage: { get: vi.fn(() => Promise.resolve(null)) },
  getEnabledWorkspaceFiles: vi.fn(() => Promise.resolve([])),
  getEnabledSkills: vi.fn(() => Promise.resolve([])),
  createChat: vi.fn(() => Promise.resolve()),
  addMessage: vi.fn(() => Promise.resolve()),
  touchChat: vi.fn(() => Promise.resolve()),
  updateSessionTokens: vi.fn(() => Promise.resolve()),
  getChat: vi.fn(() => Promise.resolve(undefined)),
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve({ enabled: false, level: 'info' })),
    subscribe: vi.fn(),
  },
  toolConfigStorage: { get: vi.fn(() => Promise.resolve({})) },
  reapCronSessions: vi.fn(() => Promise.resolve(0)),
}));

// ---------------------------------------------------------------------------
// Helper: create a mock CronService
// ---------------------------------------------------------------------------

const createMockService = () => ({
  status: vi.fn(async () => ({ running: true, taskCount: 2, pendingCount: 1 })),
  list: vi.fn(async () => [
    {
      id: 't1',
      name: 'Task 1',
      description: 'desc',
      enabled: true,
      schedule: { kind: 'every' as const, everyMs: 60000 },
      payload: { kind: 'agentTurn' as const, message: 'hello' },
      state: { nextRunAtMs: 1000, lastStatus: 'ok' },
    },
  ]),
  add: vi.fn(async (task: Record<string, unknown>) => ({
    id: 'new-id',
    ...task,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state: { nextRunAtMs: Date.now() + 60000 },
  })),
  update: vi.fn(async (id: string, _patch: Record<string, unknown>) => ({
    id,
    name: 'Updated',
    enabled: true,
    state: { nextRunAtMs: 2000 },
  })),
  remove: vi.fn(async (id: string) => ({ removed: true, id })),
  run: vi.fn(async (_id: string) => ({ status: 'ok', chatId: 'chat-1' })),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler tool — executeScheduler', () => {
  let executeScheduler: typeof import('./scheduler').executeScheduler;
  let setCronServiceRef: typeof import('./scheduler').setCronServiceRef;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./scheduler');
    executeScheduler = mod.executeScheduler;
    setCronServiceRef = mod.setCronServiceRef;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Returns error when cronServiceRef is null
  it('returns error when cronServiceRef is null', async () => {
    const result = await executeScheduler({ action: 'status' });
    expect(JSON.parse(result)).toEqual({ error: 'Scheduler not initialized' });
  });

  // 2. status action returns service status
  it('status action returns service status', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const result = JSON.parse(await executeScheduler({ action: 'status' }));

    expect(service.status).toHaveBeenCalledOnce();
    expect(result).toEqual({ running: true, taskCount: 2, pendingCount: 1 });
  });

  // 3. list action returns task list
  it('list action returns task list', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const result = JSON.parse(await executeScheduler({ action: 'list' }));

    expect(service.list).toHaveBeenCalledOnce();
    expect(result.count).toBe(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('t1');
    expect(result.tasks[0].name).toBe('Task 1');
    expect(result.tasks[0].enabled).toBe(true);
    expect(result.tasks[0].schedule).toEqual({ kind: 'every', everyMs: 60000 });
    expect(result.tasks[0].payload).toEqual({ kind: 'agentTurn', message: 'hello' });
  });

  // 4. add action creates task with valid schedule
  it('add action creates task with valid schedule', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const result = JSON.parse(
      await executeScheduler({
        action: 'add',
        job: {
          name: 'Weather check',
          schedule: { kind: 'every', everyMs: 60000 },
          payload: { kind: 'agentTurn', message: 'check weather' },
        },
      }),
    );

    expect(service.add).toHaveBeenCalledOnce();
    expect(result.id).toBe('new-id');
    expect(result.name).toBe('Weather check');
    expect(result.enabled).toBe(true);
  });

  // 5. add action validates cron expression (throws on invalid)
  it('add action throws on invalid cron expression', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await expect(
      executeScheduler({
        action: 'add',
        job: {
          name: 'Bad cron',
          schedule: { kind: 'cron', expr: 'not-a-cron-expr' },
          payload: { kind: 'agentTurn', message: 'test' },
        },
      }),
    ).rejects.toThrow('Invalid cron expression');
  });

  // 6. add action rejects past one-shot schedule
  it('add action rejects past one-shot schedule', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await expect(
      executeScheduler({
        action: 'add',
        job: {
          name: 'Past reminder',
          schedule: { kind: 'at', at: '2020-01-01T00:00:00Z' },
          payload: { kind: 'agentTurn', message: 'too late' },
        },
      }),
    ).rejects.toThrow('is in the past');
  });

  // 7. add action resolves ISO datetime to ms
  it('add action resolves ISO datetime to ms', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await executeScheduler({
      action: 'add',
      job: {
        name: 'ISO task',
        schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
        payload: { kind: 'agentTurn', message: 'test' },
      },
    });

    expect(service.add).toHaveBeenCalledOnce();
    const addedSchedule = service.add.mock.calls[0][0].schedule as { atMs: number };
    expect(addedSchedule.atMs).toBe(new Date('2026-12-25T08:00:00Z').getTime());
  });

  // 8. add action auto-fills chatId from context for chatInject
  it('add action auto-fills chatId from context for chatInject', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await executeScheduler(
      {
        action: 'add',
        job: {
          name: 'Inject reminder',
          schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
          payload: { kind: 'chatInject', message: 'hello' },
        },
      },
      { chatId: 'ctx-chat-123' },
    );

    expect(service.add).toHaveBeenCalledOnce();
    const addedPayload = service.add.mock.calls[0][0].payload as { chatId: string };
    expect(addedPayload.chatId).toBe('ctx-chat-123');
  });

  // 9. add action requires chatId for chatInject without context
  it('add action requires chatId for chatInject without context', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await expect(
      executeScheduler({
        action: 'add',
        job: {
          name: 'Inject no context',
          schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
          payload: { kind: 'chatInject', message: 'hello' },
        },
      }),
    ).rejects.toThrow('chatInject payload requires chatId');
  });

  // 10. update action updates task
  it('update action updates task', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const result = JSON.parse(
      await executeScheduler({
        action: 'update',
        taskId: 't1',
        patch: { name: 'Updated', enabled: false },
      }),
    );

    expect(service.update).toHaveBeenCalledOnce();
    expect(service.update).toHaveBeenCalledWith('t1', { name: 'Updated', enabled: false });
    expect(result.id).toBe('t1');
    expect(result.name).toBe('Updated');
  });

  // 11. update action requires taskId
  it('update action requires taskId', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await expect(executeScheduler({ action: 'update', patch: { name: 'No ID' } })).rejects.toThrow(
      'taskId required for update action',
    );
  });

  // 12. remove action removes task
  it('remove action removes task', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const result = JSON.parse(await executeScheduler({ action: 'remove', taskId: 't1' }));

    expect(service.remove).toHaveBeenCalledOnce();
    expect(service.remove).toHaveBeenCalledWith('t1');
    expect(result).toEqual({ removed: true, id: 't1' });
  });

  // 13. run action force-runs task
  it('run action force-runs task', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const result = JSON.parse(await executeScheduler({ action: 'run', taskId: 't1' }));

    expect(service.run).toHaveBeenCalledOnce();
    expect(service.run).toHaveBeenCalledWith('t1', 'force');
    expect(result).toEqual({ status: 'ok', chatId: 'chat-1' });
  });

  // 14. runs action returns run logs
  it('runs action returns run logs', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    const { readRunLogs } = await import('../cron');

    const result = JSON.parse(await executeScheduler({ action: 'runs', taskId: 't1' }));

    expect(readRunLogs).toHaveBeenCalledWith('t1', 20);
    expect(result.taskId).toBe('t1');
    expect(result.runs).toEqual([{ runAtMs: 1000, status: 'ok' }]);
  });

  // 15. Unknown action throws error
  it('unknown action throws error', async () => {
    const service = createMockService();
    setCronServiceRef(service as unknown as CronService);

    await expect(executeScheduler({ action: 'bogus' } as never)).rejects.toThrow(
      'Unknown scheduler action: bogus',
    );
  });
});
