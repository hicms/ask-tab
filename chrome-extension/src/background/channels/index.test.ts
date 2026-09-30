import { initChannels } from './index';
import { listChannels } from './gateway';
import { ensurePollAlarm, setChannelPolling, stopChannelPolling } from './poller';
import { AskServiceError } from '../ask-service/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelView } from './gateway';

vi.mock('./gateway', () => ({
  connectTelegram: vi.fn(),
  connectWhatsApp: vi.fn(),
  getChannelView: vi.fn(),
  isServerChannelId: vi.fn(() => true),
  listChannels: vi.fn(),
  removeChannel: vi.fn(),
  setChannelEnabled: vi.fn(),
}));
vi.mock('./poller', () => ({
  ensurePollAlarm: vi.fn(async () => {}),
  setChannelPolling: vi.fn(async () => {}),
  stopChannelPolling: vi.fn(async () => {}),
}));
vi.mock('./config', () => ({
  createDefaultChannelConfig: vi.fn(),
  getChannelConfig: vi.fn(),
  updateChannelConfig: vi.fn(),
}));
vi.mock('./telegram/commands', () => ({ registerBotCommands: vi.fn() }));
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../ask-service/endpoint', () => ({
  getServiceUrl: () => 'http://ask.test',
  serviceUrlReady: async () => {},
}));
vi.mock('@extension/storage', () => ({
  askSessionStorage: { get: vi.fn(async () => ({ token: 't' })) },
}));

const view = (overrides: Partial<ChannelView>): ChannelView => ({
  channel: 'telegram',
  enabled: true,
  status: 'connected',
  identity: '@bot',
  lastError: null,
  qr: null,
  acceptFromMe: true,
  acceptFromOthers: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initChannels', () => {
  it('stops polling once the server has disabled every channel', async () => {
    vi.mocked(listChannels).mockResolvedValueOnce([
      view({ enabled: false, status: 'error', lastError: 'Telegram rejected the bot token' }),
    ]);

    await initChannels();

    expect(setChannelPolling).toHaveBeenCalledWith(false);
  });

  it('keeps the poll alarm when the server cannot be reached, so the sync is retried', async () => {
    vi.mocked(listChannels).mockRejectedValueOnce(new Error('network down'));

    await expect(initChannels()).rejects.toThrow('network down');

    expect(ensurePollAlarm).toHaveBeenCalledOnce();
    expect(stopChannelPolling).not.toHaveBeenCalled();
  });

  it('stops polling when the session is rejected', async () => {
    vi.mocked(listChannels).mockRejectedValueOnce(new AskServiceError('Unauthorized', 401));

    expect(await initChannels()).toEqual([]);

    expect(stopChannelPolling).toHaveBeenCalledOnce();
    expect(ensurePollAlarm).not.toHaveBeenCalled();
  });
});
