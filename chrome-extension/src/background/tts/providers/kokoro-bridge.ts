import { ensureOffscreenDocument } from '../../channels/offscreen-manager';
import { createLogger } from '../../logging/logger-buffer';
import { DEFAULT_SYNTHESIS_TIMEOUT_MS } from '../defaults';

const bridgeLog = createLogger('tts');

/** Encode ArrayBuffer as base64 (ArrayBuffer is not JSON-serializable via sendMessage) */
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000; // 32KB chunks to avoid call stack limits
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
};

/** Decode base64 back to ArrayBuffer */
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

interface BridgeSynthesisResult {
  audio: ArrayBuffer;
  sampleRate: number;
  contentType: string;
  voiceCompatible: boolean;
}

/** Request TTS synthesis via the offscreen document's TTS worker. */
const requestSynthesis = async (
  text: string,
  model: string,
  voice: string,
  speed: number,
  timeoutMs?: number,
): Promise<BridgeSynthesisResult> => {
  await ensureOffscreenDocument();

  const requestId = crypto.randomUUID();
  const effectiveTimeout = timeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;

  return new Promise<BridgeSynthesisResult>((resolve, reject) => {
    let settled = false;
    const t0 = Date.now();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      fn();
    };

    const timeout = setTimeout(() => {
      bridgeLog.warn('TTS synthesis TIMED OUT', {
        requestId,
        textLength: text.length,
        timeoutMs: effectiveTimeout,
        elapsedMs: Date.now() - t0,
      });
      settle(() =>
        reject(
          new Error(
            `TTS synthesis timed out after ${effectiveTimeout / 1000}s (text: ${text.length} chars)`,
          ),
        ),
      );
    }, effectiveTimeout);

    const listener = (message: Record<string, unknown>) => {
      if (message.requestId !== requestId) return;

      if (message.type === 'TTS_RESULT') {
        const audioBase64 = message.audioBase64 as string;
        const sampleRate = (message.sampleRate as number) ?? 24000;
        const contentType = (message.contentType as string) ?? 'audio/wav';
        const voiceCompatible = (message.voiceCompatible as boolean) ?? false;
        bridgeLog.debug('TTS_RESULT received', {
          requestId,
          elapsedMs: Date.now() - t0,
          contentType,
          voiceCompatible,
          audioBase64Length: audioBase64.length,
        });
        settle(() =>
          resolve({
            audio: base64ToArrayBuffer(audioBase64),
            sampleRate,
            contentType,
            voiceCompatible,
          }),
        );
      } else if (message.type === 'TTS_ERROR') {
        bridgeLog.warn('TTS_ERROR received', { requestId, error: message.error });
        settle(() => reject(new Error(message.error as string)));
      } else if (message.type === 'TTS_PROGRESS') {
        bridgeLog.debug('TTS progress', {
          requestId,
          status: message.status,
          elapsedMs: Date.now() - t0,
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    bridgeLog.debug('Sending TTS_SYNTHESIZE', {
      model,
      voice,
      speed,
      requestId,
      textLength: text.length,
      timeoutMs: effectiveTimeout,
    });

    chrome.runtime
      .sendMessage({
        type: 'TTS_SYNTHESIZE',
        text,
        model,
        voice,
        speed,
        requestId,
      })
      .then(response => {
        const resp = response as Record<string, unknown> | undefined;
        if (!resp || !resp.ok) {
          settle(() =>
            reject(
              new Error(
                `Offscreen document rejected TTS request: ${resp?.error ?? 'no response (module may have crashed)'}`,
              ),
            ),
          );
        }
      })
      .catch(err => {
        settle(() => reject(new Error(`Failed to send TTS request: ${err}`)));
      });
  });
};

/** Streaming TTS chunk from the offscreen worker. */
interface BridgeStreamChunk {
  chunkIndex: number;
  text: string;
  audio: ArrayBuffer;
  contentType: string;
  sampleRate: number;
  voiceCompatible: boolean;
}

/**
 * Request streaming TTS synthesis via the offscreen document's TTS worker.
 * The idle timeout resets on each chunk — only fires if no activity for `timeoutMs`.
 */
const requestStreamingSynthesis = async (
  text: string,
  model: string,
  voice: string,
  speed: number,
  onChunk: (chunk: BridgeStreamChunk) => void,
  timeoutMs?: number,
): Promise<void> => {
  await ensureOffscreenDocument();

  const requestId = crypto.randomUUID();
  const effectiveTimeout = timeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const t0 = Date.now();
    let chunksReceived = 0;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimeout);
      chrome.runtime.onMessage.removeListener(listener);
      fn();
    };

    // Idle timeout — resets on every chunk received
    let idleTimeout = setTimeout(() => {
      bridgeLog.warn('TTS streaming TIMED OUT (idle)', {
        requestId,
        textLength: text.length,
        timeoutMs: effectiveTimeout,
        elapsedMs: Date.now() - t0,
        chunksReceived,
      });
      settle(() =>
        reject(
          new Error(
            `TTS streaming synthesis timed out after ${effectiveTimeout / 1000}s idle (text: ${text.length} chars, chunks: ${chunksReceived})`,
          ),
        ),
      );
    }, effectiveTimeout);

    const resetIdleTimeout = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        bridgeLog.warn('TTS streaming TIMED OUT (idle)', {
          requestId,
          textLength: text.length,
          timeoutMs: effectiveTimeout,
          elapsedMs: Date.now() - t0,
          chunksReceived,
        });
        settle(() =>
          reject(
            new Error(
              `TTS streaming synthesis timed out after ${effectiveTimeout / 1000}s idle (text: ${text.length} chars, chunks: ${chunksReceived})`,
            ),
          ),
        );
      }, effectiveTimeout);
    };

    const listener = (message: Record<string, unknown>) => {
      if (message.requestId !== requestId) return;

      if (message.type === 'TTS_STREAM_CHUNK') {
        // Reset idle timeout on each chunk
        resetIdleTimeout();

        const audioBase64 = message.audioBase64 as string;
        const sampleRate = (message.sampleRate as number) ?? 24000;
        const contentType = (message.contentType as string) ?? 'audio/wav';
        const voiceCompatible = (message.voiceCompatible as boolean) ?? false;
        const chunkIndex = (message.chunkIndex as number) ?? 0;
        const chunkText = (message.text as string) ?? '';

        chunksReceived++;
        bridgeLog.debug('TTS_STREAM_CHUNK received', {
          requestId,
          chunkIndex,
          textPreview: chunkText.slice(0, 40),
          audioBase64Length: audioBase64.length,
          elapsedMs: Date.now() - t0,
        });

        onChunk({
          chunkIndex,
          text: chunkText,
          audio: base64ToArrayBuffer(audioBase64),
          contentType,
          sampleRate,
          voiceCompatible,
        });
      } else if (message.type === 'TTS_STREAM_END') {
        bridgeLog.debug('TTS_STREAM_END received', {
          requestId,
          totalChunks: chunksReceived,
          elapsedMs: Date.now() - t0,
        });
        settle(() => resolve());
      } else if (message.type === 'TTS_ERROR') {
        bridgeLog.warn('TTS_ERROR during streaming', { requestId, error: message.error });
        settle(() => reject(new Error(message.error as string)));
      } else if (message.type === 'TTS_PROGRESS') {
        // Reset idle timeout on progress too (model loading counts as activity)
        resetIdleTimeout();
        bridgeLog.debug('TTS streaming progress', {
          requestId,
          status: message.status,
          elapsedMs: Date.now() - t0,
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    bridgeLog.debug('Sending TTS_SYNTHESIZE_STREAM', {
      model,
      voice,
      speed,
      requestId,
      textLength: text.length,
      timeoutMs: effectiveTimeout,
    });

    chrome.runtime
      .sendMessage({
        type: 'TTS_SYNTHESIZE_STREAM',
        text,
        model,
        voice,
        speed,
        requestId,
      })
      .then(response => {
        const resp = response as Record<string, unknown> | undefined;
        if (!resp || !resp.ok) {
          settle(() =>
            reject(
              new Error(
                `Offscreen document rejected TTS stream request: ${resp?.error ?? 'no response (module may have crashed)'}`,
              ),
            ),
          );
        }
      })
      .catch(err => {
        settle(() => reject(new Error(`Failed to send TTS stream request: ${err}`)));
      });
  });
};

/** Batched streaming chunk — used for both first chunk and remainder callbacks. */
interface BridgeBatchedChunk {
  audio: ArrayBuffer;
  contentType: string;
  sampleRate: number;
  voiceCompatible: boolean;
}

/**
 * Request batched streaming TTS synthesis via the offscreen document.
 * Chunk 0 is sent immediately via onFirstChunk; remaining chunks are
 * accumulated in the worker and delivered as a single blob via onRemainder.
 */
const requestBatchedStreamingSynthesis = async (
  text: string,
  model: string,
  voice: string,
  speed: number,
  onFirstChunk: (chunk: BridgeBatchedChunk) => void,
  onRemainder: (chunk: BridgeBatchedChunk) => void,
  timeoutMs?: number,
  adaptiveChunking?: boolean,
): Promise<void> => {
  await ensureOffscreenDocument();

  const requestId = crypto.randomUUID();
  const effectiveTimeout = timeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const t0 = Date.now();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimeout);
      chrome.runtime.onMessage.removeListener(listener);
      fn();
    };

    let idleTimeout = setTimeout(() => {
      bridgeLog.warn('TTS batched streaming TIMED OUT (idle)', {
        requestId,
        textLength: text.length,
        timeoutMs: effectiveTimeout,
        elapsedMs: Date.now() - t0,
      });
      settle(() =>
        reject(new Error(`TTS batched streaming timed out after ${effectiveTimeout / 1000}s idle`)),
      );
    }, effectiveTimeout);

    const resetIdleTimeout = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        bridgeLog.warn('TTS batched streaming TIMED OUT (idle)', {
          requestId,
          textLength: text.length,
          timeoutMs: effectiveTimeout,
          elapsedMs: Date.now() - t0,
        });
        settle(() =>
          reject(
            new Error(`TTS batched streaming timed out after ${effectiveTimeout / 1000}s idle`),
          ),
        );
      }, effectiveTimeout);
    };

    const listener = (message: Record<string, unknown>) => {
      if (message.requestId !== requestId) return;

      if (message.type === 'TTS_STREAM_CHUNK') {
        resetIdleTimeout();
        const audioBase64 = message.audioBase64 as string;
        const sampleRate = (message.sampleRate as number) ?? 24000;
        const contentType = (message.contentType as string) ?? 'audio/wav';
        const voiceCompatible = (message.voiceCompatible as boolean) ?? false;

        bridgeLog.debug('TTS batched first chunk received', {
          requestId,
          audioBase64Length: audioBase64.length,
          elapsedMs: Date.now() - t0,
        });

        onFirstChunk({
          audio: base64ToArrayBuffer(audioBase64),
          contentType,
          sampleRate,
          voiceCompatible,
        });
      } else if (message.type === 'TTS_STREAM_REMAINDER') {
        resetIdleTimeout();
        const audioBase64 = message.audioBase64 as string;
        const sampleRate = (message.sampleRate as number) ?? 24000;
        const contentType = (message.contentType as string) ?? 'audio/wav';
        const voiceCompatible = (message.voiceCompatible as boolean) ?? false;

        bridgeLog.debug('TTS batched remainder received', {
          requestId,
          audioBase64Length: audioBase64.length,
          elapsedMs: Date.now() - t0,
        });

        onRemainder({
          audio: base64ToArrayBuffer(audioBase64),
          contentType,
          sampleRate,
          voiceCompatible,
        });
      } else if (message.type === 'TTS_STREAM_END') {
        bridgeLog.debug('TTS batched stream end', {
          requestId,
          elapsedMs: Date.now() - t0,
        });
        settle(() => resolve());
      } else if (message.type === 'TTS_ERROR') {
        bridgeLog.warn('TTS_ERROR during batched streaming', { requestId, error: message.error });
        settle(() => reject(new Error(message.error as string)));
      } else if (message.type === 'TTS_PROGRESS') {
        resetIdleTimeout();
        bridgeLog.debug('TTS batched streaming progress', {
          requestId,
          status: message.status,
          elapsedMs: Date.now() - t0,
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    bridgeLog.debug('Sending TTS_SYNTHESIZE_STREAM_BATCHED', {
      model,
      voice,
      speed,
      requestId,
      textLength: text.length,
      timeoutMs: effectiveTimeout,
    });

    chrome.runtime
      .sendMessage({
        type: 'TTS_SYNTHESIZE_STREAM_BATCHED',
        text,
        model,
        voice,
        speed,
        requestId,
        adaptiveChunking: adaptiveChunking ?? true,
      })
      .then(response => {
        const resp = response as Record<string, unknown> | undefined;
        if (!resp || !resp.ok) {
          settle(() =>
            reject(
              new Error(
                `Offscreen document rejected TTS batched stream request: ${resp?.error ?? 'no response (module may have crashed)'}`,
              ),
            ),
          );
        }
      })
      .catch(err => {
        settle(() => reject(new Error(`Failed to send TTS batched stream request: ${err}`)));
      });
  });
};

/** Pre-download a TTS model via the offscreen document. */
const requestModelDownload = async (model: string): Promise<string> => {
  await ensureOffscreenDocument();

  const downloadId = crypto.randomUUID();

  const response = (await chrome.runtime.sendMessage({
    type: 'TTS_DOWNLOAD_MODEL',
    model,
    downloadId,
  })) as Record<string, unknown> | undefined;

  if (!response || !response.ok) {
    throw new Error(
      `Offscreen document rejected TTS model download: ${(response?.error as string) ?? 'no response'}`,
    );
  }

  return downloadId;
};

export {
  requestSynthesis,
  requestStreamingSynthesis,
  requestBatchedStreamingSynthesis,
  requestModelDownload,
  arrayBufferToBase64,
  base64ToArrayBuffer,
};
export type { BridgeBatchedChunk };
