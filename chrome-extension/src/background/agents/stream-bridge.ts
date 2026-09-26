/**
 * StreamFn bridge: uses pi-ai's native streamSimple() to produce
 * AssistantMessageEventStream compatible with pi-agent's agent loop.
 *
 * streamSimple() natively handles provider routing, message conversion,
 * tool definitions, and event emission — no manual bridging needed.
 */

import { chatModelToPiModel } from './model-adapter';
import { confirmSessionAfterModelError, requireSession } from '../ask-service/client';
import { requestLocalGeneration } from '../local-llm-bridge';
import { createLogger } from '../logging/logger-buffer';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import {
  completeSimple,
  createAssistantMessageEventStream,
  streamSimple,
} from '@mariozechner/pi-ai';
import type { ChatModel } from '@extension/shared';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  TextContent,
  ToolResultMessage,
} from '@mariozechner/pi-ai';

const bridgeLog = createLogger('stream');

/**
 * Convert pi-agent Context messages to simple {role, content} pairs.
 * Local inference needs flat text messages
 * with tool calls serialized as XML tags.
 */
const TOOL_CALL_HINT =
  '\n\n[SYSTEM HINT]: Keep in mind your available tools. To use a tool, you MUST output the EXACT XML format: <tool_call id="unique_id" name="tool_name">{"arg": "value"}</tool_call>.';

const contextToSimpleMessages = (context: Context): Array<{ role: string; content: string }> =>
  context.messages.map(m => {
    if (m.role === 'toolResult') {
      const tr = m as ToolResultMessage;
      const resultText = (tr.content ?? [])
        .filter(c => c.type === 'text')
        .map(c => (c as TextContent).text)
        .join('');
      const wrapped = `<tool_response id="${tr.toolCallId}" name="${tr.toolName}">\n${resultText}\n</tool_response>${TOOL_CALL_HINT}`;
      return { role: 'user' as const, content: wrapped };
    }
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const parts: string[] = [];
      for (const c of m.content) {
        if (c.type === 'text') parts.push((c as TextContent).text);
        else if (c.type === 'toolCall') {
          parts.push(
            `<tool_call id="${c.id}" name="${c.name}">${JSON.stringify(c.arguments)}</tool_call>`,
          );
        }
      }
      return { role: 'assistant' as const, content: parts.join('') };
    }
    return {
      role: m.role as string,
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content ?? [])
              .filter(c => c.type === 'text')
              .map(c => (c as TextContent).text)
              .join(''),
    };
  });

/** Convert pi-agent tool definitions to OpenAI function-calling schema. */
const contextToFunctionTools = (context: Context) =>
  (context.tools ?? []).map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

/** Create an error stream for non-cloud providers instead of throwing. */
const createProviderErrorStream = (
  api: string,
  provider: string,
  modelId: string,
  errorMsg: string,
) => {
  const errorStream = createAssistantMessageEventStream();
  errorStream.push({
    type: 'error',
    reason: 'error',
    error: {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api,
      provider,
      model: modelId,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'error',
      errorMessage: errorMsg,
      timestamp: Date.now(),
    },
  });
  return errorStream;
};

/**
 * Create a StreamFn using pi-mono's native streaming.
 * For cloud providers, streamSimple() already returns AssistantMessageEventStream.
 * Local models route to the offscreen document.
 */
export const createStreamFn = (modelConfig: ChatModel): StreamFn => {
  if (modelConfig.provider === 'local') {
    return (_model: Model<Api>, context: Context) => {
      try {
        const messages = contextToSimpleMessages(context);
        const tools = contextToFunctionTools(context);

        // Validate device preference — only pass recognized values
        const device =
          modelConfig.localDevice === 'webgpu' || modelConfig.localDevice === 'wasm'
            ? modelConfig.localDevice
            : undefined;

        bridgeLog.trace('Local provider call', {
          modelId: modelConfig.id,
          device,
          messageCount: messages.length,
          toolCount: tools.length,
          systemPromptLength: (context.systemPrompt ?? '').length,
        });

        return requestLocalGeneration({
          modelId: modelConfig.id,
          messages,
          systemPrompt: context.systemPrompt ?? '',
          device,
          tools: tools.length > 0 ? tools : undefined,
          supportsReasoning: modelConfig.supportsReasoning,
        });
      } catch (err) {
        diagnostics.error('[stream-bridge] Local LLM streamFn error:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        return createProviderErrorStream(
          'local-transformers',
          'local',
          modelConfig.id,
          `Local LLM error: ${errorMsg}`,
        );
      }
    };
  }

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

/**
 * Non-streaming completion helper for summarizer/journal.
 * Not supported for local models — they only support streaming via the offscreen document.
 */
export const completeText = async (
  modelConfig: ChatModel,
  systemPrompt: string,
  userContent: string,
  opts?: { maxTokens?: number },
): Promise<string> => {
  if (modelConfig.provider === 'local') {
    throw new Error(
      `completeText is not supported for ${modelConfig.provider} models. Use streaming via createStreamFn instead.`,
    );
  }

  const { model } = chatModelToPiModel(modelConfig);
  const session = await requireSession();
  const context: Context = {
    systemPrompt,
    messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
  };
  const result = await completeSimple(model, context, {
    maxTokens: opts?.maxTokens,
    apiKey: (await requireSession(session)).token,
  });
  if (result.stopReason === 'error')
    void confirmSessionAfterModelError(model.baseUrl, session.token);
  return result.content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('');
};
