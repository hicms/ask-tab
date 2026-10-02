/**
 * StreamFn bridge: uses pi-ai's native streamSimple() to produce
 * AssistantMessageEventStream compatible with pi-agent's agent loop.
 *
 * streamSimple() natively handles provider routing, message conversion,
 * tool definitions, and event emission — no manual bridging needed.
 */

import { withAbort } from './cancellation';
import { chatModelToPiModel } from './model-adapter';
import { loadReasoningSettings, withReasoningSettings } from './reasoning-payload';
import { confirmSessionAfterModelError, requireSession } from '../ask-service/client';
import { serviceUrlReady } from '../ask-service/endpoint';
import { createLogger } from '../logging/logger-buffer';
import { completeSimple, streamGoogle, streamSimple } from '@mariozechner/pi-ai';
import { buildBaseOptions } from '@mariozechner/pi-ai/dist/providers/simple-options.js';
import type { ChatModel } from '@extension/shared';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import type { Api, Context, Model, SimpleStreamOptions, TextContent } from '@mariozechner/pi-ai';

const bridgeLog = createLogger('stream');

/**
 * Without an effort level, streamSimple sends no thinkingConfig and Gemini
 * hides its thought summaries. Ask for them while keeping the model's own
 * thinking level.
 */
const streamModel = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
  model.api === 'google-generative-ai' && !options?.reasoning
    ? streamGoogle(model as Model<'google-generative-ai'>, context, {
        ...buildBaseOptions(model, options),
        thinking: { enabled: model.reasoning },
      })
    : streamSimple(model, context, options);

/**
 * Create a StreamFn using pi-mono's native streaming.
 * streamSimple() already returns AssistantMessageEventStream.
 */
export const createStreamFn = (modelConfig: ChatModel): StreamFn => {
  const { model } = chatModelToPiModel(modelConfig);

  return async (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    // Read per call so a change made during a long tool loop applies to its next turn.
    const reasoning = await loadReasoningSettings(modelConfig.id);
    bridgeLog.trace('Provider call', {
      modelId: model.id,
      provider: model.provider,
      api: model.api,
      baseUrl: model.baseUrl,
      hasApiKey: !!options?.apiKey,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning,
    });
    const stream = streamModel(
      model,
      context,
      withReasoningSettings(model.api, reasoning, options),
    );
    void stream.result().then(message => {
      if (message.stopReason === 'error')
        void confirmSessionAfterModelError(model.baseUrl, options?.apiKey);
    });
    return stream;
  };
};

/** Non-streaming completion helper for summarizer/journal. */
export const completeText = async (
  modelConfig: ChatModel,
  systemPrompt: string,
  userContent: string,
  opts?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> => {
  await serviceUrlReady();
  const { model } = chatModelToPiModel(modelConfig);
  const session = await withAbort(opts?.signal, () => requireSession());
  const context: Context = {
    systemPrompt,
    messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
  };
  const apiKey = (await withAbort(opts?.signal, () => requireSession(session))).token;
  const reasoning = await withAbort(opts?.signal, () => loadReasoningSettings(modelConfig.id));
  const result = await withAbort(opts?.signal, () =>
    completeSimple(
      model,
      context,
      withReasoningSettings(model.api, reasoning, {
        maxTokens: opts?.maxTokens,
        apiKey,
        signal: opts?.signal,
      }),
    ),
  );
  if (result.stopReason === 'error')
    void confirmSessionAfterModelError(model.baseUrl, session.token);
  return result.content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
};
