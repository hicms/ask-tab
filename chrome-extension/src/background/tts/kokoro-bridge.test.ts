import {
  requestSynthesis,
  requestStreamingSynthesis,
  requestBatchedStreamingSynthesis,
  requestModelDownload,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from './providers/kokoro-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Now safe to import

// ── Mock dependencies BEFORE any imports that touch chrome ──

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
  debugger: {
    onDetach: { addListener: vi.fn() },
  },
};

vi.stubGlobal('chrome', chromeMock);
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });

const fireMessage = (msg: Record<string, unknown>) => {
  for (const fn of [...listeners]) fn(msg);
};

describe('tts/providers/kokoro-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
  });

  describe('arrayBufferToBase64 / base64ToArrayBuffer', () => {
    it('round-trips correctly', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      const base64 = arrayBufferToBase64(original);
      const decoded = base64ToArrayBuffer(base64);
      expect(new Uint8Array(decoded)).toEqual(new Uint8Array(original));
    });

    it('handles empty buffer', () => {
      const empty = new ArrayBuffer(0);
      const base64 = arrayBufferToBase64(empty);
      const decoded = base64ToArrayBuffer(base64);
      expect(decoded.byteLength).toBe(0);
    });
  });

  describe('requestSynthesis', () => {
    it('sends TTS_SYNTHESIZE message and resolves on TTS_RESULT', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() =>
          fireMessage({
            type: 'TTS_RESULT',
            requestId: 'test-uuid-1234',
            audioBase64: btoa('fake-audio'),
            sampleRate: 24000,
            contentType: 'audio/ogg',
            voiceCompatible: true,
          }),
        );
        return { ok: true };
      });

      const result = await requestSynthesis('Hello', 'model-1', 'af_heart', 1.0);

      expect(result.sampleRate).toBe(24000);
      expect(result.audio.byteLength).toBeGreaterThan(0);
      expect(result.contentType).toBe('audio/ogg');
      expect(result.voiceCompatible).toBe(true);

      // Verify message was sent
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'TTS_SYNTHESIZE',
        text: 'Hello',
        model: 'model-1',
        voice: 'af_heart',
        speed: 1.0,
        requestId: 'test-uuid-1234',
      });

      // Verify listener was cleaned up
      expect(listeners).toHaveLength(0);
    });

    it('rejects on TTS_ERROR from offscreen', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() =>
          fireMessage({
            type: 'TTS_ERROR',
            requestId: 'test-uuid-1234',
            error: 'Model load failed',
          }),
        );
        return { ok: true };
      });

      await expect(requestSynthesis('Hello', 'model-1', 'af_heart', 1.0)).rejects.toThrow(
        'Model load failed',
      );
      expect(listeners).toHaveLength(0);
    });

    it('rejects when offscreen rejects the request', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Not ready' });

      await expect(requestSynthesis('Hello', 'model-1', 'af_heart', 1.0)).rejects.toThrow(
        'Offscreen document rejected TTS request: Not ready',
      );
    });

    it('rejects when sendMessage throws', async () => {
      chromeMock.runtime.sendMessage.mockRejectedValue(new Error('Extension context invalidated'));

      await expect(requestSynthesis('Hello', 'model-1', 'af_heart', 1.0)).rejects.toThrow(
        'Failed to send TTS request',
      );
    });

    it('ignores messages with different requestId', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() => {
          // First: wrong requestId (should be ignored)
          fireMessage({
            type: 'TTS_RESULT',
            requestId: 'other-uuid',
            audioBase64: btoa('wrong'),
            sampleRate: 24000,
          });
          // Then: correct requestId
          fireMessage({
            type: 'TTS_RESULT',
            requestId: 'test-uuid-1234',
            audioBase64: btoa('correct'),
            sampleRate: 24000,
          });
        });
        return { ok: true };
      });

      const result = await requestSynthesis('Hello', 'model-1', 'af_heart', 1.0);
      expect(result.audio.byteLength).toBeGreaterThan(0);
      expect(listeners).toHaveLength(0);
    });

    it('handles TTS_PROGRESS messages without resolving/rejecting', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() => {
          // Progress first
          fireMessage({
            type: 'TTS_PROGRESS',
            requestId: 'test-uuid-1234',
            status: 'synthesizing',
          });
          // Then result
          fireMessage({
            type: 'TTS_RESULT',
            requestId: 'test-uuid-1234',
            audioBase64: btoa('audio'),
            sampleRate: 24000,
          });
        });
        return { ok: true };
      });

      const result = await requestSynthesis('Hello', 'model-1', 'af_heart', 1.0);
      expect(result.audio.byteLength).toBeGreaterThan(0);
    });

    it('rejects after synthesis timeout and cleans up listener', async () => {
      vi.useFakeTimers();

      // sendMessage returns ok but never fires a TTS_RESULT or TTS_ERROR
      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true });

      const promise = requestSynthesis('Hello', 'model-1', 'af_heart', 1.0);

      // Attach catch to prevent unhandled rejection during timer advancement
      promise.catch(() => {});

      // Flush microtasks so sendMessage mock resolves, then advance past timeout
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(promise).rejects.toThrow('TTS synthesis timed out after 60s');

      // Verify listener was cleaned up
      expect(listeners).toHaveLength(0);

      vi.useRealTimers();
    });

    it('ignores late messages after settlement', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() =>
          fireMessage({
            type: 'TTS_RESULT',
            requestId: 'test-uuid-1234',
            audioBase64: btoa('first-audio'),
            sampleRate: 24000,
          }),
        );
        return { ok: true };
      });

      const result = await requestSynthesis('Hello', 'model-1', 'af_heart', 1.0);
      expect(result.audio.byteLength).toBeGreaterThan(0);

      // Late message should not cause issues (listener already removed by settlement guard)
      expect(listeners).toHaveLength(0);
    });

    it('defaults sampleRate to 24000 when not provided', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() =>
          fireMessage({
            type: 'TTS_RESULT',
            requestId: 'test-uuid-1234',
            audioBase64: btoa('audio'),
            // no sampleRate
          }),
        );
        return { ok: true };
      });

      const result = await requestSynthesis('Hello', 'model-1', 'af_heart', 1.0);
      expect(result.sampleRate).toBe(24000);
      expect(result.contentType).toBe('audio/wav');
      expect(result.voiceCompatible).toBe(false);
    });
  });

  describe('requestStreamingSynthesis', () => {
    it('sends TTS_SYNTHESIZE_STREAM and resolves on TTS_STREAM_END', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() => {
          fireMessage({
            type: 'TTS_STREAM_CHUNK',
            requestId: 'test-uuid-1234',
            chunkIndex: 0,
            text: 'Hello.',
            audioBase64: btoa('chunk-0-audio'),
            contentType: 'audio/ogg',
            voiceCompatible: true,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_CHUNK',
            requestId: 'test-uuid-1234',
            chunkIndex: 1,
            text: 'World.',
            audioBase64: btoa('chunk-1-audio'),
            contentType: 'audio/ogg',
            voiceCompatible: true,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_END',
            requestId: 'test-uuid-1234',
            totalChunks: 2,
          });
        });
        return { ok: true };
      });

      const chunks: { chunkIndex: number; text: string }[] = [];
      await requestStreamingSynthesis('Hello. World.', 'model-1', 'af_heart', 1.0, chunk => {
        chunks.push({ chunkIndex: chunk.chunkIndex, text: chunk.text });
      });

      expect(chunks).toHaveLength(2);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].text).toBe('Hello.');
      expect(chunks[1].chunkIndex).toBe(1);
      expect(chunks[1].text).toBe('World.');

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'TTS_SYNTHESIZE_STREAM',
        text: 'Hello. World.',
        model: 'model-1',
        voice: 'af_heart',
        speed: 1.0,
        requestId: 'test-uuid-1234',
      });

      expect(listeners).toHaveLength(0);
    });

    it('rejects on TTS_ERROR during streaming', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() =>
          fireMessage({
            type: 'TTS_ERROR',
            requestId: 'test-uuid-1234',
            error: 'Stream synthesis failed',
          }),
        );
        return { ok: true };
      });

      await expect(
        requestStreamingSynthesis('Hello', 'model-1', 'af_heart', 1.0, vi.fn()),
      ).rejects.toThrow('Stream synthesis failed');
      expect(listeners).toHaveLength(0);
    });

    it('rejects when offscreen rejects the stream request', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Not ready' });

      await expect(
        requestStreamingSynthesis('Hello', 'model-1', 'af_heart', 1.0, vi.fn()),
      ).rejects.toThrow('Offscreen document rejected TTS stream request: Not ready');
    });

    it('rejects after timeout and cleans up listener', async () => {
      vi.useFakeTimers();

      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true });

      const promise = requestStreamingSynthesis('Hello', 'model-1', 'af_heart', 1.0, vi.fn());
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(60_000);

      await expect(promise).rejects.toThrow('TTS streaming synthesis timed out after 60s');
      expect(listeners).toHaveLength(0);

      vi.useRealTimers();
    });

    it('ignores messages with different requestId', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() => {
          fireMessage({
            type: 'TTS_STREAM_CHUNK',
            requestId: 'other-uuid',
            chunkIndex: 0,
            text: 'Wrong.',
            audioBase64: btoa('wrong'),
            contentType: 'audio/wav',
            voiceCompatible: false,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_CHUNK',
            requestId: 'test-uuid-1234',
            chunkIndex: 0,
            text: 'Correct.',
            audioBase64: btoa('correct'),
            contentType: 'audio/ogg',
            voiceCompatible: true,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_END',
            requestId: 'test-uuid-1234',
            totalChunks: 1,
          });
        });
        return { ok: true };
      });

      const chunks: { text: string }[] = [];
      await requestStreamingSynthesis('Hello', 'model-1', 'af_heart', 1.0, chunk => {
        chunks.push({ text: chunk.text });
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Correct.');
    });
  });

  describe('requestBatchedStreamingSynthesis', () => {
    it('sends TTS_SYNTHESIZE_STREAM_BATCHED and delivers first chunk + remainder', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() => {
          fireMessage({
            type: 'TTS_STREAM_CHUNK',
            requestId: 'test-uuid-1234',
            chunkIndex: 0,
            text: 'Hello.',
            audioBase64: btoa('first-audio'),
            contentType: 'audio/ogg',
            voiceCompatible: true,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_REMAINDER',
            requestId: 'test-uuid-1234',
            audioBase64: btoa('remainder-audio'),
            contentType: 'audio/ogg',
            voiceCompatible: true,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_END',
            requestId: 'test-uuid-1234',
            totalChunks: 3,
          });
        });
        return { ok: true };
      });

      const onFirstChunk = vi.fn();
      const onRemainder = vi.fn();

      await requestBatchedStreamingSynthesis(
        'Hello. World. Test.',
        'model-1',
        'af_heart',
        1.0,
        onFirstChunk,
        onRemainder,
      );

      expect(onFirstChunk).toHaveBeenCalledOnce();
      expect(onFirstChunk.mock.calls[0][0].contentType).toBe('audio/ogg');
      expect(onFirstChunk.mock.calls[0][0].voiceCompatible).toBe(true);
      expect(onFirstChunk.mock.calls[0][0].audio.byteLength).toBeGreaterThan(0);

      expect(onRemainder).toHaveBeenCalledOnce();
      expect(onRemainder.mock.calls[0][0].contentType).toBe('audio/ogg');
      expect(onRemainder.mock.calls[0][0].audio.byteLength).toBeGreaterThan(0);

      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'TTS_SYNTHESIZE_STREAM_BATCHED',
        text: 'Hello. World. Test.',
        model: 'model-1',
        voice: 'af_heart',
        speed: 1.0,
        requestId: 'test-uuid-1234',
        adaptiveChunking: true,
      });

      expect(listeners).toHaveLength(0);
    });

    it('resolves with only first chunk when no remainder (single sentence)', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() => {
          fireMessage({
            type: 'TTS_STREAM_CHUNK',
            requestId: 'test-uuid-1234',
            chunkIndex: 0,
            text: 'Hello.',
            audioBase64: btoa('only-audio'),
            contentType: 'audio/ogg',
            voiceCompatible: true,
            sampleRate: 24000,
          });
          fireMessage({
            type: 'TTS_STREAM_END',
            requestId: 'test-uuid-1234',
            totalChunks: 1,
          });
        });
        return { ok: true };
      });

      const onFirstChunk = vi.fn();
      const onRemainder = vi.fn();

      await requestBatchedStreamingSynthesis(
        'Hello.',
        'model-1',
        'af_heart',
        1.0,
        onFirstChunk,
        onRemainder,
      );

      expect(onFirstChunk).toHaveBeenCalledOnce();
      expect(onRemainder).not.toHaveBeenCalled();
      expect(listeners).toHaveLength(0);
    });

    it('rejects on TTS_ERROR', async () => {
      chromeMock.runtime.sendMessage.mockImplementation(async () => {
        queueMicrotask(() =>
          fireMessage({
            type: 'TTS_ERROR',
            requestId: 'test-uuid-1234',
            error: 'Batched synthesis failed',
          }),
        );
        return { ok: true };
      });

      await expect(
        requestBatchedStreamingSynthesis('Hello', 'model-1', 'af_heart', 1.0, vi.fn(), vi.fn()),
      ).rejects.toThrow('Batched synthesis failed');
      expect(listeners).toHaveLength(0);
    });

    it('rejects when offscreen rejects the request', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Not ready' });

      await expect(
        requestBatchedStreamingSynthesis('Hello', 'model-1', 'af_heart', 1.0, vi.fn(), vi.fn()),
      ).rejects.toThrow('Offscreen document rejected TTS batched stream request: Not ready');
    });

    it('rejects after timeout', async () => {
      vi.useFakeTimers();

      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true });

      const promise = requestBatchedStreamingSynthesis(
        'Hello',
        'model-1',
        'af_heart',
        1.0,
        vi.fn(),
        vi.fn(),
      );
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(60_000);

      await expect(promise).rejects.toThrow('TTS batched streaming timed out after 60s');
      expect(listeners).toHaveLength(0);

      vi.useRealTimers();
    });
  });

  describe('requestModelDownload', () => {
    it('sends TTS_DOWNLOAD_MODEL message', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: true });

      const downloadId = await requestModelDownload('my-model');

      expect(downloadId).toBe('test-uuid-1234');
      expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'TTS_DOWNLOAD_MODEL',
        model: 'my-model',
        downloadId: 'test-uuid-1234',
      });
    });

    it('rejects when offscreen rejects', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Storage full' });

      await expect(requestModelDownload('my-model')).rejects.toThrow(
        'Offscreen document rejected TTS model download: Storage full',
      );
    });

    it('rejects when sendMessage returns no response', async () => {
      chromeMock.runtime.sendMessage.mockResolvedValue(undefined);

      await expect(requestModelDownload('my-model')).rejects.toThrow('no response');
    });
  });
});
