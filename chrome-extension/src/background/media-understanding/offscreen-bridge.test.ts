import { requestTranscription, requestModelDownload } from './offscreen-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../channels/offscreen-manager', () => ({
  ensureOffscreenDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Stub chrome.runtime API
type MessageListener = (message: Record<string, unknown>) => void;
const listeners: MessageListener[] = [];

const chromeMock = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: MessageListener) => listeners.push(fn)),
      removeListener: vi.fn((fn: MessageListener) => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

const fireMessage = (msg: Record<string, unknown>) => {
  for (const fn of [...listeners]) fn(msg);
};

const audio = new ArrayBuffer(8);

describe('requestTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
  });

  it('resolves with text on TRANSCRIBE_RESULT', async () => {
    chromeMock.runtime.sendMessage.mockImplementation(async () => {
      // Simulate offscreen processing and sending result after ack
      queueMicrotask(() =>
        fireMessage({
          type: 'TRANSCRIBE_RESULT',
          requestId: 'test-uuid-1234',
          text: 'hello world',
        }),
      );
      return { ok: true };
    });

    const result = await requestTranscription(audio, 'audio/ogg', 'tiny', 'zh');
    expect(result).toBe('hello world');
    expect(listeners).toHaveLength(0);
  });

  it('sends correct message shape', async () => {
    chromeMock.runtime.sendMessage.mockImplementation(async () => {
      queueMicrotask(() =>
        fireMessage({ type: 'TRANSCRIBE_RESULT', requestId: 'test-uuid-1234', text: 'ok' }),
      );
      return { ok: true };
    });

    await requestTranscription(audio, 'audio/ogg', 'base.en', 'ja');

    const msg = chromeMock.runtime.sendMessage.mock.calls[0][0];
    expect(msg.type).toBe('TRANSCRIBE_AUDIO');
    expect(msg.mimeType).toBe('audio/ogg');
    expect(msg.requestId).toBe('test-uuid-1234');
    expect(msg.engine).toBe('transformers');
    expect(msg.model).toBe('base.en');
    expect(msg.language).toBe('ja');
    expect(typeof msg.audioBase64).toBe('string');
  });

  it('rejects on TRANSCRIBE_ERROR', async () => {
    chromeMock.runtime.sendMessage.mockImplementation(async () => {
      queueMicrotask(() =>
        fireMessage({
          type: 'TRANSCRIBE_ERROR',
          requestId: 'test-uuid-1234',
          error: 'Model load failed',
        }),
      );
      return { ok: true };
    });

    await expect(requestTranscription(audio, 'audio/ogg', 'tiny')).rejects.toThrow(
      'Model load failed',
    );
    expect(listeners).toHaveLength(0);
  });

  it('ignores messages with different requestId', async () => {
    chromeMock.runtime.sendMessage.mockImplementation(async () => {
      queueMicrotask(() => {
        // Wrong requestId — should be ignored
        fireMessage({ type: 'TRANSCRIBE_RESULT', requestId: 'other-uuid', text: 'wrong' });
        // Correct requestId
        fireMessage({ type: 'TRANSCRIBE_RESULT', requestId: 'test-uuid-1234', text: 'right' });
      });
      return { ok: true };
    });

    const result = await requestTranscription(audio, 'audio/ogg', 'tiny');
    expect(result).toBe('right');
  });

  it('rejects when offscreen responds with not ok', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'crashed' });

    await expect(requestTranscription(audio, 'audio/ogg', 'tiny')).rejects.toThrow(
      'Offscreen document rejected transcription: crashed',
    );
  });

  it('rejects when sendMessage throws', async () => {
    chromeMock.runtime.sendMessage.mockRejectedValue(new Error('extension context invalid'));

    await expect(requestTranscription(audio, 'audio/ogg', 'tiny')).rejects.toThrow(
      'Failed to send transcription request',
    );
  });
});

describe('requestModelDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
  });

  it('returns downloadId on success', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    const downloadId = await requestModelDownload('tiny');
    expect(downloadId).toBe('test-uuid-1234');
  });

  it('sends correct message shape', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true });

    await requestModelDownload('base.en');

    const msg = chromeMock.runtime.sendMessage.mock.calls[0][0];
    expect(msg.type).toBe('STT_DOWNLOAD_MODEL');
    expect(msg.engine).toBe('transformers');
    expect(msg.model).toBe('base.en');
    expect(msg.downloadId).toBe('test-uuid-1234');
  });

  it('throws when offscreen responds with not ok', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'module crash' });

    await expect(requestModelDownload('tiny')).rejects.toThrow(
      'Offscreen document rejected model download: module crash',
    );
  });

  it('throws when offscreen returns no response', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue(undefined);

    await expect(requestModelDownload('tiny')).rejects.toThrow(
      'no response (module may have crashed)',
    );
  });
});
