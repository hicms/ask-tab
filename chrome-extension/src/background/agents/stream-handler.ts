import { buildHeadlessSystemPrompt, runAgent } from './agent-setup';
import { chatMessagesToPiMessages, makeConvertToLlm } from './message-adapter';
import {
  createModelCheckpoint,
  interruptedHistoryAsContext,
  loadModelHistory,
  modelSourceKey,
} from './model-transcript';
import { createTransformContext } from '../context/transform';
import { createLogger } from '../logging/logger-buffer';
import { runMemoryFlushIfNeeded } from '../memory/memory-flush';
import { markInterruptedToolCalls } from '@extension/shared';
import { activeAgentStorage, saveArtifact } from '@extension/storage';
import type { chatModelToPiModel } from './model-adapter';
import type {
  ChatMessage,
  LLMRequestMessage,
  LLMStreamChunk,
  LLMStreamEnd,
  LLMStepFinish,
  LLMStreamRetry,
  LLMTtsAudio,
  LLMStreamSnapshot,
  StreamingStatus,
} from '@extension/shared';
import type { DbArtifact } from '@extension/storage';
import type { AssistantMessage } from '@mariozechner/pi-ai';

const streamLog = createLogger('stream');
type StreamTarget = Pick<chrome.runtime.Port, 'postMessage'>;

/** Post a message to the port, returning false if the port is disconnected. */
const safeSend = (port: StreamTarget, msg: Record<string, unknown>): boolean => {
  try {
    port.postMessage(msg);
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes('disconnected port')) {
      return false;
    }
    throw err;
  }
};

const sendChunk = (port: StreamTarget, chunk: Omit<LLMStreamChunk, 'type'>): boolean =>
  safeSend(port, { type: 'LLM_STREAM_CHUNK', ...chunk });

const sendEnd = (port: StreamTarget, end: Omit<LLMStreamEnd, 'type'>): boolean =>
  safeSend(port, { type: 'LLM_STREAM_END', ...end });

const sendStepFinish = (port: StreamTarget, step: Omit<LLMStepFinish, 'type'>): boolean =>
  safeSend(port, { type: 'LLM_STEP_FINISH', ...step });

const sendError = (port: StreamTarget, chatId: string, error: string): boolean =>
  safeSend(port, { type: 'LLM_STREAM_ERROR', chatId, error, persistedByBackground: true });

/** Non-blocking TTS synthesis for browser chat UI auto-play. */
const maybeSendTtsAudio = async (
  port: StreamTarget,
  chatId: string,
  responseText: string,
  modelConfig: Parameters<typeof chatModelToPiModel>[0],
): Promise<void> => {
  try {
    const { ttsConfigStorage } = await import('@extension/storage');
    const ttsConfig = await ttsConfigStorage.get();
    if (ttsConfig.engine === 'off' || !ttsConfig.chatUiAutoPlay) return;

    const { maybeApplyTts } = await import('../tts');
    const { arrayBufferToBase64 } = await import('../tts/audio-encoding');

    const result = await maybeApplyTts({
      text: responseText,
      config: ttsConfig,
      inboundHadAudio: false,
      modelConfig,
    });
    if (!result) return;

    const audio: LLMTtsAudio = {
      type: 'LLM_TTS_AUDIO',
      chatId,
      audioBase64: arrayBufferToBase64(result.audio),
      contentType: result.contentType,
      provider: result.provider,
      chunkIndex: 0,
      isLastChunk: false,
    };
    port.postMessage(audio);
    const sentinel: LLMTtsAudio = {
      type: 'LLM_TTS_AUDIO',
      chatId,
      audioBase64: '',
      contentType: '',
      provider: '',
      isLastChunk: true,
    };
    port.postMessage(sentinel);
  } catch {
    // TTS failure is non-fatal — text response already delivered
  }
};

const runLLMStream = async (
  port: StreamTarget,
  request: LLMRequestMessage,
  controller: AbortController,
  assistantMessage: ChatMessage,
): Promise<void> => {
  const { chatId, messages, model: modelConfig, assistantMessageId } = request;
  const assistantParts = assistantMessage.parts;
  let turnPartStart = 0;
  let agentErrorMessage: string | undefined;

  streamLog.info('Stream started', { chatId, model: modelConfig.id });
  streamLog.trace('Stream request detail', {
    chatId,
    modelId: modelConfig.id,
    provider: modelConfig.provider,
    messageCount: messages.length,
  });

  try {
    const sourceKey = modelSourceKey(modelConfig);
    const history = await loadModelHistory(chatId, messages, modelConfig);
    if (controller.signal.aborted) return;
    const prompt = chatMessagesToPiMessages(messages.slice(-1))[0];

    if (!prompt) {
      sendError(port, chatId, 'No messages to send');
      return;
    }

    // Compaction pipeline (UI-specific)
    let currentAgentId: string | undefined;
    try {
      const id = await activeAgentStorage.get();
      currentAgentId = id || undefined;
    } catch {
      // activeAgentStorage may not be available in test context
    }

    // Build a fresh system prompt from workspace files/skills/tools each turn
    // so that writes to MEMORY.md (or any workspace file) are reflected immediately.
    const freshSystemPrompt = await buildHeadlessSystemPrompt(modelConfig, currentAgentId);
    if (controller.signal.aborted) return;
    const freshSystemPromptTokens = Math.ceil(freshSystemPrompt.length / 4);
    streamLog.trace('Fresh system prompt built', {
      chatId,
      systemPromptLength: freshSystemPrompt.length,
      systemPromptTokens: freshSystemPromptTokens,
      agentId: currentAgentId,
    });

    const {
      transformContext,
      getResult: getCompactionResult,
      setProviderLimit,
    } = createTransformContext({
      chatId,
      modelConfig,
      systemPromptTokens: freshSystemPromptTokens,
      agentId: currentAgentId,
    });

    // Wrap transformContext to notify UI when compaction starts
    let compactionNotified = false;
    const notifyingTransformContext: typeof transformContext = async (msgs, signal) => {
      if (!compactionNotified) {
        compactionNotified = true;
        safeSend(port, {
          type: 'LLM_STREAM_RETRY',
          chatId,
          attempt: 0,
          maxAttempts: 1,
          reason: 'Compacting conversation context...',
          strategy: 'compaction',
        } satisfies LLMStreamRetry);
      }
      return transformContext(msgs, signal);
    };

    // Pre-turn memory flush agent-based
    await runMemoryFlushIfNeeded({
      signal: controller.signal,
      chatId,
      modelConfig,
      systemPrompt: freshSystemPrompt,
      systemPromptTokens: freshSystemPromptTokens,
    });
    if (controller.signal.aborted) return;

    // Track per-step usage for UI and TTS
    let accInputTokens = 0;
    let accOutputTokens = 0;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let lastResponseText = '';
    let ttsEndPromise: Promise<void> | undefined;
    let endPayload: Omit<LLMStreamEnd, 'type'> | undefined;

    const runResult = await runAgent({
      signal: controller.signal,
      model: modelConfig,
      systemPrompt: freshSystemPrompt,
      prompt,
      messages: history,
      onCheckpoint: createModelCheckpoint(chatId, sourceKey),
      convertToLlm: makeConvertToLlm(),
      transformContext: notifyingTransformContext,
      chatId,
      onProviderLimitDetected: setProviderLimit,
      onRetry: info => {
        // Reset accumulated parts on retry — the stream restarts fresh
        assistantParts.length = 0;
        turnPartStart = 0;
        safeSend(port, {
          type: 'LLM_STREAM_RETRY',
          chatId,
          attempt: info.attempt,
          maxAttempts: info.maxAttempts,
          reason: info.reason,
          strategy: info.strategy,
        });
      },
      onTextDelta: delta => {
        // Accumulate text part (merge contiguous text deltas)
        const last = assistantParts[assistantParts.length - 1];
        if (last && last.type === 'text') {
          (last as { type: 'text'; text: string }).text += delta;
        } else {
          assistantParts.push({ type: 'text', text: delta });
        }
        sendChunk(port, { chatId, delta });
      },
      onReasoningDelta: delta => {
        // Accumulate reasoning part (merge contiguous reasoning deltas)
        const last = assistantParts[assistantParts.length - 1];
        if (last && last.type === 'reasoning') {
          (last as { type: 'reasoning'; text: string }).text += delta;
        } else {
          assistantParts.push({ type: 'reasoning', text: delta });
        }
        sendChunk(port, { chatId, reasoning: delta });
      },
      onToolCallEnd: tc => {
        streamLog.info('Tool call', { toolName: tc.name, toolCallId: tc.id });
        assistantParts.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
          state: 'input-available',
        });
        sendChunk(port, { chatId, toolCall: tc, state: 'input-available' });
      },
      onToolResult: tr => {
        // Save document artifacts to IndexedDB
        if (!tr.isError && tr.details && tr.toolName === 'create_document') {
          const d = tr.details as { id: string; title?: string; kind?: string; content?: string };
          if (d.id && d.content) {
            const now = Date.now();
            saveArtifact({
              id: d.id,
              chatId,
              title: d.title ?? 'Untitled',
              kind: (d.kind ?? 'text') as DbArtifact['kind'],
              content: d.content,
              createdAt: now,
              updatedAt: now,
            }).catch(() => {}); // non-blocking
          }
        }
        // Accumulate: update matching tool-call part with result
        const tcPart = assistantParts.find(
          p => p.type === 'tool-call' && p.toolCallId === tr.toolCallId,
        );
        if (tcPart && tcPart.type === 'tool-call') {
          (tcPart as { result?: unknown; state?: string }).result = tr.result;
          (tcPart as { state?: string }).state = tr.isError ? 'output-error' : 'output-available';
        }
        // Append image file parts from tool result (e.g. screenshots)
        if (tr.images?.length) {
          for (let i = 0; i < tr.images.length; i++) {
            assistantParts.push({
              type: 'file',
              url: '',
              filename: `tool-image-${tr.toolCallId}-${i}.jpg`,
              mediaType: tr.images[i].mimeType,
              data: tr.images[i].data,
            });
          }
        }

        sendChunk(port, {
          chatId,
          toolResult: {
            id: tr.toolCallId,
            result: tr.result,
            files: tr.images?.map((img, i) => ({
              data: img.data,
              mimeType: img.mimeType,
              filename: `tool-image-${tr.toolCallId}-${i}.jpg`,
            })),
          },
          state: tr.isError ? 'output-error' : 'output-available',
        });
      },
      onTurnEnd: info => {
        const msg = info.message;
        if (msg.role === 'assistant') {
          const assistantMsg = msg as AssistantMessage;
          // Attach thinkingSignature to accumulated reasoning parts
          let reasoningIdx = turnPartStart;
          for (const c of assistantMsg.content) {
            if (c.type === 'thinking' && c.thinkingSignature) {
              while (reasoningIdx < assistantParts.length) {
                const part = assistantParts[reasoningIdx];
                if (part.type === 'reasoning') {
                  (part as { signature?: string }).signature = c.thinkingSignature;
                  reasoningIdx++;
                  break;
                }
                reasoningIdx++;
              }
            }
          }
          if (assistantMsg.usage) {
            lastInputTokens = assistantMsg.usage.input;
            lastOutputTokens = assistantMsg.usage.output;
          }
          for (const c of assistantMsg.content) {
            if (c.type === 'text' && c.text) lastResponseText = c.text;
          }
        }
        turnPartStart = assistantParts.length;
        accInputTokens = info.usage.input;
        accOutputTokens = info.usage.output;

        sendStepFinish(port, {
          chatId,
          stepNumber: info.stepCount,
          usage: {
            promptTokens: lastInputTokens,
            completionTokens: lastOutputTokens,
            totalTokens: lastInputTokens + lastOutputTokens,
          },
        });
      },
      onAgentEnd: info => {
        if (controller.signal.aborted) return;
        const agentError = info.agent.state.error;
        // Timeout is a graceful end, not an error — fall through to normal completion
        if (agentError && !info.timedOut) {
          streamLog.warn('Agent error', { chatId, error: agentError, steps: info.stepCount });
          agentErrorMessage = agentError;
          return;
        }

        // Derive finishReason from last assistant message's stopReason
        const lastAssistant = info.messages
          .filter((m): m is AssistantMessage => m.role === 'assistant')
          .pop();
        let finishReason = 'stop';
        if (info.timedOut) finishReason = 'timeout';
        else if (lastAssistant?.stopReason === 'length') finishReason = 'length';

        const compactionResult = getCompactionResult();
        streamLog.info('Stream complete', {
          chatId,
          steps: info.stepCount,
          finishReason,
          timedOut: info.timedOut,
        });
        streamLog.trace('Stream end detail', {
          chatId,
          accUsage: { input: accInputTokens, output: accOutputTokens },
          lastStepUsage: { input: lastInputTokens, output: lastOutputTokens },
          compaction: compactionResult,
          responseTextLength: lastResponseText.length,
        });

        // Keep the port open until TTS and the durable model turn have completed.
        endPayload = {
          chatId,
          finishReason,
          usage: {
            promptTokens: accInputTokens,
            completionTokens: accOutputTokens,
            totalTokens: accInputTokens + accOutputTokens,
          },
          contextUsage: {
            promptTokens: lastInputTokens,
            completionTokens: lastOutputTokens,
            totalTokens: lastInputTokens + lastOutputTokens,
          },
          wasCompacted: compactionResult.wasCompacted,
          compactionMethod: compactionResult.compactionMethod as
            | 'summary'
            | 'sliding-window'
            | 'none'
            | undefined,
          compactionTokensBefore: compactionResult.tokensBefore,
          compactionTokensAfter: compactionResult.tokensAfter,
          compactionDurationMs: compactionResult.durationMs,
          persistedByBackground: true,
        };

        if (lastResponseText) {
          ttsEndPromise = maybeSendTtsAudio(port, chatId, lastResponseText, modelConfig);
        }
      },
    });

    // The completion event must follow the durable model/UI commit.
    if (ttsEndPromise) await ttsEndPromise;

    // Persist the assistant message from the background SW so it survives
    // agent switches / extension reloads that may kill the frontend callback chain.
    if (assistantMessageId) {
      const { addMessage, finishModelTurn, touchChat, updateSessionTokens } = await import(
        '@extension/storage'
      );
      if (controller.signal.aborted)
        assistantMessage.parts = markInterruptedToolCalls(assistantParts);
      if (controller.signal.aborted) {
        await finishModelTurn(
          assistantMessage,
          sourceKey,
          interruptedHistoryAsContext(runResult.agent.state.messages),
        );
      } else if (runResult.error) await addMessage(assistantMessage);
      else await finishModelTurn(assistantMessage, sourceKey, runResult.agent.state.messages);
      await touchChat(chatId);
      if (endPayload?.usage) await updateSessionTokens(chatId, endPayload.usage);
    }
    if (agentErrorMessage) sendError(port, chatId, agentErrorMessage);
    if (endPayload) sendEnd(port, endPayload);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (!controller.signal.aborted) {
      streamLog.error('Stream error', { chatId, error: errorMsg });
    }

    // Persist partial assistant message on error so it's not lost on reload
    if (assistantParts.length > 0 && assistantMessageId) {
      try {
        const { addMessage, touchChat } = await import('@extension/storage');
        await addMessage({
          id: assistantMessageId,
          chatId,
          role: 'assistant',
          parts: controller.signal.aborted
            ? markInterruptedToolCalls(assistantParts)
            : assistantParts,
          createdAt: Date.now(),
          model: modelConfig.id,
        });
        await touchChat(chatId);
      } catch {
        // Best-effort — already in error path
      }
    }
    if (!controller.signal.aborted) sendError(port, chatId, errorMsg);
  }
};

// A replacement request waits for the stopped turn's cleanup and durable writes.
// Otherwise an old checkpoint can overwrite the new turn after Stop → Send.
interface ActiveStream {
  controller: AbortController;
  done: Promise<void>;
  request: LLMRequestMessage;
  assistantMessage: ChatMessage;
  status: StreamingStatus;
}

const activeStreams = new Map<string, ActiveStream>();
const subscribers = new Map<chrome.runtime.Port, string>();
const pendingSnapshots = new WeakMap<chrome.runtime.Port, object>();
const watchers = new Set<chrome.runtime.Port>();

const attachStreamPort = (port: chrome.runtime.Port, chatId: string) => {
  if (!subscribers.has(port)) {
    port.onDisconnect.addListener(() => subscribers.delete(port));
  }
  subscribers.set(port, chatId);
};

const broadcast = (chatId: string, message: Record<string, unknown>) => {
  for (const [port, subscribedChatId] of subscribers) {
    if (subscribedChatId !== chatId) continue;
    pendingSnapshots.delete(port);
    if (!safeSend(port, message)) subscribers.delete(port);
  }
};

const notifyRunningChats = () => {
  const chatIds = [...activeStreams]
    .filter(
      ([, stream]) =>
        !stream.controller.signal.aborted &&
        (stream.status === 'connecting' || stream.status === 'streaming'),
    )
    .map(([chatId]) => chatId);
  for (const port of watchers) {
    if (!safeSend(port, { type: 'LLM_RUNNING_CHATS', chatIds })) watchers.delete(port);
  }
};

const streamSnapshot = (stream: ActiveStream): LLMStreamSnapshot => ({
  type: 'LLM_STREAM_SNAPSHOT',
  chatId: stream.request.chatId,
  messages: [
    ...stream.request.messages,
    stream.controller.signal.aborted
      ? {
          ...stream.assistantMessage,
          parts: markInterruptedToolCalls(stream.assistantMessage.parts),
        }
      : stream.assistantMessage,
  ],
  status: stream.controller.signal.aborted ? 'idle' : stream.status,
  assistantMessageId: stream.assistantMessage.id,
});

/** Detaching a view only removes a subscriber; it never cancels the turn. */
const subscribeLLMStream = async (port: chrome.runtime.Port, chatId: string): Promise<void> => {
  attachStreamPort(port, chatId);
  const active = activeStreams.get(chatId);
  if (active) {
    safeSend(port, { ...streamSnapshot(active) });
    return;
  }
  // The turn may have completed between the page's database read and subscription.
  const token = {};
  pendingSnapshots.set(port, token);
  const { getMessagesByChatId } = await import('@extension/storage');
  const messages = await getMessagesByChatId(chatId);
  if (
    subscribers.get(port) !== chatId ||
    pendingSnapshots.get(port) !== token ||
    activeStreams.has(chatId)
  )
    return;
  pendingSnapshots.delete(port);
  safeSend(port, { type: 'LLM_STREAM_SNAPSHOT', chatId, messages, status: 'idle' });
};

const watchLLMStreams = (port: chrome.runtime.Port) => {
  watchers.add(port);
  port.onDisconnect.addListener(() => watchers.delete(port));
  notifyRunningChats();
};

const stopLLMStream = (chatId: string, assistantMessageId?: string) => {
  const active = activeStreams.get(chatId);
  // A late Stop from an old view must not cancel a newer turn.
  if (!active || (assistantMessageId && active.assistantMessage.id !== assistantMessageId)) return;
  active.controller.abort();
  broadcast(chatId, { type: 'LLM_STREAM_STOPPED', chatId });
  notifyRunningChats();
};

const handleLLMStream = async (
  port: chrome.runtime.Port,
  request: LLMRequestMessage,
): Promise<void> => {
  const previous = activeStreams.get(request.chatId);
  attachStreamPort(port, request.chatId);
  // Another view of the same chat joins the existing turn instead of interrupting it.
  if (previous && !previous.controller.signal.aborted) {
    safeSend(port, { ...streamSnapshot(previous) });
    await previous.done;
    return;
  }
  const controller = new AbortController();
  let finish!: () => void;
  const active: ActiveStream = {
    controller,
    request,
    assistantMessage: {
      id: request.assistantMessageId ?? crypto.randomUUID(),
      chatId: request.chatId,
      role: 'assistant',
      parts: [],
      createdAt: Date.now(),
      model: request.model.id,
    },
    status: 'connecting',
    done: new Promise<void>(resolve => {
      finish = resolve;
    }),
  };
  activeStreams.set(request.chatId, active);
  broadcast(request.chatId, { ...streamSnapshot(active) });
  notifyRunningChats();
  const target: StreamTarget = {
    postMessage(message: Record<string, unknown>) {
      if (controller.signal.aborted) return;
      if (message.type === 'LLM_STREAM_CHUNK') active.status = 'streaming';
      if (message.type === 'LLM_STREAM_END' || message.type === 'LLM_STREAM_ERROR') {
        active.status = message.type === 'LLM_STREAM_END' ? 'idle' : 'error';
        notifyRunningChats();
      }
      broadcast(request.chatId, message);
    },
  };
  try {
    await previous?.done;
    if (!controller.signal.aborted)
      await runLLMStream(target, request, controller, active.assistantMessage);
  } finally {
    if (activeStreams.get(request.chatId) === active) activeStreams.delete(request.chatId);
    notifyRunningChats();
    finish();
  }
};

export { handleLLMStream, subscribeLLMStream, watchLLMStreams, stopLLMStream };
