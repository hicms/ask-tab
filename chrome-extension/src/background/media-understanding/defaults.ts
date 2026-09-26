/** Default local Whisper model — multilingual for language auto-detect. */
const DEFAULT_LOCAL_MODEL = 'tiny';

/** Timeout for transcription requests (covers first model download + WASM compilation). */
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 300_000;

export { DEFAULT_LOCAL_MODEL, DEFAULT_TRANSCRIPTION_TIMEOUT_MS };
