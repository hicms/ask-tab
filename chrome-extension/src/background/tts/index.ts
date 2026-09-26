export { maybeApplyTts } from './resolve';
export { preprocessForTts } from './preprocess';
export { getProvider, PROVIDERS } from './providers';
export { summarizeForTts } from './summarize';
export type {
  TtsProvider,
  TtsAutoMode,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsProviderImpl,
  TtsConfig,
  TtsApplyResult,
} from './types';
export {
  DEFAULT_MAX_CHARS,
  MIN_TTS_LENGTH,
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  DEFAULT_SUMMARY_TIMEOUT_MS,
} from './defaults';
