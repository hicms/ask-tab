import { splitMessage, isAllowedSender } from './utils';
import { describe, expect, it } from 'vitest';

describe('splitMessage', () => {
  it('returns single chunk for short text', () => {
    expect(splitMessage('hello', 4096)).toEqual(['hello']);
  });

  it('returns single chunk for exactly max length text', () => {
    const text = 'a'.repeat(4096);
    expect(splitMessage(text, 4096)).toEqual([text]);
  });

  it('splits at newline boundaries', () => {
    const text = 'a'.repeat(4000) + '\n' + 'b'.repeat(100);
    const chunks = splitMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('a'.repeat(4000));
    expect(chunks[1]).toBe('b'.repeat(100));
  });

  it('splits at space when no newline found', () => {
    const text = 'word '.repeat(1000).trim(); // ~5000 chars
    const chunks = splitMessage(text, 4096);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('hard-splits when no good break found', () => {
    const text = 'a'.repeat(8192); // no spaces or newlines
    const chunks = splitMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('a'.repeat(4096));
    expect(chunks[1]).toBe('a'.repeat(4096));
  });

  it('returns empty array for empty string', () => {
    expect(splitMessage('', 4096)).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitMessage('   ', 4096)).toEqual([]);
  });

  it('handles multiple split points', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(80)}`);
    const text = lines.join('\n');
    const chunks = splitMessage(text, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('isAllowedSender', () => {
  it('rejects all when allowlist is empty', () => {
    expect(isAllowedSender('123', { allowedSenderIds: [] })).toBe(false);
  });

  it('allows sender in list', () => {
    expect(isAllowedSender('123', { allowedSenderIds: ['123'] })).toBe(true);
  });

  it('rejects sender not in list', () => {
    expect(isAllowedSender('456', { allowedSenderIds: ['123'] })).toBe(false);
  });

  it('handles multiple allowed senders', () => {
    const config = { allowedSenderIds: ['100', '200', '300'] };
    expect(isAllowedSender('200', config)).toBe(true);
    expect(isAllowedSender('400', config)).toBe(false);
  });

  it('uses string comparison (not numeric)', () => {
    expect(isAllowedSender('123', { allowedSenderIds: ['0123'] })).toBe(false);
    expect(isAllowedSender('0123', { allowedSenderIds: ['0123'] })).toBe(true);
  });
});
