import { computeNextRunAtMs } from './schedule';
import { describe, expect, it } from 'vitest';

describe('computeNextRunAtMs', () => {
  describe('at schedule', () => {
    it('returns atMs when in the future', () => {
      const result = computeNextRunAtMs({ kind: 'at', atMs: 2000 }, 1000);
      expect(result).toBe(2000);
    });

    it('returns undefined when atMs is in the past', () => {
      const result = computeNextRunAtMs({ kind: 'at', atMs: 500 }, 1000);
      expect(result).toBeUndefined();
    });

    it('returns undefined when atMs equals now', () => {
      const result = computeNextRunAtMs({ kind: 'at', atMs: 1000 }, 1000);
      expect(result).toBeUndefined();
    });
  });

  describe('every schedule', () => {
    it('computes next run from anchor', () => {
      // anchor=0, every=60000, now=90000 → next should be 120000
      const result = computeNextRunAtMs({ kind: 'every', everyMs: 60_000, anchorMs: 0 }, 90_000);
      expect(result).toBe(120_000);
    });

    it('returns anchor when now is before anchor', () => {
      const result = computeNextRunAtMs({ kind: 'every', everyMs: 60_000, anchorMs: 5000 }, 1000);
      expect(result).toBe(5000);
    });

    it('uses nowMs as anchor when anchorMs is not set', () => {
      const now = 100_000;
      const result = computeNextRunAtMs({ kind: 'every', everyMs: 60_000 }, now);
      // With no anchor, anchor defaults to now, so next = now + everyMs
      expect(result).toBe(now + 60_000);
    });

    it('clamps everyMs to minimum 30 seconds', () => {
      // Try 1ms interval — should be clamped to 30_000
      const result = computeNextRunAtMs({ kind: 'every', everyMs: 1, anchorMs: 0 }, 0);
      expect(result).toBe(30_000);
    });

    it('clamps sub-30s interval to 30s', () => {
      const result = computeNextRunAtMs({ kind: 'every', everyMs: 5000, anchorMs: 0 }, 0);
      expect(result).toBe(30_000);
    });

    it('correctly handles exact interval boundary', () => {
      // anchor=0, every=60000, now=60000 exactly → next is 60000 (due now)
      const result = computeNextRunAtMs({ kind: 'every', everyMs: 60_000, anchorMs: 0 }, 60_000);
      expect(result).toBe(60_000);
    });

    it('correctly handles large intervals', () => {
      const hour = 3_600_000;
      const result = computeNextRunAtMs({ kind: 'every', everyMs: hour, anchorMs: 0 }, hour * 2.5);
      expect(result).toBe(hour * 3);
    });
  });

  describe('cron schedule', () => {
    it('computes next run for every-minute expression in UTC', () => {
      // "* * * * *" = every minute. From a known timestamp, next should be next minute boundary.
      const now = new Date('2026-06-15T10:30:15Z');
      const result = computeNextRunAtMs(
        { kind: 'cron', expr: '* * * * *', tz: 'UTC' },
        now.getTime(),
      );
      expect(result).toBe(new Date('2026-06-15T10:31:00Z').getTime());
    });

    it('returns next occurrence when at exact cron match (not same second)', () => {
      // At exactly 10:30:00, "30 10 * * *" should return the NEXT day's 10:30
      const now = new Date('2026-06-15T10:30:00Z');
      const result = computeNextRunAtMs(
        { kind: 'cron', expr: '30 10 * * *', tz: 'UTC' },
        now.getTime(),
      );
      expect(result).toBe(new Date('2026-06-16T10:30:00Z').getTime());
    });

    it('returns undefined for empty expression', () => {
      const result = computeNextRunAtMs({ kind: 'cron', expr: '' }, Date.now());
      expect(result).toBeUndefined();
    });

    it('returns undefined for whitespace-only expression', () => {
      const result = computeNextRunAtMs({ kind: 'cron', expr: '   ' }, Date.now());
      expect(result).toBeUndefined();
    });

    it('computes with timezone awareness', () => {
      // "0 9 * * *" in America/New_York = 9:00 AM ET
      // In winter (EST = UTC-5), 9:00 ET = 14:00 UTC
      const now = new Date('2026-01-15T13:00:00Z'); // 8:00 AM ET — before 9 AM
      const result = computeNextRunAtMs(
        { kind: 'cron', expr: '0 9 * * *', tz: 'America/New_York' },
        now.getTime(),
      );
      expect(result).toBe(new Date('2026-01-15T14:00:00Z').getTime());
    });

    it('handles every-5-minutes expression', () => {
      const now = new Date('2026-06-15T10:32:00Z');
      const result = computeNextRunAtMs(
        { kind: 'cron', expr: '*/5 * * * *', tz: 'UTC' },
        now.getTime(),
      );
      expect(result).toBe(new Date('2026-06-15T10:35:00Z').getTime());
    });

    it('returns undefined for invalid expression', () => {
      const result = computeNextRunAtMs({ kind: 'cron', expr: 'not-valid-cron' }, Date.now());
      expect(result).toBeUndefined();
    });
  });
});
