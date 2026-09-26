import { LOG_LEVEL_PRIORITY, formatLogEntry, formatLogsForExport } from './logger';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from './logger';

const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 1,
  timestamp: new Date('2025-01-15T10:30:45.123Z').getTime(),
  level: 'info',
  category: 'general',
  message: 'test message',
  ...overrides,
});

describe('LOG_LEVEL_PRIORITY', () => {
  it('trace < debug < info < warn < error', () => {
    expect(LOG_LEVEL_PRIORITY.trace).toBeLessThan(LOG_LEVEL_PRIORITY.debug);
    expect(LOG_LEVEL_PRIORITY.debug).toBeLessThan(LOG_LEVEL_PRIORITY.info);
    expect(LOG_LEVEL_PRIORITY.info).toBeLessThan(LOG_LEVEL_PRIORITY.warn);
    expect(LOG_LEVEL_PRIORITY.warn).toBeLessThan(LOG_LEVEL_PRIORITY.error);
  });
});

describe('formatLogEntry', () => {
  it('formats entry with timestamp, level, category, message', () => {
    const entry = makeEntry();
    const result = formatLogEntry(entry);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(result).toContain('[INFO]');
    expect(result).toContain('[general]');
    expect(result).toContain('test message');
  });

  it('includes data as JSON when present', () => {
    const entry = makeEntry({ data: { key: 'value' } });
    const result = formatLogEntry(entry);
    expect(result).toContain('{"key":"value"}');
  });

  it('handles entry with no data', () => {
    const entry = makeEntry();
    const result = formatLogEntry(entry);
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });
});

describe('formatLogsForExport — text', () => {
  it('formats multiple entries as readable text lines', () => {
    const entries = [
      makeEntry({ id: 1, message: 'first' }),
      makeEntry({ id: 2, message: 'second', level: 'error' }),
    ];
    const result = formatLogsForExport(entries, 'text');
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
    expect(lines[1]).toContain('[ERROR]');
  });

  it('returns empty string for empty array', () => {
    expect(formatLogsForExport([], 'text')).toBe('');
  });
});

describe('formatLogsForExport — json', () => {
  it('returns valid JSON array of entries', () => {
    const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })];
    const result = formatLogsForExport(entries, 'json');
    const parsed = JSON.parse(result) as LogEntry[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe(1);
    expect(parsed[1].id).toBe(2);
  });

  it('returns empty JSON array for empty input', () => {
    const result = formatLogsForExport([], 'json');
    expect(JSON.parse(result)).toEqual([]);
  });
});

describe('formatLogEntry — clipboard copy scenarios', () => {
  it('formats entry with complex nested data for clipboard', () => {
    const entry = makeEntry({
      data: {
        request: { url: 'https://api.example.com', headers: { auth: 'bearer xyz' } },
        response: { status: 200, body: [1, 2, 3] },
      },
    });
    const result = formatLogEntry(entry);
    expect(result).toContain('https://api.example.com');
    expect(result).toContain('"status":200');
    expect(result).toContain('[1,2,3]');
  });

  it('handles entry with unserializable circular data gracefully', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const entry = makeEntry({ data: circular });
    const result = formatLogEntry(entry);
    expect(result).toContain('[unserializable data]');
    expect(result).toContain('test message');
  });

  it('formats all log levels correctly for clipboard output', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error'] as const;
    for (const level of levels) {
      const entry = makeEntry({ level });
      const result = formatLogEntry(entry);
      expect(result).toContain(`[${level.toUpperCase()}]`);
    }
  });
});

describe('formatLogsForExport — clipboard copy-all scenarios', () => {
  it('text format preserves entry order for clipboard', () => {
    const entries = [
      makeEntry({ id: 1, message: 'alpha', timestamp: new Date('2025-01-15T10:00:00Z').getTime() }),
      makeEntry({ id: 2, message: 'beta', timestamp: new Date('2025-01-15T10:00:01Z').getTime() }),
      makeEntry({ id: 3, message: 'gamma', timestamp: new Date('2025-01-15T10:00:02Z').getTime() }),
    ];
    const result = formatLogsForExport(entries, 'text');
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('alpha');
    expect(lines[1]).toContain('beta');
    expect(lines[2]).toContain('gamma');
    // Ensure order is preserved (alpha before beta before gamma)
    expect(result.indexOf('alpha')).toBeLessThan(result.indexOf('beta'));
    expect(result.indexOf('beta')).toBeLessThan(result.indexOf('gamma'));
  });

  it('text format handles entries with and without data mixed together', () => {
    const entries = [
      makeEntry({ id: 1, message: 'no data' }),
      makeEntry({ id: 2, message: 'with data', data: { key: 'value' } }),
      makeEntry({ id: 3, message: 'also no data' }),
    ];
    const result = formatLogsForExport(entries, 'text');
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('no data');
    expect(lines[0]).not.toContain('{');
    expect(lines[1]).toContain('with data');
    expect(lines[1]).toContain('{"key":"value"}');
    expect(lines[2]).toContain('also no data');
    expect(lines[2]).not.toContain('{');
  });
});
