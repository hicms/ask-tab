import {
  applyTemporalDecay,
  extractDateFromPath,
  isEvergreenPath,
  computeDecayFactor,
} from './temporal-decay';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TemporalDecayConfig } from './temporal-decay';

const makeResult = (score: number, path: string) => ({ score, path, snippet: 'test' });

describe('extractDateFromPath', () => {
  it('extracts date from memory/YYYY-MM-DD.md', () => {
    const date = extractDateFromPath('memory/2025-01-15.md');
    expect(date).not.toBeNull();
    expect(date!.toISOString().startsWith('2025-01-15')).toBe(true);
  });

  it('extracts date from transcript/YYYY-MM-DD/title.md', () => {
    const date = extractDateFromPath('transcript/2025-06-20/chat-about-coding.md');
    expect(date).not.toBeNull();
    expect(date!.toISOString().startsWith('2025-06-20')).toBe(true);
  });

  it('returns null for non-dated paths', () => {
    expect(extractDateFromPath('MEMORY.md')).toBeNull();
    expect(extractDateFromPath('memory/notes.md')).toBeNull();
    expect(extractDateFromPath('random/file.txt')).toBeNull();
  });

  it('returns null for invalid dates', () => {
    expect(extractDateFromPath('memory/9999-99-99.md')).toBeNull();
  });
});

describe('isEvergreenPath', () => {
  it('treats MEMORY.md as evergreen', () => {
    expect(isEvergreenPath('MEMORY.md')).toBe(true);
  });

  it('treats non-dated memory/* files as evergreen', () => {
    expect(isEvergreenPath('memory/notes.md')).toBe(true);
    expect(isEvergreenPath('memory/preferences.md')).toBe(true);
  });

  it('does NOT treat dated memory files as evergreen', () => {
    expect(isEvergreenPath('memory/2025-01-15.md')).toBe(false);
  });

  it('does NOT treat transcript files as evergreen', () => {
    expect(isEvergreenPath('transcript/2025-01-15/chat.md')).toBe(false);
  });

  it('does NOT treat random files as evergreen', () => {
    expect(isEvergreenPath('some-file.md')).toBe(false);
  });
});

describe('computeDecayFactor', () => {
  it('returns 1.0 for age 0', () => {
    expect(computeDecayFactor(0, 30)).toBe(1.0);
  });

  it('returns ~0.5 at exactly halfLife days', () => {
    const factor = computeDecayFactor(30, 30);
    expect(factor).toBeCloseTo(0.5, 5);
  });

  it('returns ~0.25 at 2x halfLife', () => {
    const factor = computeDecayFactor(60, 30);
    expect(factor).toBeCloseTo(0.25, 5);
  });

  it('returns 1.0 for negative age', () => {
    expect(computeDecayFactor(-5, 30)).toBe(1.0);
  });

  it('returns 1.0 for zero halfLife (no decay)', () => {
    expect(computeDecayFactor(100, 0)).toBe(1.0);
  });
});

describe('applyTemporalDecay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through when disabled', () => {
    const items = [makeResult(1.0, 'memory/2020-01-01.md')];
    const config: TemporalDecayConfig = { enabled: false, halfLifeDays: 30 };
    const result = applyTemporalDecay(items, config);
    expect(result).toBe(items); // same reference
  });

  it('passes through empty array', () => {
    const result = applyTemporalDecay([]);
    expect(result).toEqual([]);
  });

  it('does not decay evergreen files', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01').getTime());

    const items = [makeResult(1.0, 'MEMORY.md'), makeResult(0.8, 'memory/notes.md')];
    const result = applyTemporalDecay(items);

    expect(result[0]!.score).toBe(1.0);
    expect(result[1]!.score).toBe(0.8);
  });

  it('decays dated files based on age', () => {
    // Mock "now" to 30 days after 2025-06-01
    const now = new Date('2025-07-01T00:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const items = [makeResult(1.0, 'memory/2025-06-01.md')];
    const result = applyTemporalDecay(items, { enabled: true, halfLifeDays: 30 });

    // ~30 days old → factor ~0.5
    expect(result[0]!.score).toBeCloseTo(0.5, 1);
  });

  it('uses fileUpdatedAtMap as fallback', () => {
    const now = new Date('2025-07-01T00:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const items = [makeResult(1.0, 'some-custom/file.md')];
    const map = new Map<string, number>();
    map.set('some-custom/file.md', new Date('2025-06-01T00:00:00Z').getTime());

    const result = applyTemporalDecay(items, { enabled: true, halfLifeDays: 30 }, map);
    expect(result[0]!.score).toBeCloseTo(0.5, 1);
  });

  it('preserves scores for files with no determinable date', () => {
    const items = [makeResult(0.9, 'unknown/file.md')];
    const result = applyTemporalDecay(items);
    expect(result[0]!.score).toBe(0.9);
  });
});
