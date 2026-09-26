// ──────────────────────────────────────────────
// Chat & Streaming Protocol Types
// ──────────────────────────────────────────────

/** Tool execution state — mirrors AI SDK's ToolUIPart.state */
type ToolPartState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

/** A single part of a chat message */
type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
      state?: ToolPartState;
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      result: unknown;
      state?: ToolPartState;
    }
  | {
      type: 'file';
      url: string;
      filename?: string;
      mediaType?: string;
      data?: string;
    };

/** Attachment metadata for file uploads */
interface Attachment {
  name: string;
  url: string;
  contentType: string;
}

/** A chat message */
interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  parts: ChatMessagePart[];
  createdAt: number;
  model?: string;
}

/** Metadata for channel-sourced conversations */
interface ChannelMeta {
  channelId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  extra?: Record<string, unknown>;
}

/** A chat conversation */
interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  compactionCount?: number;
  compactionSummary?: string;
  memoryFlushAt?: number;
  memoryFlushCompactionCount?: number;
  source?: string;
  channelMeta?: ChannelMeta;
}

/** Token usage for a single LLM response */
interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  wasCompacted?: boolean;
  compactionMethod?: 'summary' | 'sliding-window' | 'none';
  compactionTokensBefore?: number;
  compactionTokensAfter?: number;
  /** Last-step usage for context window display (accurate for % indicator) */
  contextUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** When true, the background SW already persisted the assistant message — frontend should skip addMessage. */
  persistedByBackground?: boolean;
}

/** Provider identifiers */
type ModelProvider = 'anthropic' | 'custom' | 'local';

/** Model configuration */
interface ChatModel {
  id: string;
  /** Unique database ID for UI selection. Different from `id` which is the model identifier sent to the provider. */
  dbId?: string;
  name: string;
  provider: ModelProvider;
  description?: string;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  localDevice?: 'webgpu' | 'wasm';
  /** Wall-clock timeout in seconds for tool-call execution (default: 300). */
  toolTimeoutSeconds?: number;
  /** Context window size in tokens. Overrides the built-in lookup when set. */
  contextWindow?: number;
}

/** Tool definition (metadata only — no execute function) */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// Streaming Protocol
// ──────────────────────────────────────────────

/** Request sent from UI -> background to start LLM streaming */
interface LLMRequestMessage {
  type: 'LLM_REQUEST';
  chatId: string;
  messages: ChatMessage[];
  model: ChatModel;
  /** ID for the assistant message so the background SW can persist it directly. */
  assistantMessageId?: string;
  tools?: Record<string, unknown>;
}

/** A chunk streamed from background -> UI */
interface LLMStreamChunk {
  type: 'LLM_STREAM_CHUNK';
  chatId: string;
  delta?: string;
  reasoning?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  toolResult?: {
    id: string;
    result: unknown;
    /** Image files from tool execution (e.g. screenshots) */
    files?: Array<{ data: string; mimeType: string; filename: string }>;
  };
  state?: ToolPartState;
}

/** End-of-stream signal */
interface LLMStreamEnd {
  type: 'LLM_STREAM_END';
  chatId: string;
  finishReason: string;
  /** Accumulated usage across all tool steps */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Last step's usage (accurate for context window % display) */
  contextUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  wasCompacted?: boolean;
  compactionMethod?: 'summary' | 'sliding-window' | 'none';
  compactionTokensBefore?: number;
  compactionTokensAfter?: number;
  compactionDurationMs?: number;
  /** When true, the background SW has already persisted the assistant message — frontend should skip its own addMessage. */
  persistedByBackground?: boolean;
}

/** Step finish signal — emitted after each tool iteration */
interface LLMStepFinish {
  type: 'LLM_STEP_FINISH';
  chatId: string;
  stepNumber: number;
  usage?: SessionUsage;
}

/** Stream error */
interface LLMStreamError {
  type: 'LLM_STREAM_ERROR';
  chatId: string;
  error: string;
}

/** Retry notification — background -> UI when retrying after context overflow */
interface LLMStreamRetry {
  type: 'LLM_STREAM_RETRY';
  chatId: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
  strategy: 'compaction' | 'truncate-tool-results';
}

/** TTS audio message — background -> UI */
interface LLMTtsAudio {
  type: 'LLM_TTS_AUDIO';
  chatId: string;
  audioBase64: string;
  contentType: string;
  provider: string;
  /** Chunk index for streamed TTS (absent = single-blob path). */
  chunkIndex?: number;
  /** True on the final chunk (sentinel: audioBase64 may be empty). */
  isLastChunk?: boolean;
}

/** Ephemeral progress info for a running subagent (UI-only, not persisted). */
interface SubagentProgressStep {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  args?: string;
  result?: string;
  startedAt?: number;
  endedAt?: number;
}

interface SubagentProgressInfo {
  runId: string;
  chatId: string;
  task: string;
  startedAt: number;
  stepCount: number;
  steps: SubagentProgressStep[];
}

/** Status of the LLM streaming connection */
type StreamingStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';

/** Union of all port message types */
type PortMessage =
  | LLMRequestMessage
  | LLMStreamChunk
  | LLMStreamEnd
  | LLMStepFinish
  | LLMStreamError
  | LLMStreamRetry
  | LLMTtsAudio;

// ──────────────────────────────────────────────
// Type Guards
// ──────────────────────────────────────────────

const VALID_STREAMING_STATUSES: StreamingStatus[] = [
  'idle',
  'connecting',
  'streaming',
  'complete',
  'error',
];

const VALID_TOOL_PART_STATES: ToolPartState[] = [
  'input-streaming',
  'input-available',
  'output-available',
  'output-error',
];

const isTextPart = (part: ChatMessagePart): part is ChatMessagePart & { type: 'text' } =>
  part.type === 'text';

const isReasoningPart = (part: ChatMessagePart): part is ChatMessagePart & { type: 'reasoning' } =>
  part.type === 'reasoning';

const isToolCallPart = (part: ChatMessagePart): part is ChatMessagePart & { type: 'tool-call' } =>
  part.type === 'tool-call';

const isToolResultPart = (
  part: ChatMessagePart,
): part is ChatMessagePart & { type: 'tool-result' } => part.type === 'tool-result';

const isFilePart = (part: ChatMessagePart): part is ChatMessagePart & { type: 'file' } =>
  part.type === 'file';

const isValidStreamingStatus = (value: unknown): value is StreamingStatus =>
  typeof value === 'string' && VALID_STREAMING_STATUSES.includes(value as StreamingStatus);

const isValidToolPartState = (value: unknown): value is ToolPartState =>
  typeof value === 'string' && VALID_TOOL_PART_STATES.includes(value as ToolPartState);

// ──────────────────────────────────────────────
// Message Type Guards
// ──────────────────────────────────────────────

const isStreamChunk = (msg: PortMessage): msg is LLMStreamChunk => msg.type === 'LLM_STREAM_CHUNK';

const isStreamEnd = (msg: PortMessage): msg is LLMStreamEnd => msg.type === 'LLM_STREAM_END';

const isStreamError = (msg: PortMessage): msg is LLMStreamError => msg.type === 'LLM_STREAM_ERROR';

const isTtsAudio = (msg: PortMessage): msg is LLMTtsAudio => msg.type === 'LLM_TTS_AUDIO';

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

export type {
  ToolPartState,
  ChatMessagePart,
  ChatMessage,
  Chat,
  ChannelMeta,
  Attachment,
  SessionUsage,
  ModelProvider,
  ChatModel,
  ToolDefinition,
  SubagentProgressStep,
  SubagentProgressInfo,
  LLMRequestMessage,
  LLMStreamChunk,
  LLMStreamEnd,
  LLMStepFinish,
  LLMStreamError,
  LLMStreamRetry,
  LLMTtsAudio,
  StreamingStatus,
  PortMessage,
};

export {
  isTextPart,
  isReasoningPart,
  isToolCallPart,
  isToolResultPart,
  isFilePart,
  isValidStreamingStatus,
  isValidToolPartState,
  isStreamChunk,
  isStreamEnd,
  isStreamError,
  isTtsAudio,
};
