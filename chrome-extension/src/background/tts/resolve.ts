import { MIN_TTS_LENGTH } from './defaults';
import { preprocessForTts } from './preprocess';
import { getProvider } from './providers';
import { requireSession } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { publicModelsStorage } from '@extension/storage';
import type { TtsConfig, TtsApplyResult, TtsProvider, TtsSynthesizeOptions } from './types';
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
  if (providerId === 'openai') {
    return {
      model: resolvedModelId ?? config.openai.modelId,
      voice: config.openai.voice,
    };
  }
  return {};
};

/** Respect the selected engine. */
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

/** Preprocessing pipeline for maybeApplyTts. Returns null if TTS should not fire. */
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

/** Resolve options for the selected provider. */
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

export {
  maybeApplyTts,
  shouldSynthesize,
  buildProviderOptions,
  resolveProviderOrder,
  resolveServerTtsModel,
};
