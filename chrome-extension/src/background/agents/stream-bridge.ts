/**
 * StreamFn bridge: uses pi-ai's native streamSimple() to produce
 * AssistantMessageEventStream compatible with pi-agent's agent loop.
 *
 * streamSimple() natively handles provider routing, message conversion,
 * tool definitions, and event emission — no manual bridging needed.
 */

import { withAbort } from './cancellation';
import { chatModelToPiModel } from './model-adapter';
import { confirmSessionAfterModelError, requireSession } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { completeSimple, streamSimple } from '@mariozechner/pi-ai';
import type { ChatModel } from '@extension/shared';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import type { Api, Context, Model, SimpleStreamOptions, TextContent } from '@mariozechner/pi-ai';

const bridgeLog = createLogger('stream');

/**
 * Create a StreamFn using pi-mono's native streaming.
 * streamSimple() already returns AssistantMessageEventStream.
 */
export const createStreamFn = (modelConfig: ChatModel): StreamFn => {
  const { model } = chatModelToPiModel(modelConfig);

  return (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    bridgeLog.trace('Provider call', {
      modelId: model.id,
      provider: model.provider,
      api: model.api,
      baseUrl: model.baseUrl,
      hasApiKey: !!options?.apiKey,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    });
    const stream = streamSimple(model, context, options);
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
  const { model } = chatModelToPiModel(modelConfig);
  const session = await withAbort(opts?.signal, () => requireSession());
  const context: Context = {
    systemPrompt,
    messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
  };
  const apiKey = (await withAbort(opts?.signal, () => requireSession(session))).token;
  const result = await withAbort(opts?.signal, () =>
    completeSimple(model, context, {
      maxTokens: opts?.maxTokens,
      apiKey,
      signal: opts?.signal,
    }),
  );
  if (result.stopReason === 'error')
    void confirmSessionAfterModelError(model.baseUrl, session.token);
  return result.content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
};
