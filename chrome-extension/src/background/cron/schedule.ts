// ── Schedule computation ─────────────────────

import { Cron } from 'croner';
import type { TaskSchedule } from './types';

const resolveCronTimezone = (tz?: string): string =>
  tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const computeNextRunAtMs = (schedule: TaskSchedule, nowMs: number): number | undefined => {
  if (schedule.kind === 'at') {
    return schedule.atMs > nowMs ? schedule.atMs : undefined;
  }

  if (schedule.kind === 'cron') {
    const expr = schedule.expr?.trim();
    if (!expr) return undefined;
    try {
      const cron = new Cron(expr, { timezone: resolveCronTimezone(schedule.tz) });
      // Floor to second granularity — cron has 1-second resolution
      const nowSecondMs = Math.floor(nowMs / 1000) * 1000;
      const next = cron.nextRun(new Date(nowSecondMs));
      if (!next) return undefined;
      const nextMs = next.getTime();
      return Number.isFinite(nextMs) && nextMs > nowSecondMs ? nextMs : undefined;
    } catch {
      return undefined;
    }
  }

  // kind === 'every' — clamp to 30s minimum (Chrome alarms resolution)
  const everyMs = Math.max(30_000, Math.floor(schedule.everyMs));
  const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
  if (nowMs < anchor) return anchor;
  const elapsed = nowMs - anchor;
  const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
  return anchor + steps * everyMs;
};
