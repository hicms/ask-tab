import { MIN_TTS_LENGTH } from './defaults';
import { preprocessForTts } from './preprocess';
import { getProvider } from './providers';
import { requireSession } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { publicModelsStorage } from '@extension/storage';
import type {
  TtsConfig,
  TtsApplyResult,
  TtsProvider,
  TtsStreamChunk,
  TtsSynthesizeResult,
  TtsSynthesizeOptions,
} from './types';
import type { ChatModel } from '@extension/shared';
import type { AskSession } from '@extension/storage';

const ttsLog = createLogger('tts');

/** Determine whether TTS should fire for this reply. */
const shouldSynthesize = (
  config: TtsConfig,
  inboundHadAudio: boolean,
  responseText: string,
): boolean => {
  if (config.engine === 'off') return false;
  if (config.autoMode === 'off') return false;
  if (config.autoMode === 'inbound' && !inboundHadAudio) return false;

  const trimmed = responseText.trim();
  if (trimmed.length < MIN_TTS_LENGTH) return false;

  // Skip if response already contains media tokens
  if (trimmed.includes('MEDIA:')) return false;

  return true;
};

/** Build provider-specific options from TTS config. */
const buildProviderOptions = (
  config: TtsConfig,
  providerId: TtsProvider,
  resolvedModelId?: string,
): TtsSynthesizeOptions => {
  if (providerId === 'kokoro') {
    return {
      model: config.kokoro.model,
      voice: config.kokoro.voice,
      speed: config.kokoro.speed,
      adaptiveChunking: config.kokoro.adaptiveChunking,
    };
  }
  if (providerId === 'openai') {
    return {
      model: resolvedModelId ?? config.openai.modelId,
      voice: config.openai.voice,
    };
  }
  return {};
};

/** Respect the selected local or server engine. */
const resolveProviderOrder = (primary: TtsProvider): TtsProvider[] => [primary];

/** Resolve a published TTS capability. The server owns its upstream credentials. */
const resolveServerTtsModel = async (config: TtsConfig): Promise<string> => {
  const catalog = await publicModelsStorage.get();
  const models = catalog.filter(model => model.kind === 'tts');
  const selected = config.openai.modelId
    ? models.find(model => model.id === config.openai.modelId)
    : (models.find(model => model.isDefault) ?? models[0]);
  if (!selected) throw new Error('Server TTS is not configured');
  await requireSession();
  return selected.id;
};

// ── Shared preprocessing ────────────────────────

/** Resolved TTS context: preprocessed text + provider dispatch info. */
interface TtsContext {
  ttsText: string;
  engineProvider: TtsProvider;
  serverModelId: string | undefined;
  session?: AskSession;
  providerOrder: TtsProvider[];
}

/**
 * Shared preprocessing pipeline used by both maybeApplyTts and maybeApplyTtsStreaming.
 * Returns null if TTS should not fire.
 */
const prepareTtsContext = async (params: {
  text: string;
  config: TtsConfig;
  inboundHadAudio: boolean;
  modelConfig?: ChatModel;
}): Promise<TtsContext | null> => {
  const { text, config, inboundHadAudio, modelConfig } = params;

  if (!shouldSynthesize(config, inboundHadAudio, text)) {
    ttsLog.debug('TTS skipped (shouldSynthesize=false)', {
      engine: config.engine,
      autoMode: config.autoMode,
      inboundHadAudio,
      textLength: text.length,
    });
    return null;
  }

  const session = config.engine === 'openai' ? await requireSession() : undefined;

  ttsLog.debug('TTS preprocessing', {
    inputTextLength: text.length,
    maxChars: config.maxChars,
    summarize: config.summarize,
    engine: config.engine,
  });

  // Preprocess: strip markdown, truncate
  let ttsText = preprocessForTts(text, config.maxChars);
  const wasTruncated = text.length > config.maxChars;

  if (wasTruncated) {
    ttsLog.debug('TTS text truncated', {
      originalLength: text.length,
      maxChars: config.maxChars,
      truncatedLength: ttsText.length,
    });
  }

  // Summarize if text exceeds maxChars and summarization is enabled
  if (wasTruncated && config.summarize) {
    try {
      ttsLog.debug('TTS summarization starting', {
        inputLength: text.length,
        targetMaxChars: config.maxChars,
        timeoutMs: config.summaryTimeout,
      });
      const { summarizeForTts } = await import('./summarize');
      ttsText = await summarizeForTts(text, config.maxChars, modelConfig, config.summaryTimeout);
      ttsLog.debug('TTS summarization complete', { summaryLength: ttsText.length });
    } catch (err) {
      ttsLog.warn('TTS summarization failed, using truncated text', {
        error: err instanceof Error ? err.message : String(err),
        fallbackLength: ttsText.length,
      });
    }
  }

  if (ttsText.length < MIN_TTS_LENGTH) {
    ttsLog.debug('TTS skipped (text too short after preprocessing)', {
      ttsTextLength: ttsText.length,
    });
    return null;
  }

  ttsLog.debug('TTS text prepared', { ttsTextLength: ttsText.length });

  // Determine provider from config engine
  const engineProvider = config.engine as TtsProvider;

  const serverModelId =
    engineProvider === 'openai' ? await resolveServerTtsModel(config) : undefined;

  return {
    ttsText,
    engineProvider,
    serverModelId,
    session,
    providerOrder: resolveProviderOrder(engineProvider),
  };
};

/** Resolve options for the selected local or server provider. */
const resolveProviderOptions = async (
  config: TtsConfig,
  providerId: TtsProvider,
  ctx: TtsContext,
): Promise<TtsSynthesizeOptions> => ({
  ...buildProviderOptions(config, providerId, ctx.serverModelId),
  ...(providerId === 'openai' ? { session: ctx.session } : {}),
});

// ── Public API ──────────────────────────────────

/**
 * Main TTS entry point. Checks config, preprocesses text, synthesizes audio.
 * Returns null if TTS should not fire. Non-fatal: errors are caught and logged.
 */
const maybeApplyTts = async (params: {
  text: string;
  config: TtsConfig;
  inboundHadAudio: boolean;
  modelConfig?: ChatModel;
}): Promise<TtsApplyResult | null> => {
  const ctx = await prepareTtsContext(params);
  if (!ctx) return null;

  let lastError: string | undefined;

  for (const providerId of ctx.providerOrder) {
    const start = Date.now();
    try {
      const provider = getProvider(providerId);
      if (!provider) {
        lastError = `${providerId}: provider not found`;
        continue;
      }

      const options = await resolveProviderOptions(params.config, providerId, ctx);
      if (!options) {
        lastError = `${providerId}: not configured`;
        continue;
      }

      ttsLog.debug('TTS synthesize starting', {
        provider: providerId,
        ttsTextLength: ctx.ttsText.length,
      });
      const result = await provider.synthesize(ctx.ttsText, options);

      ttsLog.info('TTS synthesize complete', {
        provider: providerId,
        latencyMs: Date.now() - start,
        contentType: result.contentType,
        audioBytes: result.audio.byteLength,
        voiceCompatible: result.voiceCompatible,
      });
      return {
        ...result,
        provider: providerId,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      lastError = `${providerId}: ${err instanceof Error ? err.message : String(err)}`;
      ttsLog.warn('TTS provider failed', { provider: providerId, error: lastError });
    }
  }

  // All providers failed — return null (non-fatal)
  ttsLog.warn('TTS: all providers failed', { lastError });
  return null;
};

/** Streaming TTS chunk with provider info. */
interface TtsStreamChunkWithProvider extends TtsStreamChunk {
  provider: string;
}

/**
 * Streaming TTS entry point. Same preprocessing as maybeApplyTts, but delivers
 * audio per-sentence via onChunk callback. Falls back to single-blob delivery
 * when the provider doesn't support streaming.
 *
 * Returns true if TTS was triggered, false otherwise.
 */
const maybeApplyTtsStreaming = async (params: {
  text: string;
  config: TtsConfig;
  inboundHadAudio: boolean;
  modelConfig?: ChatModel;
  onChunk: (chunk: TtsStreamChunkWithProvider) => void;
  onComplete: () => void;
}): Promise<boolean> => {
  const { onChunk, onComplete } = params;
  const ctx = await prepareTtsContext(params);
  if (!ctx) return false;

  let lastError: string | undefined;

  for (const providerId of ctx.providerOrder) {
    try {
      const provider = getProvider(providerId);
      if (!provider) {
        lastError = `${providerId}: provider not found`;
        continue;
      }

      const options = await resolveProviderOptions(params.config, providerId, ctx);
      if (!options) {
        lastError = `${providerId}: not configured`;
        continue;
      }

      // Try streaming path if available
      if (provider.synthesizeStream) {
        ttsLog.debug('TTS streaming starting', {
          provider: providerId,
          ttsTextLength: ctx.ttsText.length,
        });
        const t0 = Date.now();
        let chunkCount = 0;
        await provider.synthesizeStream(ctx.ttsText, options, chunk => {
          chunkCount++;
          onChunk({ ...chunk, provider: providerId });
        });
        ttsLog.info('TTS streaming complete', {
          provider: providerId,
          chunks: chunkCount,
          elapsedMs: Date.now() - t0,
        });
        onComplete();
        return true;
      }

      // Fallback: single-blob synthesis delivered as one chunk
      ttsLog.debug('TTS single-blob fallback', {
        provider: providerId,
        ttsTextLength: ctx.ttsText.length,
      });
      const t0 = Date.now();
      const result = await provider.synthesize(ctx.ttsText, options);
      ttsLog.info('TTS single-blob complete', {
        provider: providerId,
        elapsedMs: Date.now() - t0,
        audioBytes: result.audio.byteLength,
      });
      onChunk({
        chunkIndex: 0,
        text: ctx.ttsText,
        audio: result.audio,
        contentType: result.contentType,
        sampleRate: result.sampleRate,
        voiceCompatible: result.voiceCompatible,
        provider: providerId,
      });
      onComplete();
      return true;
    } catch (err) {
      lastError = `${providerId}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  ttsLog.warn('TTS streaming: all providers failed', { lastError });
  return false;
};

/** Batched chunk delivered to the caller — audio blob with metadata and provider info. */
interface TtsBatchedChunkWithProvider extends TtsSynthesizeResult {
  provider: string;
}

/**
 * Batched streaming TTS entry point for Telegram.
 * Sends the first sentence immediately via onFirstChunk, then accumulates
 * remaining audio and delivers it as a single blob via onRemainder.
 *
 * Fallback chain:
 * 1. Provider has synthesizeBatchedStream → use it directly
 * 2. Provider has synthesizeStream → chunk 0 → onFirstChunk, concat rest → sequential onRemainder calls
 * 3. Provider has only synthesize → single blob → onFirstChunk
 *
 * Returns true if TTS was triggered, false otherwise.
 */
const maybeApplyTtsBatchedStream = async (params: {
  text: string;
  config: TtsConfig;
  inboundHadAudio: boolean;
  modelConfig?: ChatModel;
  onFirstChunk: (chunk: TtsBatchedChunkWithProvider) => void | Promise<void>;
  onRemainder: (chunk: TtsBatchedChunkWithProvider) => void | Promise<void>;
}): Promise<boolean> => {
  const { onFirstChunk, onRemainder } = params;
  const ctx = await prepareTtsContext(params);
  if (!ctx) return false;

  let lastError: string | undefined;

  for (const providerId of ctx.providerOrder) {
    try {
      const provider = getProvider(providerId);
      if (!provider) {
        lastError = `${providerId}: provider not found`;
        continue;
      }

      const options = await resolveProviderOptions(params.config, providerId, ctx);
      if (!options) {
        lastError = `${providerId}: not configured`;
        continue;
      }

      // Collect async callback promises so we can await them before returning.
      // Without this, sendVoiceMessage HTTP requests would float as unresolved
      // promises and the service worker could go idle before they complete.
      const pendingOps: Promise<void>[] = [];
      const trackOp = (result: void | Promise<void>) => {
        if (result) pendingOps.push(result);
      };

      // Path 1: Native batched streaming
      if (provider.synthesizeBatchedStream) {
        ttsLog.debug('TTS batched streaming starting', {
          provider: providerId,
          ttsTextLength: ctx.ttsText.length,
        });
        const t0 = Date.now();
        await provider.synthesizeBatchedStream(
          ctx.ttsText,
          options,
          chunk => {
            trackOp(onFirstChunk({ ...chunk, provider: providerId }));
          },
          chunk => {
            trackOp(onRemainder({ ...chunk, provider: providerId }));
          },
        );
        for (const op of pendingOps) await op;
        ttsLog.info('TTS batched streaming complete', {
          provider: providerId,
          elapsedMs: Date.now() - t0,
        });
        return true;
      }

      // Path 2: Per-chunk streaming fallback — first chunk → onFirstChunk, rest → sequential onRemainder
      if (provider.synthesizeStream) {
        ttsLog.debug('TTS batched stream fallback (per-chunk)', {
          provider: providerId,
          ttsTextLength: ctx.ttsText.length,
        });
        const t0 = Date.now();
        let chunkCount = 0;
        await provider.synthesizeStream(ctx.ttsText, options, chunk => {
          const batchedChunk: TtsBatchedChunkWithProvider = {
            audio: chunk.audio,
            contentType: chunk.contentType,
            sampleRate: chunk.sampleRate,
            voiceCompatible: chunk.voiceCompatible,
            provider: providerId,
          };
          if (chunkCount === 0) {
            trackOp(onFirstChunk(batchedChunk));
          } else {
            trackOp(onRemainder(batchedChunk));
          }
          chunkCount++;
        });
        for (const op of pendingOps) await op;
        ttsLog.info('TTS batched stream fallback complete', {
          provider: providerId,
          chunks: chunkCount,
          elapsedMs: Date.now() - t0,
        });
        return true;
      }

      // Path 3: Monolithic synthesis — single blob as onFirstChunk
      ttsLog.debug('TTS batched single-blob fallback', {
        provider: providerId,
        ttsTextLength: ctx.ttsText.length,
      });
      const t0 = Date.now();
      const result = await provider.synthesize(ctx.ttsText, options);
      ttsLog.info('TTS batched single-blob complete', {
        provider: providerId,
        elapsedMs: Date.now() - t0,
        audioBytes: result.audio.byteLength,
      });
      const p = onFirstChunk({
        audio: result.audio,
        contentType: result.contentType,
        sampleRate: result.sampleRate,
        voiceCompatible: result.voiceCompatible,
        provider: providerId,
      });
      if (p) await p;
      return true;
    } catch (err) {
      lastError = `${providerId}: ${err instanceof Error ? err.message : String(err)}`;
      ttsLog.warn('TTS batched provider failed', { provider: providerId, error: lastError });
    }
  }

  ttsLog.warn('TTS batched streaming: all providers failed', { lastError });
  return false;
};

export {
  maybeApplyTts,
  maybeApplyTtsStreaming,
  maybeApplyTtsBatchedStream,
  shouldSynthesize,
  buildProviderOptions,
  resolveProviderOrder,
  resolveServerTtsModel,
};
