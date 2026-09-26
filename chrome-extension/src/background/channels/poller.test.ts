import { ackUpdates, pullUpdates } from './gateway';
import { handleQueuedUpdate } from './message-bridge';
import {
  CHANNEL_POLL_ALARM,
  isChannelPollAlarm,
  runPollCycle,
  setChannelPolling,
  stopChannelPolling,
} from './poller';
import { AskServiceError } from '../ask-service/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedUpdate } from './gateway';

vi.mock('./gateway', () => ({
  pullUpdates: vi.fn(),
  ackUpdates: vi.fn(async () => {}),
}));

vi.mock('./message-bridge', () => ({
  handleQueuedUpdate: vi.fn(async () => false),
}));

vi.mock('../ask-service/client', () => {
  class AskServiceError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { AskServiceError };
});

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const alarms = vi.hoisted(() => {
  const mock = {
    get: vi.fn(async (): Promise<{ name: string; scheduledTime: number } | undefined> => undefined),
    create: vi.fn(async () => {}),
    clear: vi.fn(async () => true),
  };
  vi.stubGlobal('chrome', { alarms: mock });
  return mock;
});

const item = (id: string): QueuedUpdate => ({
  id,
  channel: 'telegram',
  update: {},
  mediaType: null,
});

const pulls = vi.mocked(pullUpdates);

let now = Date.UTC(2026, 0, 1);

describe('channel poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pulls.mockResolvedValue([]);
    // Each test starts well past the previous test's conversation window.
    vi.useFakeTimers({ toFake: ['Date'] });
    now += 60 * 60_000;
    vi.setSystemTime(now);
  });

  afterEach(async () => {
    await stopChannelPolling();
    vi.useRealTimers();
  });

  it('recognizes its alarm', () => {
    expect(isChannelPollAlarm(CHANNEL_POLL_ALARM)).toBe(true);
    expect(isChannelPollAlarm('channel-poll-telegram')).toBe(false);
  });

  it('pulls briefly when idle and stops once the queue is empty', async () => {
    await runPollCycle();

    expect(pulls).toHaveBeenCalledOnce();
    expect(pulls).toHaveBeenCalledWith(5, expect.any(AbortSignal));
  });

  it('handles and acks each item, even when handling throws', async () => {
    pulls.mockResolvedValueOnce([item('a'), item('b')]).mockResolvedValue([]);
    vi.mocked(handleQueuedUpdate).mockRejectedValueOnce(new Error('boom'));

    await runPollCycle();

    expect(handleQueuedUpdate).toHaveBeenCalledTimes(2);
    expect(ackUpdates).toHaveBeenNthCalledWith(1, ['a']);
    expect(ackUpdates).toHaveBeenNthCalledWith(2, ['b']);
  });

  it('long-polls while a conversation is active', async () => {
    pulls.mockResolvedValueOnce([item('a')]);
    vi.mocked(handleQueuedUpdate).mockResolvedValueOnce(true);
    let stop!: () => void;
    const stopped = new Promise<void>(resolve => (stop = resolve));
    pulls.mockImplementationOnce(async (wait, signal) => {
      expect(wait).toBe(20);
      stop();
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });

    const cycle = runPollCycle();
    await stopped;
    await stopChannelPolling();
    await cycle;

    expect(pulls).toHaveBeenCalledTimes(2);
  });

  it('joins a cycle that is already running', async () => {
    let release!: (items: QueuedUpdate[]) => void;
    pulls.mockImplementationOnce(() => new Promise(resolve => (release = resolve)));

    const first = runPollCycle();
    const second = runPollCycle();
    release([]);
    await Promise.all([first, second]);

    expect(pulls).toHaveBeenCalledOnce();
  });

  it('stops polling when the session is rejected', async () => {
    pulls.mockRejectedValueOnce(new AskServiceError('Unauthorized', 401));

    await runPollCycle();

    expect(alarms.clear).toHaveBeenCalledWith(CHANNEL_POLL_ALARM);
  });

  it('keeps the alarm after a transient pull failure', async () => {
    pulls.mockRejectedValueOnce(new Error('network down'));

    await runPollCycle();

    expect(alarms.clear).not.toHaveBeenCalledWith(CHANNEL_POLL_ALARM);
    expect(ackUpdates).not.toHaveBeenCalled();
  });

  it('creates the alarm and polls when enabled', async () => {
    await setChannelPolling(true);
    await runPollCycle();

    expect(alarms.create).toHaveBeenCalledWith(CHANNEL_POLL_ALARM, { periodInMinutes: 0.5 });
    expect(pulls).toHaveBeenCalledOnce();
  });

  it('keeps an existing alarm', async () => {
    alarms.get.mockResolvedValueOnce({ name: CHANNEL_POLL_ALARM, scheduledTime: 0 });

    await setChannelPolling(true);
    await runPollCycle();

    expect(alarms.create).not.toHaveBeenCalled();
  });

  it('clears the alarm when disabled', async () => {
    await setChannelPolling(false);

    expect(alarms.clear).toHaveBeenCalledWith(CHANNEL_POLL_ALARM);
    expect(pulls).not.toHaveBeenCalled();
  });
});
