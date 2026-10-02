import { withDebuggerSession } from '../debugger-lifecycle';
import { releaseToolResources } from '../tool-lifecycle';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logging/logger-buffer', () => ({ createLogger: () => ({ warn: vi.fn() }) }));

const detach = vi.fn((_target: unknown, done: () => void) => done());
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  detach.mockReset().mockImplementation((_target, done) => done());
  vi.stubGlobal('chrome', { debugger: { detach }, runtime: { lastError: undefined } });
});

describe('task debugger lifetime', () => {
  it('releases every target once and keeps connections between tools in the same task', async () => {
    const signal = new AbortController().signal;
    const work = async () => 'done';
    await withDebuggerSession(1, signal, work);
    await withDebuggerSession({ tabId: 1 }, signal, work);
    await withDebuggerSession(2, signal, work);
    await withDebuggerSession({ targetId: 'sandbox' }, signal, work);
    expect(detach).not.toHaveBeenCalled();
    await releaseToolResources(signal);
    await releaseToolResources(signal);
    expect(detach.mock.calls.map(([target]) => target)).toEqual([
      { tabId: 1 },
      { tabId: 2 },
      { targetId: 'sandbox' },
    ]);
  });

  it('keeps a shared target attached until its last task ends', async () => {
    const first = new AbortController().signal;
    const second = new AbortController().signal;
    const work = async () => {};
    await withDebuggerSession(3, first, work);
    await withDebuggerSession(3, second, work);
    await releaseToolResources(first);
    expect(detach).not.toHaveBeenCalled();
    await releaseToolResources(second);
    expect(detach).toHaveBeenCalledExactlyOnceWith({ tabId: 3 }, expect.any(Function));
  });

  it('releases a connection after the tool fails', async () => {
    const signal = new AbortController().signal;
    await expect(
      withDebuggerSession(4, signal, async () => {
        throw new Error('CDP failed after attaching');
      }),
    ).rejects.toThrow('CDP failed');
    await releaseToolResources(signal);
    expect(detach).toHaveBeenCalledExactlyOnceWith({ tabId: 4 }, expect.any(Function));
  });

  it('waits for an in-flight attach before detaching a cancelled task', async () => {
    const controller = new AbortController();
    const started = deferred();
    const attached = deferred();
    const running = withDebuggerSession(5, controller.signal, async () => {
      started.resolve();
      await attached.promise;
    });
    await started.promise;
    controller.abort();
    const cleanup = releaseToolResources(controller.signal);
    await Promise.resolve();
    expect(detach).not.toHaveBeenCalled();
    attached.resolve();
    await Promise.all([running, cleanup]);
    expect(detach).toHaveBeenCalledExactlyOnceWith({ tabId: 5 }, expect.any(Function));
  });

  it('waits for the previous detach before another task can use the same target', async () => {
    const first = new AbortController().signal;
    const second = new AbortController().signal;
    const detaching = deferred();
    let finishDetach!: () => void;
    detach.mockImplementationOnce((_target, done) => {
      finishDetach = done;
      detaching.resolve();
    });
    await withDebuggerSession(6, first, async () => {});
    const cleanup = releaseToolResources(first);
    await detaching.promise;
    const next = vi.fn(async () => 'next');
    const running = withDebuggerSession(6, second, next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    finishDetach();
    await cleanup;
    expect(await running).toBe('next');
    await releaseToolResources(second);
    expect(detach).toHaveBeenCalledTimes(2);
  });

  it('still releases other targets when one tab has already closed', async () => {
    const signal = new AbortController().signal;
    await withDebuggerSession(7, signal, async () => {});
    await withDebuggerSession(8, signal, async () => {});
    detach.mockImplementationOnce((_target, done) => {
      chrome.runtime.lastError = { message: 'No tab with given id' };
      done();
      chrome.runtime.lastError = undefined;
    });
    await releaseToolResources(signal);
    expect(detach).toHaveBeenCalledTimes(2);
  });
});
