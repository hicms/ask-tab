import { Value } from '@sinclair/typebox/value';
import { describe, expect, it, vi } from 'vitest';

// Mock chrome.alarms so the scheduler module can be imported
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

// Mock @extension/storage to avoid IndexedDB setup issues
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

describe('scheduler tool — schema validation', () => {
  it('validates action enum', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    expect(Value.Check(schedulerSchema, { action: 'status' })).toBe(true);
    expect(Value.Check(schedulerSchema, { action: 'list' })).toBe(true);
    expect(Value.Check(schedulerSchema, { action: 'add' })).toBe(true);
    expect(Value.Check(schedulerSchema, { action: 'update' })).toBe(true);
    expect(Value.Check(schedulerSchema, { action: 'remove' })).toBe(true);
    expect(Value.Check(schedulerSchema, { action: 'run' })).toBe(true);
    expect(Value.Check(schedulerSchema, { action: 'runs' })).toBe(true);
  });

  it('rejects invalid action', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    expect(Value.Check(schedulerSchema, { action: 'invalid' })).toBe(false);
    expect(Value.Check(schedulerSchema, { action: '' })).toBe(false);
  });

  it('validates add action with valid job', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Weather check',
          schedule: { kind: 'every', everyMs: 300_000 },
          payload: { kind: 'agentTurn', message: 'check weather in SF' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('rejects everyMs below 30000', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Too fast',
          schedule: { kind: 'every', everyMs: 5000 },
          payload: { kind: 'agentTurn', message: 'test' },
        },
      }),
    };
    expect(result.success).toBe(false);
  });

  it('accepts everyMs at exactly 30000', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Min interval',
          schedule: { kind: 'every', everyMs: 30_000 },
          payload: { kind: 'agentTurn', message: 'test' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('validates one-shot schedule with ISO string', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Reminder',
          schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
          payload: { kind: 'agentTurn', message: 'remind me' },
          deleteAfterRun: true,
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('validates chatInject payload', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Inject',
          schedule: { kind: 'every', everyMs: 60_000 },
          payload: { kind: 'chatInject', chatId: 'abc', message: 'ping' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('accepts schedule with ISO at string', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'ISO Reminder',
          schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
          payload: { kind: 'agentTurn', message: 'merry christmas' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('validates patch object', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'update',
        taskId: 't1',
        patch: { enabled: false, name: 'Renamed' },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('accepts cron schedule kind with expr', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Weekday check',
          schedule: { kind: 'cron', expr: '0 9 * * 1-5', tz: 'America/New_York' },
          payload: { kind: 'agentTurn', message: 'morning briefing' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('accepts cron schedule in patch', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'update',
        taskId: 't1',
        patch: {
          schedule: { kind: 'cron', expr: '*/5 * * * *' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('accepts job with delivery config', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Daily report',
          schedule: { kind: 'cron', expr: '0 9 * * *' },
          payload: { kind: 'agentTurn', message: 'daily report' },
          delivery: { channel: 'telegram', to: '123456' },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('accepts delivery with bestEffort flag', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Report',
          schedule: { kind: 'every', everyMs: 60_000 },
          payload: { kind: 'agentTurn', message: 'report' },
          delivery: { channel: 'telegram', to: '123', bestEffort: true },
        },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('accepts nullable delivery in patch (to remove it)', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'update',
        taskId: 't1',
        patch: { delivery: null },
      }),
    };
    expect(result.success).toBe(true);
  });

  it('rejects delivery missing required fields', async () => {
    const { schedulerSchema } = await import('../tools/scheduler');
    const result = {
      success: Value.Check(schedulerSchema, {
        action: 'add',
        job: {
          name: 'Bad delivery',
          schedule: { kind: 'every', everyMs: 60_000 },
          payload: { kind: 'agentTurn', message: 'test' },
          delivery: { channel: 'telegram' }, // missing 'to'
        },
      }),
    };
    expect(result.success).toBe(false);
  });
});

describe('scheduler tool — executeScheduler', () => {
  it('returns error when service not initialized', async () => {
    const { executeScheduler } = await import('../tools/scheduler');
    const result = await executeScheduler({ action: 'status' });
    expect(JSON.parse(result)).toEqual({ error: 'Scheduler not initialized' });
  });

  it('throws for add without job', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      add: vi.fn(),
    } as unknown as import('../cron').CronService);

    await expect(executeScheduler({ action: 'add' })).rejects.toThrow('job object required');
  });

  it('throws for update without taskId', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      update: vi.fn(),
    } as unknown as import('../cron').CronService);

    await expect(executeScheduler({ action: 'update', patch: {} })).rejects.toThrow(
      'taskId required',
    );
  });

  it('throws for remove without taskId', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      remove: vi.fn(),
    } as unknown as import('../cron').CronService);

    await expect(executeScheduler({ action: 'remove' })).rejects.toThrow('taskId required');
  });

  it('auto-fills chatId from context for chatInject payloads', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    const addMock = vi.fn().mockResolvedValue({
      id: 't1',
      name: 'Reminder',
      enabled: true,
      state: { nextRunAtMs: Date.now() + 60_000 },
    });
    setCronServiceRef({
      status: vi.fn(),
      add: addMock,
    } as unknown as import('../cron').CronService);

    await executeScheduler(
      {
        action: 'add',
        job: {
          name: 'Reminder',
          schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
          payload: { kind: 'chatInject', message: 'hello' },
        },
      },
      { chatId: 'ctx-chat-123' },
    );

    expect(addMock).toHaveBeenCalledOnce();
    const addedPayload = addMock.mock.calls[0][0].payload;
    expect(addedPayload.chatId).toBe('ctx-chat-123');
  });

  it('throws when ISO "at" is in the past', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      add: vi.fn(),
    } as unknown as import('../cron').CronService);

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

  it('resolves ISO "at" string to atMs', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    const addMock = vi.fn().mockResolvedValue({
      id: 't1',
      name: 'ISO task',
      enabled: true,
      state: { nextRunAtMs: new Date('2026-12-25T08:00:00Z').getTime() },
    });
    setCronServiceRef({
      status: vi.fn(),
      add: addMock,
    } as unknown as import('../cron').CronService);

    await executeScheduler({
      action: 'add',
      job: {
        name: 'ISO task',
        schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
        payload: { kind: 'agentTurn', message: 'test' },
      },
    });

    expect(addMock).toHaveBeenCalledOnce();
    const addedSchedule = addMock.mock.calls[0][0].schedule;
    expect(addedSchedule.atMs).toBe(new Date('2026-12-25T08:00:00Z').getTime());
  });

  it('resolves ISO "at" with timezone offset', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    const addMock = vi.fn().mockResolvedValue({
      id: 't1',
      name: 'TZ task',
      enabled: true,
      state: { nextRunAtMs: new Date('2027-06-20T23:30:00-08:00').getTime() },
    });
    setCronServiceRef({
      status: vi.fn(),
      add: addMock,
    } as unknown as import('../cron').CronService);

    await executeScheduler({
      action: 'add',
      job: {
        name: 'TZ task',
        schedule: { kind: 'at', at: '2027-06-20T23:30:00-08:00' },
        payload: { kind: 'agentTurn', message: 'test' },
      },
    });

    expect(addMock).toHaveBeenCalledOnce();
    const addedSchedule = addMock.mock.calls[0][0].schedule;
    // 2027-06-20T23:30:00-08:00 = 2027-06-21T07:30:00Z
    expect(addedSchedule.atMs).toBe(new Date('2027-06-21T07:30:00Z').getTime());
  });

  it('throws for invalid ISO "at" string', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      add: vi.fn(),
    } as unknown as import('../cron').CronService);

    await expect(
      executeScheduler({
        action: 'add',
        job: {
          name: 'Bad ISO',
          schedule: { kind: 'at', at: 'not-a-date' },
          payload: { kind: 'agentTurn', message: 'test' },
        },
      }),
    ).rejects.toThrow('Invalid ISO 8601 datetime');
  });

  it('throws for chatInject without chatId when no context provided', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      add: vi.fn(),
    } as unknown as import('../cron').CronService);

    await expect(
      executeScheduler({
        action: 'add',
        job: {
          name: 'Reminder',
          schedule: { kind: 'at', at: '2026-12-25T08:00:00Z' },
          payload: { kind: 'chatInject', message: 'hello' },
        },
      }),
    ).rejects.toThrow('chatInject payload requires chatId');
  });

  it('throws for invalid cron expression', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    setCronServiceRef({
      status: vi.fn(),
      add: vi.fn(),
    } as unknown as import('../cron').CronService);

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

  it('passes delivery config to service.add', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    const addMock = vi.fn().mockResolvedValue({
      id: 't1',
      name: 'Report',
      enabled: true,
      state: { nextRunAtMs: Date.now() + 60_000 },
    });
    setCronServiceRef({
      status: vi.fn(),
      add: addMock,
    } as unknown as import('../cron').CronService);

    await executeScheduler({
      action: 'add',
      job: {
        name: 'Report',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'daily report' },
        delivery: { channel: 'telegram', to: '123456' },
      },
    });

    expect(addMock).toHaveBeenCalledOnce();
    expect(addMock.mock.calls[0][0].delivery).toEqual({ channel: 'telegram', to: '123456' });
  });

  it('includes delivery in list output', async () => {
    const { executeScheduler, setCronServiceRef } = await import('../tools/scheduler');
    const listMock = vi.fn().mockResolvedValue([
      {
        id: 't1',
        name: 'Report',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'daily report' },
        delivery: { channel: 'telegram', to: '123' },
        state: { nextRunAtMs: 999, lastStatus: 'ok' },
      },
    ]);
    setCronServiceRef({
      status: vi.fn(),
      list: listMock,
    } as unknown as import('../cron').CronService);

    const result = JSON.parse(await executeScheduler({ action: 'list' }));
    expect(result.tasks[0].delivery).toEqual({ channel: 'telegram', to: '123' });
  });
});
