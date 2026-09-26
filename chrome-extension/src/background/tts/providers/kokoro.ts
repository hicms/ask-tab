import {
  requestSynthesis,
  requestStreamingSynthesis,
  requestBatchedStreamingSynthesis,
} from './kokoro-bridge';
import { DEFAULT_MODEL, DEFAULT_VOICE, DEFAULT_SPEED, computeSynthesisTimeout } from '../defaults';
import type {
  TtsProviderImpl,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsStreamCallback,
  TtsBatchedChunkCallback,
} from '../types';

const synthesize = async (
  text: string,
  options: TtsSynthesizeOptions,
): Promise<TtsSynthesizeResult> => {
  const model = options.model ?? DEFAULT_MODEL;
  const voice = options.voice ?? DEFAULT_VOICE;
  const speed = options.speed ?? DEFAULT_SPEED;
  const timeoutMs = computeSynthesisTimeout(text.length);

  const result = await requestSynthesis(text, model, voice, speed, timeoutMs);

  // The worker tries OGG Opus first (voice-bubble compatible), falls back to WAV.
  // Bridge result carries contentType and voiceCompatible from the worker.
  return {
    audio: result.audio,
    contentType: result.contentType,
    sampleRate: result.sampleRate,
    voiceCompatible: result.voiceCompatible,
  };
};

const synthesizeStream = async (
  text: string,
  options: TtsSynthesizeOptions,
  onChunk: TtsStreamCallback,
): Promise<void> => {
  const model = options.model ?? DEFAULT_MODEL;
  const voice = options.voice ?? DEFAULT_VOICE;
  const speed = options.speed ?? DEFAULT_SPEED;
  const timeoutMs = computeSynthesisTimeout(text.length);

  await requestStreamingSynthesis(
    text,
    model,
    voice,
    speed,
    bridgeChunk => {
      onChunk({
        chunkIndex: bridgeChunk.chunkIndex,
        text: bridgeChunk.text,
        audio: bridgeChunk.audio,
        contentType: bridgeChunk.contentType,
        sampleRate: bridgeChunk.sampleRate,
        voiceCompatible: bridgeChunk.voiceCompatible,
      });
    },
    timeoutMs,
  );
};

const synthesizeBatchedStream = async (
  text: string,
  options: TtsSynthesizeOptions,
  onFirstChunk: TtsBatchedChunkCallback,
  onRemainder: TtsBatchedChunkCallback,
): Promise<void> => {
  const model = options.model ?? DEFAULT_MODEL;
  const voice = options.voice ?? DEFAULT_VOICE;
  const speed = options.speed ?? DEFAULT_SPEED;
  const timeoutMs = computeSynthesisTimeout(text.length);

  await requestBatchedStreamingSynthesis(
    text,
    model,
    voice,
    speed,
    bridgeChunk => {
      onFirstChunk({
        audio: bridgeChunk.audio,
        contentType: bridgeChunk.contentType,
        sampleRate: bridgeChunk.sampleRate,
        voiceCompatible: bridgeChunk.voiceCompatible,
      });
    },
    bridgeChunk => {
      onRemainder({
        audio: bridgeChunk.audio,
        contentType: bridgeChunk.contentType,
        sampleRate: bridgeChunk.sampleRate,
        voiceCompatible: bridgeChunk.voiceCompatible,
      });
    },
    timeoutMs,
    options.adaptiveChunking,
  );
};

const kokoroTtsProvider: TtsProviderImpl = {
  id: 'kokoro',
  synthesize,
  synthesizeStream,
  synthesizeBatchedStream,
};

export { kokoroTtsProvider };
