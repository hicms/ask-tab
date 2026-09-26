import { diagnostics } from '../../packages/shared/lib/diagnostics.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('browser diagnostics', () => {
  it.each(['debug', 'info', 'log', 'warn', 'error'] as const)(
    'preserves %s severity, arguments and call order with a late-installed console hook',
    level => {
      const sink = vi.spyOn(console, level).mockImplementation(() => {});
      const detail = { channelId: 'whatsapp' };
      const error = new Error('transport failed');

      diagnostics[level]('[channel] first', detail);
      diagnostics[level]('[channel] second', error);

      expect(sink.mock.calls).toEqual([
        ['[channel] first', detail],
        ['[channel] second', error],
      ]);
      expect(sink.mock.calls[0][1]).toBe(detail);
      expect(sink.mock.calls[1][1]).toBe(error);
    },
  );

  it('picks up replacement hooks after an earlier call', () => {
    const firstSink = vi.spyOn(console, 'error').mockImplementation(() => {});
    diagnostics.error('first');
    firstSink.mockRestore();
    const nextSink = vi.spyOn(console, 'error').mockImplementation(() => {});
    diagnostics.error('second');
    expect(nextSink).toHaveBeenCalledExactlyOnceWith('second');
  });
});
