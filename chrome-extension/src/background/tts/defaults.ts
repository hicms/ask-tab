// ── TTS Defaults ──────────────────────────────────────

/** Default Kokoro ONNX model */
const DEFAULT_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Default voice (American female, highest rated) */
const DEFAULT_VOICE = 'af_heart';

/** Default speaking speed */
const DEFAULT_SPEED = 1.0;

/** Maximum characters to send to TTS */
const DEFAULT_MAX_CHARS = 2000;

/** Minimum characters for TTS to trigger (skip very short replies) */
const MIN_TTS_LENGTH = 10;

/** Timeout for TTS synthesis requests (ms) — base value, scaled by text length */
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 60_000;

/** Extra timeout per 500 characters of input text (ms) */
const SYNTHESIS_TIMEOUT_PER_500_CHARS_MS = 30_000;

/** Maximum synthesis timeout cap (ms) */
const MAX_SYNTHESIS_TIMEOUT_MS = 300_000;

/** Compute a timeout proportional to text length (longer text = more synthesis time) */
const computeSynthesisTimeout = (textLength: number): number =>
  Math.min(
    DEFAULT_SYNTHESIS_TIMEOUT_MS + Math.ceil(textLength / 500) * SYNTHESIS_TIMEOUT_PER_500_CHARS_MS,
    MAX_SYNTHESIS_TIMEOUT_MS,
  );

/** Default OpenAI TTS model */
const OPENAI_TTS_DEFAULT_MODEL = 'tts-1';

/** Default OpenAI TTS voice */
const OPENAI_TTS_DEFAULT_VOICE = 'nova';

/** Timeout for LLM-based summarization (ms) */
const DEFAULT_SUMMARY_TIMEOUT_MS = 15_000;

export {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  DEFAULT_SPEED,
  DEFAULT_MAX_CHARS,
  MIN_TTS_LENGTH,
  DEFAULT_SYNTHESIS_TIMEOUT_MS,
  SYNTHESIS_TIMEOUT_PER_500_CHARS_MS,
  MAX_SYNTHESIS_TIMEOUT_MS,
  computeSynthesisTimeout,
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  DEFAULT_SUMMARY_TIMEOUT_MS,
};
