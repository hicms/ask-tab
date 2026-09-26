import { Dexie } from 'dexie';
import type { ToolConfig } from './tool-config-storage.js';
import type { EntityTable } from 'dexie';

/** DB-level chat message part (stored as JSON) */
interface DbChatMessagePart {
  type: string;
  [key: string]: unknown;
}

/** DB-level chat message */
interface DbChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  parts: DbChatMessagePart[];
  createdAt: number;
  model?: string;
}

/** Lossless SDK history; the UI messages table is only a display projection. */
interface DbModelTranscript {
  chatId: string;
  schemaVersion: 1;
  status: 'running' | 'complete';
  sourceKey: string;
  lastUiMessageId?: string;
  messages: unknown[];
}

/** DB-level channel metadata */
interface DbChannelMeta {
  channelId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  extra?: Record<string, unknown>;
}

/** DB-level chat */
interface DbChat {
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
  channelMeta?: DbChannelMeta;
  agentId?: string;
  compactionTokensBefore?: number;
  compactionTokensAfter?: number;
  compactionMethod?: 'summary' | 'sliding-window' | 'adaptive' | 'none';
}

/** DB-level artifact */
interface DbArtifact {
  id: string;
  chatId: string;
  title: string;
  kind: 'text' | 'code' | 'sheet' | 'image';
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** DB-level workspace file */
interface DbWorkspaceFile {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  owner: 'user' | 'agent';
  predefined: boolean;
  createdAt: number;
  updatedAt: number;
  agentId?: string;
}

/** DB-level model config */
interface DbChatModel {
  id: string;
  /** The model identifier sent to the provider (e.g. gpt-4o, claude-sonnet-4-5) */
  modelId: string;
  name: string;
  provider: string;
  description?: string;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  /** Wall-clock timeout in seconds for tool-call execution (default: 300). */
  toolTimeoutSeconds?: number;
  /** Context window size in tokens. Overrides the built-in lookup when set. */
  contextWindow?: number;
}

/** DB-level memory chunk for BM25 search */
interface DbMemoryChunk {
  id: string;
  fileId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  fileUpdatedAt: number;
  agentId?: string;
  // ── Embedding support (v12) ──
  contentHash?: string; // SHA-256 of chunk text
  embedding?: number[]; // vector embedding (e.g. 1536 floats)
  embeddingProvider?: string; // e.g. 'openai-compatible'
  embeddingModel?: string; // e.g. 'text-embedding-3-small'
  embeddingSpaceId?: string;
  // ── Transcript indexing (v13) ──
  chatId?: string; // Links transcript chunks to a chat session
}

/** Persistent embedding cache — avoids re-embedding unchanged text */
interface DbEmbeddingCache {
  id: string; // composite key: `${embeddingSpaceId}:${contentHash}`
  provider: string;
  model: string;
  embeddingSpaceId: string;
  contentHash: string; // SHA-256 of the text that was embedded
  embedding: number[]; // the cached vector
  dims: number; // vector length, for validation
  updatedAt: number; // timestamp, for LRU eviction
}

/** Agent identity (avatar, theme, etc.) */
interface AgentIdentity {
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
}

/** Agent model configuration with fallback chain */
interface AgentModelConfig {
  primary?: string;
  fallbacks?: string[];
}

/** Definition for an agent-created custom tool */
interface CustomToolDef {
  name: string;
  description: string;
  params: { name: string; type: string; description: string }[];
  path: string;
  /** System prompt hint included when this tool is enabled */
  promptHint?: string;
}

/** Agent configuration */
interface AgentConfig {
  id: string;
  name: string;
  identity: AgentIdentity;
  isDefault: boolean;
  model?: AgentModelConfig;
  toolConfig?: ToolConfig;
  customTools?: CustomToolDef[];
  compactionConfig?: {
    maxHistoryShare?: number;
    recentTurnsPreserve?: number;
    tokenSafetyMargin?: number;
    toolResultContextShare?: number;
    qualityGuardEnabled?: boolean;
    qualityGuardMaxRetries?: number;
    identifierPolicy?: 'strict' | 'lenient' | 'off';
  };
  createdAt: number;
  updatedAt: number;
}

/** DB-level scheduled task */
interface DbScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  timeoutMs?: number;
  createdAt: number;
  updatedAt: number;
  schedule: { kind: string; [key: string]: unknown };
  payload: { kind: string; [key: string]: unknown };
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

/** DB-level task run log entry */
interface DbTaskRunLog {
  id: string;
  taskId: string;
  timestamp: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  durationMs?: number;
  chatId?: string;
}

/** DB-level heartbeat per-agent state (v14). */
interface DbHeartbeatState {
  agentId: string;
  lastRunAtMs?: number;
  lastStatus?: 'ran' | 'skipped' | 'failed';
  lastReason?: string;
  lastResultSummary?: string;
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
  lastChatId?: string;
}

/** DB-level TTL lock for an in-flight heartbeat run (v14). */
interface DbHeartbeatLock {
  agentId: string;
  acquiredAt: number;
  expiresAt: number;
  reason?: string;
}

const chatDb = new Dexie('asktab') as InstanceType<typeof Dexie> & {
  agents: EntityTable<AgentConfig, 'id'>;
  chats: EntityTable<DbChat, 'id'>;
  messages: EntityTable<DbChatMessage, 'id'>;
  modelTranscripts: EntityTable<DbModelTranscript, 'chatId'>;
  artifacts: EntityTable<DbArtifact, 'id'>;
  workspaceFiles: EntityTable<DbWorkspaceFile, 'id'>;
  memoryChunks: EntityTable<DbMemoryChunk, 'id'>;
  scheduledTasks: EntityTable<DbScheduledTask, 'id'>;
  taskRunLogs: EntityTable<DbTaskRunLog, 'id'>;
  embeddingCache: EntityTable<DbEmbeddingCache, 'id'>;
  heartbeatState: EntityTable<DbHeartbeatState, 'agentId'>;
  heartbeatLocks: EntityTable<DbHeartbeatLock, 'agentId'>;
};

chatDb.version(1).stores({
  agents: 'id, isDefault',
  chats: 'id, updatedAt, source, agentId',
  messages: 'id, chatId, createdAt',
  modelTranscripts: 'chatId',
  artifacts: 'id, chatId',
  workspaceFiles: 'id, owner, agentId',
  memoryChunks: 'id, fileId, filePath, agentId, chatId',
  scheduledTasks: 'id, enabled',
  taskRunLogs: 'id, taskId, timestamp',
  embeddingCache: 'id, contentHash, updatedAt',
  heartbeatState: 'agentId, lastRunAtMs',
  heartbeatLocks: 'agentId, expiresAt',
});

// Seed the default 'main' agent on fresh installs.
chatDb.on('populate', () => {
  const now = Date.now();
  chatDb.agents.add({
    id: 'main',
    name: 'Main Agent',
    identity: { emoji: '' },
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
});

export type {
  DbChatMessagePart,
  DbChatMessage,
  DbModelTranscript,
  DbChat,
  DbChannelMeta,
  DbArtifact,
  DbChatModel,
  DbWorkspaceFile,
  DbMemoryChunk,
  AgentConfig,
  AgentIdentity,
  AgentModelConfig,
  CustomToolDef,
  DbScheduledTask,
  DbTaskRunLog,
  DbEmbeddingCache,
  DbHeartbeatState,
  DbHeartbeatLock,
};
export { chatDb };
