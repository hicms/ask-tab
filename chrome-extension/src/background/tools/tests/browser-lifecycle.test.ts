import { runBrowserTabAction } from '../browser-lifecycle';
import { releaseToolResources } from '../tool-lifecycle';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../logging/logger-buffer', () => ({ createLogger: () => ({ warn: vi.fn() }) }));

describe('browser visual ownership', () => {
  it('does not open a tab after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const open = vi.fn(async () => 'opened');
    expect(
      await runBrowserTabAction({ action: 'open' }, controller.signal, open, vi.fn()),
    ).toContain('cancelled');
    expect(open).not.toHaveBeenCalled();
  });
  it('clears every touched tab without clearing a newer task on the same tab', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const clear = vi.fn(async () => {});
    const snapshot = (tabId: number, signal: AbortSignal) =>
      runBrowserTabAction({ tabId, action: 'snapshot' }, signal, async () => 'snapshot', clear);
    await snapshot(1, a.signal);
    await snapshot(2, a.signal);
    await snapshot(1, b.signal);
    await releaseToolResources(a.signal);
    expect(clear.mock.calls).toEqual([[2]]);
    const click = vi.fn(async () => 'clicked');
    expect(
      await runBrowserTabAction({ tabId: 1, action: 'click', ref: 1 }, a.signal, click, clear),
    ).toContain('refresh refs');
    expect(click).not.toHaveBeenCalled();
    await releaseToolResources(b.signal);
    expect(clear.mock.calls).toEqual([[2], [1]]);
    await releaseToolResources(b.signal);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('finishes an in-flight snapshot before cleanup and skips a cancelled queued action', async () => {
    const controller = new AbortController();
    let resolve!: () => void;
    const hold = new Promise<void>(r => {
      resolve = r;
    });
    const calls: string[] = [];
    let started = false;
    const clear = async () => {
      calls.push('clear');
    };
    const snapshot = runBrowserTabAction(
      { tabId: 3, action: 'snapshot' },
      controller.signal,
      async () => {
        started = true;
        await hold;
        calls.push('show');
      },
      clear,
    );
    await vi.waitFor(() => expect(started).toBe(true));
    const click = runBrowserTabAction(
      { tabId: 3, action: 'click', ref: 1 },
      controller.signal,
      async () => {
        calls.push('click');
      },
      clear,
    );
    controller.abort();
    const cleanup = releaseToolResources(controller.signal);
    resolve();
    await Promise.all([snapshot, click, cleanup]);
    expect(calls).toEqual(['show', 'clear']);
    expect(await click).toContain('cancelled');
  });
});
