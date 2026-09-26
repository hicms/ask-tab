import type { AskSession } from '@extension/storage';

// ── TTS Types ─────────────────────────────────────────

type TtsProvider = 'kokoro' | 'openai';
type TtsAutoMode = 'off' | 'always' | 'inbound';

interface TtsSynthesizeOptions {
  voice?: string;
  model?: string;
  speed?: number;
  adaptiveChunking?: boolean;
  session?: AskSession;
}

interface TtsSynthesizeResult {
  /** Raw audio bytes */
  audio: ArrayBuffer;
  /** MIME type of the audio */
  contentType: string;
  /** Sample rate */
  sampleRate?: number;
  /** Whether the format is directly voice-compatible for Telegram (OGG Opus) */
  voiceCompatible: boolean;
}

/** A single chunk of streamed TTS audio (one sentence or segment). */
interface TtsStreamChunk {
  chunkIndex: number;
  text: string;
  audio: ArrayBuffer;
  contentType: string;
  sampleRate?: number;
  voiceCompatible: boolean;
}

/** Callback invoked for each streamed TTS chunk. */
type TtsStreamCallback = (chunk: TtsStreamChunk) => void;

/** Callback for batched streaming — receives a single encoded audio blob. */
type TtsBatchedChunkCallback = (chunk: TtsSynthesizeResult) => void;

interface TtsProviderImpl {
  id: TtsProvider;
  synthesize: (text: string, options: TtsSynthesizeOptions) => Promise<TtsSynthesizeResult>;
  /** Optional streaming synthesis — yields audio per-sentence via callback. */
  synthesizeStream?: (
    text: string,
    options: TtsSynthesizeOptions,
    onChunk: TtsStreamCallback,
  ) => Promise<void>;
  /** Optional batched streaming — sends first chunk immediately, remainder as a single blob. */
  synthesizeBatchedStream?: (
    text: string,
    options: TtsSynthesizeOptions,
    onFirstChunk: TtsBatchedChunkCallback,
    onRemainder: TtsBatchedChunkCallback,
  ) => Promise<void>;
}

interface TtsConfig {
  /** Which engine to use */
  engine: 'off' | TtsProvider;
  /** When to generate voice replies */
  autoMode: TtsAutoMode;
  /** Maximum characters to TTS (longer → truncate or summarize) */
  maxChars: number;
  /** Whether to summarize long text before TTS */
  summarize: boolean;
  /** Timeout for LLM summarization (ms) */
  summaryTimeout: number;
  /** Auto-play TTS audio in the browser chat UI (side panel / full-page chat) */
  chatUiAutoPlay: boolean;
  /** Kokoro local TTS settings */
  kokoro: {
    model: string;
    voice: string;
    speed: number;
    /** Split remainder into adaptive time-based chunks instead of one large blob */
    adaptiveChunking: boolean;
  };
  /** OpenAI TTS settings */
  openai: {
    modelId: string;
    voice: string;
  };
}

interface TtsApplyResult {
  audio: ArrayBuffer;
  contentType: string;
  voiceCompatible: boolean;
  provider: string;
  latencyMs: number;
}

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
};
