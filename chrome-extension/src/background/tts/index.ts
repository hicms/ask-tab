export { maybeApplyTts, maybeApplyTtsStreaming, maybeApplyTtsBatchedStream } from './resolve';
export { preprocessForTts } from './preprocess';
export { getProvider, PROVIDERS } from './providers';
export { summarizeForTts } from './summarize';
export type {
  TtsProvider,
  TtsAutoMode,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsStreamChunk,
  TtsStreamCallback,
  TtsBatchedChunkCallback,
  TtsProviderImpl,
  TtsConfig,
  TtsApplyResult,
} from './types';
export {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  DEFAULT_SPEED,
  DEFAULT_MAX_CHARS,
  MIN_TTS_LENGTH,
  DEFAULT_SYNTHESIS_TIMEOUT_MS,
  computeSynthesisTimeout,
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  DEFAULT_SUMMARY_TIMEOUT_MS,
} from './defaults';
