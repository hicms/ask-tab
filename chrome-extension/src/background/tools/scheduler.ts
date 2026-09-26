// ── Scheduler tool ──────────────────────────
// TypeBox-schema tool for managing scheduled tasks via LLM

import { readRunLogs } from '../cron';
import { Type } from '@sinclair/typebox';
import { Cron } from 'croner';
import type { CronService, ScheduledTaskPatch, TaskPayload, TaskSchedule } from '../cron';
import type { ToolRegistration } from './tool-registration';
import type { Static } from '@sinclair/typebox';

const deliverySchema = Type.Object({
  channel: Type.String({ description: 'Delivery channel (e.g. "telegram")' }),
  to: Type.String({ description: 'Delivery target (e.g. chat ID)' }),
  bestEffort: Type.Optional(
    Type.Boolean({ description: 'Best-effort delivery (non-fatal on failure)' }),
  ),
});

const schedulerSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal('status'),
      Type.Literal('list'),
      Type.Literal('add'),
      Type.Literal('update'),
      Type.Literal('remove'),
      Type.Literal('run'),
      Type.Literal('runs'),
    ],
    { description: 'The action to perform on the scheduler' },
  ),
  includeDisabled: Type.Optional(
    Type.Boolean({ description: 'Include disabled tasks in list (default: false)' }),
  ),
  job: Type.Optional(
    Type.Object(
      {
        name: Type.String({ description: 'Task name' }),
        description: Type.Optional(Type.String({ description: 'Task description' })),
        enabled: Type.Optional(
          Type.Boolean({ description: 'Whether task is enabled (default: true)' }),
        ),
        deleteAfterRun: Type.Optional(
          Type.Boolean({ description: 'Delete after successful one-shot run' }),
        ),
        timeoutMs: Type.Optional(Type.Number({ description: 'Execution timeout in milliseconds' })),
        schedule: Type.Object(
          {
            kind: Type.Union([Type.Literal('at'), Type.Literal('every'), Type.Literal('cron')], {
              description:
                'Schedule type: at (one-shot), every (recurring), or cron (cron expression)',
            }),
            at: Type.Optional(
              Type.String({
                description:
                  'ISO 8601 datetime for kind=at. Example: "2026-02-21T07:30:00Z" or "2026-02-20T23:30:00-08:00"',
              }),
            ),
            atMs: Type.Optional(
              Type.Number({ description: 'Absolute time in unix ms (for kind=at)' }),
            ),
            everyMs: Type.Optional(
              Type.Number({
                description: 'Interval in ms (for kind=every, min 30000)',
                minimum: 30000,
              }),
            ),
            anchor: Type.Optional(
              Type.String({ description: 'ISO 8601 anchor datetime (for kind=every)' }),
            ),
            anchorMs: Type.Optional(
              Type.Number({ description: 'Anchor time in unix ms (for kind=every)' }),
            ),
            expr: Type.Optional(
              Type.String({
                description:
                  'Cron expression (for kind=cron). Example: "0 9 * * 1-5" for weekdays at 9am',
              }),
            ),
            tz: Type.Optional(
              Type.String({
                description:
                  'IANA timezone for cron expression (for kind=cron). Example: "America/New_York"',
              }),
            ),
          },
          { description: 'When to run the task' },
        ),
        payload: Type.Object(
          {
            kind: Type.Union([Type.Literal('agentTurn'), Type.Literal('chatInject')], {
              description: 'Payload type',
            }),
            message: Type.String({ description: 'The message/prompt to send' }),
            model: Type.Optional(Type.String({ description: 'Model override (for agentTurn)' })),
            chatId: Type.Optional(Type.String({ description: 'Target chat ID (for chatInject)' })),
            timeoutMs: Type.Optional(
              Type.Number({ description: 'LLM execution timeout (for agentTurn)' }),
            ),
          },
          { description: 'What to execute when the task runs' },
        ),
        delivery: Type.Optional(deliverySchema),
      },
      { description: 'Task definition (required for add action)' },
    ),
  ),
  taskId: Type.Optional(
    Type.String({ description: 'Task ID (required for update/remove/run/runs)' }),
  ),
  patch: Type.Optional(
    Type.Object(
      {
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        enabled: Type.Optional(Type.Boolean()),
        deleteAfterRun: Type.Optional(Type.Boolean()),
        timeoutMs: Type.Optional(Type.Number()),
        schedule: Type.Optional(
          Type.Object({
            kind: Type.Union([Type.Literal('at'), Type.Literal('every'), Type.Literal('cron')]),
            at: Type.Optional(Type.String()),
            atMs: Type.Optional(Type.Number()),
            everyMs: Type.Optional(Type.Number()),
            anchor: Type.Optional(Type.String()),
            anchorMs: Type.Optional(Type.Number()),
            expr: Type.Optional(Type.String()),
            tz: Type.Optional(Type.String()),
          }),
        ),
        payload: Type.Optional(
          Type.Object({
            kind: Type.Union([Type.Literal('agentTurn'), Type.Literal('chatInject')]),
            message: Type.Optional(Type.String()),
            model: Type.Optional(Type.String()),
            chatId: Type.Optional(Type.String()),
            timeoutMs: Type.Optional(Type.Number()),
          }),
        ),
        delivery: Type.Optional(Type.Union([deliverySchema, Type.Null()])),
      },
      { description: 'Patch object (required for update action)' },
    ),
  ),
});

type SchedulerArgs = Static<typeof schedulerSchema>;

let cronServiceRef: CronService | null = null;

const setCronServiceRef = (service: CronService): void => {
  cronServiceRef = service;
};

/** Parse an ISO 8601 string to unix ms, throwing on invalid input. */
const parseIsoToMs = (iso: string, field: string): number => {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO 8601 datetime for ${field}: "${iso}"`);
  }
  return ms;
};

/** Resolve ISO string fields (at, anchor) to their ms counterparts in-place. */
const resolveScheduleIso = (schedule: Record<string, unknown>): void => {
  if (typeof schedule.at === 'string') {
    schedule.atMs = parseIsoToMs(schedule.at, 'schedule.at');
  }
  if (typeof schedule.anchor === 'string') {
    schedule.anchorMs = parseIsoToMs(schedule.anchor, 'schedule.anchor');
  }
};

/** Validate a cron expression, throwing on invalid input. */
const validateCronExpr = (expr: string): void => {
  try {
    new Cron(expr, { catch: false });
  } catch (err) {
    throw new Error(
      `Invalid cron expression "${expr}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

const executeScheduler = async (
  args: SchedulerArgs,
  context?: { chatId?: string },
): Promise<string> => {
  if (!cronServiceRef) {
    return JSON.stringify({ error: 'Scheduler not initialized' });
  }

  const service = cronServiceRef;

  switch (args.action) {
    case 'status': {
      const result = await service.status();
      return JSON.stringify(result);
    }

    case 'list': {
      const tasks = await service.list({ includeDisabled: args.includeDisabled });
      return JSON.stringify({
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          enabled: t.enabled,
          schedule: t.schedule,
          payload: { kind: t.payload.kind, message: t.payload.message },
          delivery: t.delivery,
          nextRunAtMs: t.state.nextRunAtMs,
          lastStatus: t.state.lastStatus,
          lastRunAtMs: t.state.lastRunAtMs,
          lastError: t.state.lastError,
        })),
      });
    }

    case 'add': {
      if (!args.job) throw new Error('job object required for add action');
      const { schedule: rawSchedule, payload, delivery, ...rest } = args.job;
      // Resolve ISO datetime strings to unix ms
      const schedule = rawSchedule as typeof rawSchedule & { atMs?: number; anchorMs?: number };
      resolveScheduleIso(schedule);
      // Validate one-shot schedule is not in the past
      if (schedule.kind === 'at' && typeof schedule.atMs === 'number') {
        const now = Date.now();
        if (schedule.atMs <= now) {
          throw new Error(
            `Scheduled time (${schedule.at ?? schedule.atMs}) is in the past. Current time is ${now} (${new Date(now).toISOString()}). Please use a future datetime.`,
          );
        }
      }
      // Validate cron expression
      if (schedule.kind === 'cron' && typeof schedule.expr === 'string') {
        validateCronExpr(schedule.expr);
      }
      // Auto-fill chatId from execution context when LLM omits it
      if (payload.kind === 'chatInject' && !payload.chatId && context?.chatId) {
        payload.chatId = context.chatId;
      }
      if (payload.kind === 'chatInject' && !payload.chatId) {
        throw new Error('chatInject payload requires chatId');
      }
      const task = await service.add({
        ...rest,
        enabled: rest.enabled !== false,
        schedule: schedule as TaskSchedule,
        payload: payload as TaskPayload,
        delivery,
      });
      return JSON.stringify({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        nextRunAtMs: task.state.nextRunAtMs,
      });
    }

    case 'update': {
      const id = args.taskId;
      if (!id) throw new Error('taskId required for update action');
      if (!args.patch) throw new Error('patch required for update action');
      if (args.patch.schedule) {
        resolveScheduleIso(args.patch.schedule as Record<string, unknown>);
      }
      const task = await service.update(id, args.patch as ScheduledTaskPatch);
      return JSON.stringify({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        nextRunAtMs: task.state.nextRunAtMs,
      });
    }

    case 'remove': {
      const id = args.taskId;
      if (!id) throw new Error('taskId required for remove action');
      const result = await service.remove(id);
      return JSON.stringify(result);
    }

    case 'run': {
      const id = args.taskId;
      if (!id) throw new Error('taskId required for run action');
      const result = await service.run(id, 'force');
      return JSON.stringify(result);
    }

    case 'runs': {
      const id = args.taskId;
      if (!id) throw new Error('taskId required for runs action');
      const logs = await readRunLogs(id, 20);
      return JSON.stringify({ taskId: id, runs: logs });
    }

    default:
      throw new Error(`Unknown scheduler action: ${args.action}`);
  }
};

// ── Tool registration ──

const schedulerToolDef: ToolRegistration = {
  name: 'scheduler',
  label: 'Scheduler',
  description:
    'Manage scheduled and recurring tasks. Actions: status, list, add (create task), update (modify task), remove (delete task), run (force-run now), runs (view history). Use this when the user asks to schedule, remind, or automate something.',
  schema: schedulerSchema,
  excludeInHeadless: true,
  needsContext: true,
  execute: (args, context) => executeScheduler(args as SchedulerArgs, context),
};

export { schedulerSchema, executeScheduler, setCronServiceRef, schedulerToolDef };
export type { SchedulerArgs };
