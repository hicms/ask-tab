// ── TTS Defaults ──────────────────────────────────────

/** Maximum characters to send to TTS */
const DEFAULT_MAX_CHARS = 2000;

/** Minimum characters for TTS to trigger (skip very short replies) */
const MIN_TTS_LENGTH = 10;

/** Default OpenAI TTS model */
const OPENAI_TTS_DEFAULT_MODEL = 'tts-1';

/** Default OpenAI TTS voice */
const OPENAI_TTS_DEFAULT_VOICE = 'nova';

/** Timeout for LLM-based summarization (ms) */
const DEFAULT_SUMMARY_TIMEOUT_MS = 15_000;

export {
  DEFAULT_MAX_CHARS,
  MIN_TTS_LENGTH,
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  DEFAULT_SUMMARY_TIMEOUT_MS,
};
