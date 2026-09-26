// ── Unified Agent lifecycle ────────────
// Single-entry-point runAgent() with callbacks for site-specific behavior.
// Includes automatic retry with compaction on context overflow errors.
// Also re-exports headless LLM helpers (dbModelToChatModel, resolveDefaultModel, runHeadlessLLM).

import { Agent } from './agent';
import { makeConvertToLlm } from './message-adapter';
import { chatModelToPiModel } from './model-adapter';
import { createModelCheckpoint, modelSourceKey } from './model-transcript';
import { createStreamFn } from './stream-bridge';
import { requireSession, watchSession } from '../ask-service/client';
import { setProviderTokenLimit } from '../context/provider-limit-cache';
import { hasOversizedToolResults, truncateToolResults } from '../context/tool-result-truncation';
import { createTransformContext } from '../context/transform';
import {
  classifyError,
  isCompactionFailureError,
  parseProviderTokenLimit,
} from '../errors/error-classification';
import { createLogger } from '../logging/logger-buffer';
import { getAgentTools, getToolConfig, getImplementedToolNames } from '../tools';
import { beginAgentTabGroup, endAgentTabGroup } from '../tools/agent-tab-group';
import { IS_FIREFOX } from '@extension/env';
import { buildSystemPrompt, resolveToolPromptHints, resolveToolListings } from '@extension/shared';
import {
  serverModelsStorage,
  selectedModelStorage,
  getAgent,
  getEnabledWorkspaceFiles,
  getEnabledSkills,
  createChat,
  addMessage,
  finishModelTurn,
  touchChat,
  updateSessionTokens,
} from '@extension/storage';
import { nanoid } from 'nanoid';
import type { ErrorCategory } from '../errors/error-classification';
import type { ChatModel, ChatMessagePart, ModelProvider } from '@extension/shared';
import type { DbChatModel, DbChat, AskSession } from '@extension/storage';
import type { AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, ImageContent, Message, TextContent } from '@mariozechner/pi-ai';

const agentLog = createLogger('agent');

const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_RETRY_ATTEMPTS = 3;

// ── Shared runAgent lifecycle ────────────

interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  reason: string;
  strategy: 'compaction' | 'truncate-tool-results';
}

interface RunAgentResult {
  responseText: string;
  parts: ChatMessagePart[];
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
  /** The Agent instance — callers may inspect agent.state or last messages */
  agent: Agent;
  /** Final step count */
  stepCount: number;
  /** Whether the agent was stopped by the wall-clock timeout */
  timedOut: boolean;
  /** Number of retry attempts used (0 = first attempt succeeded) */
  retryAttempts: number;
  /** Error category if the final result has an error */
  errorCategory?: ErrorCategory;
}

interface RunAgentOpts {
  // Required
  model: ChatModel;
  systemPrompt: string;
  prompt: AgentMessage | string;

  // Optional agent config
  messages?: AgentMessage[];
  convertToLlm?: (msgs: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (msgs: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  onCheckpoint?: (messages: AgentMessage[]) => Promise<void>;
  headlessTools?: boolean;
  /** Pre-built tool list. When provided, skips the internal getAgentTools() call. */
  tools?: Awaited<ReturnType<typeof getAgentTools>>;
  signal?: AbortSignal;
  chatId?: string;

  // Retry callback (optional — UI can wire to show retry notifications)
  onRetry?: (info: RetryInfo) => void;
  /** Called when the provider reports a lower token limit than the model's contextWindow. */
  onProviderLimitDetected?: (limit: number) => void;

  // Event callbacks (all optional — headless uses none)
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onToolCallEnd?: (toolCall: { id: string; name: string; args: Record<string, unknown> }) => void;
  onToolResult?: (result: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
    details?: unknown;
    /** Image content blocks from the tool result (e.g. screenshots) */
    images?: Array<{ data: string; mimeType: string }>;
  }) => void;
  onTurnEnd?: (info: {
    stepCount: number;
    usage: { input: number; output: number };
    message: AgentMessage;
  }) => void;
  onAgentEnd?: (info: {
    agent: Agent;
    messages: AgentMessage[];
    stepCount: number;
    timedOut: boolean;
  }) => void;
}

/**
 * Extract text from tool result content, parsing JSON if possible.
 */
const extractToolResultValue = (
  result: { content?: Array<{ type: string; text?: string }> } | undefined,
): unknown => {
  const textParts =
    result?.content?.filter((c): c is TextContent => c.type === 'text').map(c => c.text) ?? [];
  if (textParts.length === 0) return result;
  const text = textParts.join('');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Try to extract human-readable text from a tool result string.
 *  Many tools return JSON with a `report`, `output`, or `text` field — prefer those
 *  over raw JSON. Falls back to the raw string. */
const extractResponseFromToolResult = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of ['report', 'output', 'text', 'content', 'result']) {
        if (typeof parsed[key] === 'string' && parsed[key].length > 0) {
          return parsed[key];
        }
      }
    }
  } catch {
    // Not JSON — use raw string directly
  }
  return raw;
};

/**
 * Execute a single agent attempt. Creates a fresh Agent, subscribes to events,
 * runs the prompt, and returns the result. Isolated to prevent state leakage
 * across retry attempts.
 */
const executeAttempt = async (opts: {
  piModel: ReturnType<typeof chatModelToPiModel>['model'];
  streamFn: ReturnType<typeof createStreamFn>;
  tools: Awaited<ReturnType<typeof getAgentTools>>;
  timeoutMs: number;
  model: ChatModel;
  sessionSnapshot?: AskSession;
  systemPrompt: string;
  prompt: AgentMessage | string;
  messages: AgentMessage[];
  convertToLlm?: RunAgentOpts['convertToLlm'];
  transformContext?: RunAgentOpts['transformContext'];
  onCheckpoint?: RunAgentOpts['onCheckpoint'];
  signal?: AbortSignal;
  onTextDelta?: RunAgentOpts['onTextDelta'];
  onReasoningDelta?: RunAgentOpts['onReasoningDelta'];
  onToolCallEnd?: RunAgentOpts['onToolCallEnd'];
  onToolResult?: RunAgentOpts['onToolResult'];
  onTurnEnd?: RunAgentOpts['onTurnEnd'];
  onAgentEnd?: RunAgentOpts['onAgentEnd'];
}): Promise<RunAgentResult> => {
  const {
    piModel,
    streamFn,
    tools,
    timeoutMs,
    model,
    sessionSnapshot,
    systemPrompt,
    prompt,
    messages,
    convertToLlm,
    transformContext,
    onCheckpoint,
    signal,
    onTextDelta,
    onReasoningDelta,
    onToolCallEnd,
    onToolResult,
    onTurnEnd,
    onAgentEnd,
  } = opts;

  // Create fresh Agent for this attempt
  const agentOpts: ConstructorParameters<typeof Agent>[0] = {
    initialState: {
      systemPrompt,
      model: piModel,
      tools,
      messages,
    },
    streamFn,
    getApiKey: async () => (await requireSession(sessionSnapshot)).token,
  };
  if (convertToLlm) agentOpts.convertToLlm = convertToLlm;
  if (transformContext) agentOpts.transformContext = transformContext;
  if (onCheckpoint) agentOpts.onCheckpoint = onCheckpoint;

  const agent = new Agent(agentOpts);

  // Tracking state
  const allAssistantParts: ChatMessagePart[] = [];
  let accInputTokens = 0;
  let accOutputTokens = 0;
  let lastStepText = '';
  let stepCount = 0;
  let timedOut = false;

  // Subscribe to events
  agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'message_update': {
        const evt = event.assistantMessageEvent;
        if (evt.type === 'text_delta') onTextDelta?.(evt.delta);
        if (evt.type === 'thinking_delta') onReasoningDelta?.(evt.delta);
        if (evt.type === 'toolcall_end') {
          onToolCallEnd?.({
            id: evt.toolCall.id,
            name: evt.toolCall.name,
            args: evt.toolCall.arguments as Record<string, unknown>,
          });
        }
        break;
      }

      case 'message_end': {
        if (event.message.role === 'assistant') {
          const msg = event.message as AssistantMessage;
          for (const c of msg.content) {
            if (c.type === 'text' && c.text) {
              allAssistantParts.push({ type: 'text', text: c.text });
              lastStepText = c.text;
            } else if (c.type === 'thinking') {
              allAssistantParts.push({
                type: 'reasoning',
                text: c.thinking,
                ...(c.thinkingSignature ? { signature: c.thinkingSignature } : {}),
              });
            } else if (c.type === 'toolCall') {
              allAssistantParts.push({
                type: 'tool-call',
                toolCallId: c.id,
                toolName: c.name,
                args: c.arguments,
                state: 'output-available',
              });
            }
          }
        }
        break;
      }

      case 'tool_execution_end': {
        const resultValue = extractToolResultValue(event.result);
        allAssistantParts.push({
          type: 'tool-result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: resultValue,
          state: event.isError ? 'output-error' : 'output-available',
        });

        // Extract image content blocks from the tool result (e.g. screenshots)
        const imageBlocks = (
          (event.result as { content?: Array<{ type: string }> } | undefined)?.content ?? []
        ).filter((c): c is ImageContent => c.type === 'image');

        // Persist image blocks as file parts (for IndexedDB storage + UI rendering)
        for (let i = 0; i < imageBlocks.length; i++) {
          allAssistantParts.push({
            type: 'file',
            url: '',
            filename: `tool-image-${event.toolCallId}-${i}.jpg`,
            mediaType: imageBlocks[i]!.mimeType,
            data: imageBlocks[i]!.data,
          });
        }

        onToolResult?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: resultValue,
          isError: event.isError,
          details: (event.result as { details?: unknown } | undefined)?.details,
          images:
            imageBlocks.length > 0
              ? imageBlocks.map(img => ({ data: img.data, mimeType: img.mimeType }))
              : undefined,
        });
        break;
      }

      case 'turn_end': {
        if (event.message.role === 'assistant') {
          const msg = event.message as AssistantMessage;
          if (msg.usage) {
            accInputTokens += msg.usage.input;
            accOutputTokens += msg.usage.output;
          }
        }
        stepCount++;

        onTurnEnd?.({
          stepCount,
          usage: { input: accInputTokens, output: accOutputTokens },
          message: event.message,
        });
        break;
      }

      case 'agent_end': {
        onAgentEnd?.({
          agent,
          messages: event.messages,
          stepCount,
          timedOut,
        });
        break;
      }
    }
  });

  // Wire abort: combine external signal + wall-clock timeout
  const internalController = new AbortController();
  const abortAttempt = () => internalController.abort();

  if (signal) {
    if (signal.aborted) {
      internalController.abort();
    } else {
      signal.addEventListener('abort', abortAttempt, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    agentLog.warn('Agent timeout', { timeoutMs });
    internalController.abort();
  }, timeoutMs);
  agentLog.trace('Agent timeout set', { timeoutMs });

  internalController.signal.addEventListener(
    'abort',
    () => {
      agentLog.trace('Agent abort signal fired', { timedOut });
      agent.abort();
    },
    { once: true },
  );

  // Run the agent
  agentLog.trace('Agent prompt starting', {
    modelId: model.id,
    toolCount: tools.length,
    hasSignal: !!signal,
  });
  try {
    internalController.signal.throwIfAborted();
    if (typeof prompt === 'string') {
      await agent.prompt(prompt);
    } else {
      await agent.prompt(prompt);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortAttempt);
  }
  agentLog.trace('Agent prompt completed', { stepCount, timedOut });

  // Build result — fall back to tool result content when the LLM produced no text
  let responseText = lastStepText;

  if (!responseText) {
    const toolResultParts = allAssistantParts.filter(
      (p): p is Extract<ChatMessagePart, { type: 'tool-result' }> =>
        p.type === 'tool-result' && 'result' in p && p.result != null,
    );
    if (toolResultParts.length > 0) {
      const lastResult = toolResultParts[toolResultParts.length - 1];
      const raw =
        typeof lastResult.result === 'string'
          ? lastResult.result
          : JSON.stringify(lastResult.result);
      responseText = extractResponseFromToolResult(raw);
    }
  }

  responseText = responseText || '(No response generated)';
  let error = agent.state.error;

  // If timed out, treat as graceful end (not error)
  if (timedOut && error) {
    error = undefined;
  }

  return {
    responseText,
    parts: allAssistantParts,
    usage: { inputTokens: accInputTokens, outputTokens: accOutputTokens },
    error,
    agent,
    stepCount,
    timedOut,
    retryAttempts: 0, // caller updates this
  };
};

const runAgent = async (opts: RunAgentOpts): Promise<RunAgentResult> => {
  const {
    model,
    systemPrompt,
    prompt,
    messages: history = [],
    convertToLlm,
    transformContext,
    onCheckpoint,
    headlessTools = false,
    tools: toolsOverride,
    signal,
    chatId,
    onRetry,
    onTextDelta,
    onReasoningDelta,
    onToolCallEnd,
    onToolResult,
    onTurnEnd,
    onAgentEnd,
  } = opts;

  // 1. Build pi-mono primitives (shared across attempts)
  const sessionSnapshot = await requireSession();
  const { model: piModel } = chatModelToPiModel(model);
  const streamFn = createStreamFn(model);
  const tools =
    toolsOverride ??
    (model.supportsTools !== false ? await getAgentTools({ headless: headlessTools, chatId }) : []);

  const timeoutMs = (model.toolTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

  const operationController = new AbortController();
  const abortOperation = () => operationController.abort();
  if (signal?.aborted) abortOperation();
  else signal?.addEventListener('abort', abortOperation, { once: true });
  const stopWatchingSession = sessionSnapshot
    ? watchSession(sessionSnapshot, abortOperation)
    : () => {};

  // 2. Retry loop — up to MAX_RETRY_ATTEMPTS retries on context overflow
  let currentMessages = history;
  let lastResult: RunAgentResult | undefined;

  try {
    await beginAgentTabGroup(chatId, prompt);
    for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      // Check abort before each attempt
      if (operationController.signal.aborted) {
        return (
          lastResult ?? {
            responseText: '(Request was aborted)',
            parts: [],
            usage: { inputTokens: 0, outputTokens: 0 },
            error: 'Request was aborted',
            agent: new Agent({
              initialState: { systemPrompt, model: piModel, tools, messages: [] },
            }),
            stepCount: 0,
            timedOut: false,
            retryAttempts: attempt,
            errorCategory: 'unknown',
          }
        );
      }

      const result = await executeAttempt({
        piModel,
        streamFn,
        tools,
        timeoutMs,
        model,
        sessionSnapshot,
        systemPrompt,
        prompt,
        messages: currentMessages,
        convertToLlm,
        transformContext,
        onCheckpoint,
        signal: operationController.signal,
        onTextDelta,
        onReasoningDelta,
        onToolCallEnd,
        onToolResult,
        onTurnEnd,
        onAgentEnd,
      });

      result.retryAttempts = attempt;

      // No error → success, return immediately
      if (!result.error) return result;

      // Classify the error
      const category = classifyError(result.error);
      result.errorCategory = category;

      // Only retry on context overflow errors
      if (category !== 'context-overflow') return result;

      // Don't retry if compaction itself failed (would loop forever)
      if (isCompactionFailureError(result.error)) return result;

      // Don't retry if we've exhausted attempts
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        result.error =
          'Context overflow: conversation too long after retries. Try starting a new chat or using a model with a larger context window.';
        return result;
      }

      // Parse actual limit from provider error (may be lower than model's native window)
      const providerLimit = parseProviderTokenLimit(result.error);
      if (providerLimit) {
        setProviderTokenLimit(model.id, providerLimit);
        opts.onProviderLimitDetected?.(providerLimit);
      }

      // Determine retry strategy
      if (hasOversizedToolResults(currentMessages, model.id, providerLimit)) {
        // Strategy: truncate oversized tool results
        const { messages: truncated, truncatedCount } = truncateToolResults(
          currentMessages,
          model.id,
          providerLimit,
        );
        currentMessages = truncated;

        agentLog.warn('Retrying after error', {
          attempt: attempt + 1,
          category,
          strategy: 'truncate-tool-results',
          error: result.error,
        });
        onRetry?.({
          attempt: attempt + 1,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          reason: `Truncated ${truncatedCount} oversized tool result(s)`,
          strategy: 'truncate-tool-results',
        });
      } else {
        // Strategy: rely on transformContext (compaction) to reduce context on next attempt
        agentLog.warn('Retrying after error', {
          attempt: attempt + 1,
          category,
          strategy: 'compaction',
          error: result.error,
        });
        onRetry?.({
          attempt: attempt + 1,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          reason: 'Context overflow — retrying with compaction',
          strategy: 'compaction',
        });
      }

      lastResult = result;
    }

    // Should not reach here, but TypeScript needs a return
    return lastResult!;
  } finally {
    stopWatchingSession();
    signal?.removeEventListener('abort', abortOperation);
    endAgentTabGroup(chatId);
  }
};

// ── Headless LLM helpers (migrated from headless-llm.ts) ────────────

const dbModelToChatModel = (m: DbChatModel): ChatModel => ({
  id: m.modelId,
  dbId: m.id,
  name: m.name,
  provider: m.provider as ModelProvider,
  description: m.description,
  supportsTools: m.supportsTools,
  supportsReasoning: m.supportsReasoning,
  toolTimeoutSeconds: m.toolTimeoutSeconds,
  contextWindow: m.contextWindow,
});

const resolveDefaultModel = async (): Promise<ChatModel | null> => {
  const models = await serverModelsStorage.get();
  if (!models || models.length === 0) return null;

  const selectedId = await selectedModelStorage.get();
  if (selectedId) {
    const selected = models.find(m => m.id === selectedId);
    if (selected) return dbModelToChatModel(selected);
  }

  return dbModelToChatModel(models[0]);
};

type HeadlessLLMResult = {
  status: 'ok' | 'error';
  chatId: string;
  responseText: string;
  error?: string;
};

const buildHeadlessSystemPrompt = async (model: ChatModel, agentId?: string): Promise<string> => {
  const workspaceFiles = await getEnabledWorkspaceFiles(agentId);
  const skills = await getEnabledSkills(agentId);
  const toolConfig = await getToolConfig();
  const agent = agentId ? await getAgent(agentId) : undefined;

  const availableTools = getImplementedToolNames();

  const promptConfig = {
    mode: 'full' as const,
    tools: resolveToolListings(toolConfig.enabledTools, agent?.customTools, availableTools),
    toolPromptHints: resolveToolPromptHints(
      toolConfig.enabledTools,
      agent?.customTools,
      availableTools,
    ),
    workspaceFiles: workspaceFiles.map(f => ({
      name: f.name,
      content: f.content,
      owner: f.owner,
    })),
    skills: skills.map(s => ({
      name: s.metadata.name,
      description: s.metadata.description,
      path: s.file.name,
    })),
    runtimeMeta: {
      modelName: model.name,
      currentDate: new Date().toISOString().split('T')[0],
      browser: IS_FIREFOX ? ('firefox' as const) : ('chrome' as const),
    },
  };

  const { text } = buildSystemPrompt(promptConfig);

  return text;
};

/**
 * Run a headless LLM conversation: create a chat, send a user message, stream the response
 * with tool execution, and save all messages to IndexedDB.
 */
const runHeadlessLLM = async (opts: {
  message: string;
  chatTitle: string;
  model?: ChatModel;
  source?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<HeadlessLLMResult> => {
  const model = opts.model ?? (await resolveDefaultModel());
  if (!model) {
    return { status: 'error', chatId: '', responseText: '', error: 'No model configured' };
  }

  // Create chat
  const chatId = nanoid();
  const now = Date.now();
  const chat: DbChat = {
    id: chatId,
    title: opts.chatTitle,
    createdAt: now,
    updatedAt: now,
    source: opts.source ?? 'cron',
    agentId: 'main',
  };
  await createChat(chat);

  // Save user message
  await addMessage({
    id: nanoid(),
    chatId,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: opts.message }],
    createdAt: now,
  });

  const systemPrompt = await buildHeadlessSystemPrompt(model);

  // Build transformContext for headless mode (previously missing — cron jobs never compacted)
  const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
  const { transformContext, setProviderLimit } = createTransformContext({
    chatId,
    modelConfig: model,
    systemPromptTokens,
  });

  try {
    const result = await runAgent({
      model,
      systemPrompt,
      prompt: opts.message,
      headlessTools: true,
      signal: opts.signal,
      convertToLlm: makeConvertToLlm(),
      transformContext,
      onCheckpoint: createModelCheckpoint(chatId, modelSourceKey(model)),
      onProviderLimitDetected: setProviderLimit,
      chatId,
    });

    if (result.error) {
      await addMessage({
        id: nanoid(),
        chatId,
        role: 'assistant',
        parts: [{ type: 'text', text: `Error: ${result.error}` }],
        createdAt: Date.now(),
        model: model.id,
      });
      await touchChat(chatId);
      return { status: 'error', chatId, responseText: '', error: result.error };
    }

    // Save assistant message
    await finishModelTurn(
      {
        id: nanoid(),
        chatId,
        role: 'assistant',
        parts: result.parts,
        createdAt: Date.now(),
        model: model.id,
      },
      modelSourceKey(model),
      result.agent.state.messages,
    );

    // Update token usage
    const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
    if (totalTokens > 0) {
      await updateSessionTokens(chatId, {
        promptTokens: result.usage.inputTokens,
        completionTokens: result.usage.outputTokens,
        totalTokens,
      });
    }

    await touchChat(chatId);
    return { status: 'ok', chatId, responseText: result.responseText };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await addMessage({
      id: nanoid(),
      chatId,
      role: 'assistant',
      parts: [{ type: 'text', text: `Error: ${errorMsg}` }],
      createdAt: Date.now(),
      model: model.id,
    });
    await touchChat(chatId);

    return { status: 'error', chatId, responseText: '', error: errorMsg };
  }
};

export {
  extractResponseFromToolResult,
  runAgent,
  dbModelToChatModel,
  resolveDefaultModel,
  buildHeadlessSystemPrompt,
  runHeadlessLLM,
};
export type { RetryInfo, RunAgentResult, RunAgentOpts, HeadlessLLMResult };
