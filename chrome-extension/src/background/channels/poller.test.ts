import { getChannelConfig, updateChannelConfig } from './config';
import { handleChannelUpdates } from './message-bridge';
import {
  getPassiveAlarmName,
  isChannelPollAlarm,
  channelIdFromAlarmName,
  createPassiveAlarm,
  clearPassiveAlarm,
  handlePassivePollAlarm,
} from './poller';
import { getUpdatesShortPoll } from './telegram/bot-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelConfig } from './types';

// ── Chrome alarms mock ──
const chromeAlarmsMock = { create: vi.fn(), clear: vi.fn(async () => true) };
vi.stubGlobal('chrome', { alarms: chromeAlarmsMock });

// ── Dependency mocks ──
vi.mock('./config', () => ({
  getChannelConfig: vi.fn(),
  updateChannelConfig: vi.fn(async () => {}),
}));
vi.mock('./message-bridge', () => ({
  handleChannelUpdates: vi.fn(async () => undefined),
}));
vi.mock('./telegram/bot-api', () => ({
  getUpdatesShortPoll: vi.fn(async () => []),
}));
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

const mockedGetChannelConfig = vi.mocked(getChannelConfig);
const mockedUpdateChannelConfig = vi.mocked(updateChannelConfig);
const mockedHandleChannelUpdates = vi.mocked(handleChannelUpdates);
const mockedGetUpdatesShortPoll = vi.mocked(getUpdatesShortPoll);

const makeConfig = (overrides: Partial<ChannelConfig> = {}): ChannelConfig => ({
  channelId: 'telegram',
  enabled: true,
  allowedSenderIds: ['123'],
  status: 'passive',
  credentials: { botToken: '123:abc' },
  lastPollOffset: 0,
  ...overrides,
});

describe('poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Pure helper tests ──

  it('getPassiveAlarmName returns correct prefix', () => {
    expect(getPassiveAlarmName('telegram')).toBe('channel-poll-telegram');
    expect(getPassiveAlarmName('whatsapp')).toBe('channel-poll-whatsapp');
  });

  it('isChannelPollAlarm returns true for matching prefix', () => {
    expect(isChannelPollAlarm('channel-poll-telegram')).toBe(true);
    expect(isChannelPollAlarm('channel-poll-whatsapp')).toBe(true);
  });

  it('isChannelPollAlarm returns false for non-matching names', () => {
    expect(isChannelPollAlarm('some-other-alarm')).toBe(false);
    expect(isChannelPollAlarm('channel-telegram')).toBe(false);
    expect(isChannelPollAlarm('')).toBe(false);
  });

  it('channelIdFromAlarmName extracts channel id', () => {
    expect(channelIdFromAlarmName('channel-poll-telegram')).toBe('telegram');
    expect(channelIdFromAlarmName('channel-poll-whatsapp')).toBe('whatsapp');
  });

  // ── Alarm create/clear ──

  it('createPassiveAlarm calls chrome.alarms.create with correct params', () => {
    createPassiveAlarm('telegram');

    expect(chromeAlarmsMock.create).toHaveBeenCalledWith('channel-poll-telegram', {
      periodInMinutes: 0.5,
    });
  });

  it('clearPassiveAlarm calls chrome.alarms.clear', async () => {
    await clearPassiveAlarm('telegram');

    expect(chromeAlarmsMock.clear).toHaveBeenCalledWith('channel-poll-telegram');
  });

  // ── handlePassivePollAlarm ──

  it('skips poll when channel config not found', async () => {
    mockedGetChannelConfig.mockResolvedValue(undefined);

    await handlePassivePollAlarm('telegram');

    expect(mockedGetUpdatesShortPoll).not.toHaveBeenCalled();
  });

  it('skips poll when channel is not enabled', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig({ enabled: false }));

    await handlePassivePollAlarm('telegram');

    expect(mockedGetUpdatesShortPoll).not.toHaveBeenCalled();
  });

  it('skips poll when channel is in active mode', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig({ status: 'active' }));

    await handlePassivePollAlarm('telegram');

    expect(mockedGetUpdatesShortPoll).not.toHaveBeenCalled();
  });

  it('skips poll when already polling (concurrent guard)', async () => {
    // Set up a slow poll that blocks for a moment
    let resolveSlowPoll: () => void;
    const slowPollPromise = new Promise<void>(r => {
      resolveSlowPoll = r;
    });

    mockedGetChannelConfig.mockImplementation(async () => {
      await slowPollPromise;
      return makeConfig();
    });

    // Start first poll (will be blocked on the slow poll)
    const firstPoll = handlePassivePollAlarm('telegram');

    // Start second poll immediately (should be skipped due to concurrent guard)
    const secondPoll = handlePassivePollAlarm('telegram');

    // Wait for second poll to complete (it skips immediately)
    await secondPoll;

    // Release the first poll
    resolveSlowPoll!();
    await firstPoll;

    // getChannelConfig should have been called only once (first poll)
    // because the second poll was skipped before reaching it
    expect(mockedGetChannelConfig).toHaveBeenCalledTimes(1);
  });

  it('advances offset after processing updates', async () => {
    const config = makeConfig({ lastPollOffset: 5 });
    mockedGetChannelConfig.mockResolvedValue(config);
    mockedGetUpdatesShortPoll.mockResolvedValue([
      {
        update_id: 10,
        message: { message_id: 1, chat: { id: 123, type: 'private' }, date: 1000, text: 'hello' },
      },
      {
        update_id: 12,
        message: { message_id: 2, chat: { id: 123, type: 'private' }, date: 1001, text: 'world' },
      },
    ]);
    mockedHandleChannelUpdates.mockResolvedValue(12);

    await handlePassivePollAlarm('telegram');

    // New offset should be maxUpdateId + 1 = 13, which is > current offset 5
    expect(mockedUpdateChannelConfig).toHaveBeenCalledWith('telegram', { lastPollOffset: 13 });
  });

  it('does not advance offset when new offset <= current', async () => {
    const config = makeConfig({ lastPollOffset: 20 });
    // First call returns config with offset 20 (initial check), second returns same (fresh read)
    mockedGetChannelConfig.mockResolvedValue(config);
    mockedGetUpdatesShortPoll.mockResolvedValue([
      {
        update_id: 10,
        message: { message_id: 3, chat: { id: 123, type: 'private' }, date: 1002, text: 'old' },
      },
    ]);
    mockedHandleChannelUpdates.mockResolvedValue(10);

    await handlePassivePollAlarm('telegram');

    // newOffset = 10 + 1 = 11, which is <= currentOffset 20, so no update
    expect(mockedUpdateChannelConfig).not.toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ lastPollOffset: expect.any(Number) }),
    );
  });

  it('skips poll when no bot token configured', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig({ credentials: { botToken: '' } }));

    await handlePassivePollAlarm('telegram');

    expect(mockedGetUpdatesShortPoll).not.toHaveBeenCalled();
  });

  it('sets error status on 401 Unauthorized', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig());
    mockedGetUpdatesShortPoll.mockRejectedValue(new Error('getUpdates failed: 401 Unauthorized'));

    await handlePassivePollAlarm('telegram');

    expect(mockedUpdateChannelConfig).toHaveBeenCalledWith('telegram', {
      status: 'error',
      lastError: expect.stringContaining('401'),
    });
  });

  it('does not set error status on non-auth errors', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig());
    mockedGetUpdatesShortPoll.mockRejectedValue(new Error('Network timeout'));

    await handlePassivePollAlarm('telegram');

    // Should NOT have set error status (only 401/Unauthorized triggers that)
    expect(mockedUpdateChannelConfig).not.toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('clears error status on successful poll', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig({ status: 'error' }));
    mockedGetUpdatesShortPoll.mockResolvedValue([]);

    await handlePassivePollAlarm('telegram');

    expect(mockedUpdateChannelConfig).toHaveBeenCalledWith('telegram', {
      status: 'passive',
      lastError: undefined,
    });
  });

  it('warns on unknown channel for passive poll', async () => {
    mockedGetChannelConfig.mockResolvedValue(makeConfig({ channelId: 'unknown-channel' }));

    await handlePassivePollAlarm('unknown-channel');

    expect(mockedGetUpdatesShortPoll).not.toHaveBeenCalled();
  });

  it('handles undefined lastPollOffset gracefully', async () => {
    mockedGetChannelConfig.mockResolvedValue(
      makeConfig({ lastPollOffset: undefined as unknown as number }),
    );
    mockedGetUpdatesShortPoll.mockResolvedValue([]);

    await handlePassivePollAlarm('telegram');

    // getUpdatesShortPoll should have been called with undefined offset
    expect(mockedGetUpdatesShortPoll).toHaveBeenCalledWith('123:abc', undefined);
  });
});
