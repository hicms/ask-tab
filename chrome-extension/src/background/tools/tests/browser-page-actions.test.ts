import { executePageAction } from '../browser-page-actions';
import { browserSchema } from '../browser-schema';
import { waitForPage } from '../browser-wait';
import { Value } from '@sinclair/typebox/value';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { cdp, visual } = vi.hoisted(() => ({ cdp: vi.fn(), visual: vi.fn(async () => true) }));
vi.mock('../cdp', () => ({ cdpSendWithReattach: cdp }));
vi.mock('../browser-visuals', () => ({ sendVisualCommand: visual }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Page Agent actions in browser', () => {
  it('exposes a single script entry and validates scroll/wait limits', () => {
    expect(Value.Check(browserSchema, { action: 'evaluate', expression: '1' })).toBe(false);
    expect(Value.Check(browserSchema, { action: 'select', tabId: 1, ref: 3, value: '' })).toBe(
      true,
    );
    expect(Value.Check(browserSchema, { action: 'scroll', pixels: -1 })).toBe(false);
    expect(Value.Check(browserSchema, { action: 'scroll', pages: 11 })).toBe(false);
    expect(Value.Check(browserSchema, { action: 'wait', seconds: 11 })).toBe(false);
    expect(Value.Check(browserSchema, { action: 'type', ref: 3, text: '' })).toBe(true);
  });

  it('resolves the original CDP backend node for dropdown selection', async () => {
    vi.stubGlobal('chrome', { tabs: { update: vi.fn() } });
    cdp
      .mockResolvedValueOnce({ object: { objectId: 'original-element' } })
      .mockResolvedValueOnce({ result: { value: 'Selected Beta' } });
    expect(
      await executePageAction({ action: 'select', tabId: 5, ref: 8, text: 'Beta' }, 'cdp', {
        nodeId: 70,
        backendNodeId: 80,
      }),
    ).toBe('Selected Beta');
    expect(cdp).toHaveBeenNthCalledWith(1, 5, 'DOM.resolveNode', { backendNodeId: 80 });
    expect(cdp).toHaveBeenNthCalledWith(
      2,
      5,
      'Runtime.callFunctionOn',
      expect.objectContaining({
        objectId: 'original-element',
        awaitPromise: true,
        arguments: [
          expect.objectContaining({
            value: expect.objectContaining({ action: 'select', ref: 8, text: 'Beta' }),
          }),
          { value: true },
        ],
      }),
    );
    expect(visual).toHaveBeenCalledWith(5, 'MAIN', 'move', 8);
  });

  it('does not fall back to a different ref map if a CDP ref is stale', async () => {
    expect(
      await executePageAction({ action: 'select', tabId: 5, ref: 8, text: 'Beta' }, 'cdp'),
    ).toContain('refresh refs');
    expect(cdp).not.toHaveBeenCalled();
    expect(visual).not.toHaveBeenCalled();
  });

  it('uses isolated scripting refs and allows empty text', async () => {
    const script = vi.fn(async () => [{ result: 'Typed empty' }]);
    vi.stubGlobal('chrome', { tabs: { update: vi.fn() }, scripting: { executeScript: script } });
    expect(
      await executePageAction({ action: 'type', tabId: 2, ref: 7, text: '' }, 'scripting'),
    ).toBe('Typed empty');
    expect(script).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 2 },
        args: [expect.objectContaining({ ref: 7, text: '' }), false],
      }),
    );
    expect(visual).toHaveBeenCalledWith(2, 'ISOLATED', 'move', 7);
  });

  it('waits for the requested duration and aborts without leaving timers', async () => {
    vi.useFakeTimers();
    const wait = waitForPage(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await wait).toContain('Waited 2');
    const controller = new AbortController();
    const cancelled = waitForPage(10, controller.signal);
    controller.abort();
    expect(await cancelled).toContain('cancelled');
    expect(await waitForPage(10, controller.signal)).toContain('cancelled');
    expect(vi.getTimerCount()).toBe(0);
    expect(await waitForPage(-1)).toContain('Error');
  });
});
