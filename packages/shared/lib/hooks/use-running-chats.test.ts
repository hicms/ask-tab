import { useRunningChats } from './use-running-chats.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let current: ReadonlySet<string>;
let cleanup: (() => void) | undefined;
vi.mock('react', () => ({
  useState: (initial: () => ReadonlySet<string>) => [
    (current = initial()),
    (next: ReadonlySet<string>) => {
      current = next;
    },
  ],
  useEffect: (effect: () => (() => void) | undefined) => {
    cleanup = effect();
  },
}));

describe('running chat history subscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => ({
          postMessage: vi.fn(),
          disconnect: vi.fn(),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    });
  });
  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows multiple tasks, clears finished ones, and resubscribes after worker suspension', () => {
    useRunningChats();
    const port = vi.mocked(chrome.runtime.connect).mock.results[0].value;
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'LLM_STREAM_WATCH' });
    const receive = port.onMessage.addListener.mock.calls[0][0];
    receive({ type: 'LLM_RUNNING_CHATS', chatIds: ['a', 'b'] });
    expect([...current]).toEqual(['a', 'b']);
    receive({ type: 'LLM_RUNNING_CHATS', chatIds: ['b'] });
    expect([...current]).toEqual(['b']);
    port.onDisconnect.addListener.mock.calls[0][0]();
    expect(current.size).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    const next = vi.mocked(chrome.runtime.connect).mock.results[1].value;
    next.onMessage.addListener.mock.calls[0][0]({ type: 'LLM_RUNNING_CHATS', chatIds: ['c'] });
    expect([...current]).toEqual(['c']);
    cleanup?.();
    next.onDisconnect.addListener.mock.calls[0][0]();
    vi.advanceTimersByTime(2000);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
  });

  it('does not subscribe while history is hidden', () => {
    useRunningChats(false);
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });
});
