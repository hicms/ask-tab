import type { AskSession } from '@extension/storage';

// ── TTS Types ─────────────────────────────────────────

type TtsProvider = 'openai';
type TtsAutoMode = 'off' | 'always' | 'inbound';

interface TtsSynthesizeOptions {
  voice?: string;
  model?: string;
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

interface TtsProviderImpl {
  id: TtsProvider;
  synthesize: (text: string, options: TtsSynthesizeOptions) => Promise<TtsSynthesizeResult>;
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
  TtsProviderImpl,
  TtsConfig,
  TtsApplyResult,
};
