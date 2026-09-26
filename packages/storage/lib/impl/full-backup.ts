import { chatDb } from './chat-db.js';
import { assertToolConfig } from './tool-config-storage.js';
import type {
  AgentConfig,
  DbArtifact,
  DbChat,
  DbChatMessage,
  DbModelTranscript,
  DbEmbeddingCache,
  DbHeartbeatState,
  DbMemoryChunk,
  DbScheduledTask,
  DbTaskRunLog,
  DbWorkspaceFile,
} from './chat-db.js';

const BACKUP_FORMAT = 'asktab-full-backup';
const BACKUP_VERSION = 2;

/**
 * Backup-owned user data. Server models and the account session are deliberately
 * absent: both belong to the signed-in account, so a restore must not replace them.
 */
const LOCAL_KEYS = new Set([
  'settings',
  'tool-config',
  'suggested-actions',
  'selected-model-id',
  'active-agent-id',
  'last-active-session-id',
  'log-config',
  'stt-config',
  'tts-config',
  'embedding-config',
  'channelConfigs',
  'wa-auth-creds',
  'wa-lid-map',
  'wa-sent-messages',
]);

const isBackupLocalKey = (key: string): boolean =>
  LOCAL_KEYS.has(key) || key.startsWith('wa-auth-keys:') || key.startsWith('heartbeat.');

const whatsAppKeys = (stored: Record<string, unknown>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(stored)
        .filter(([key]) => key === 'wa-auth-creds' || key.startsWith('wa-auth-keys:'))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

interface FullBackupTables {
  agents: AgentConfig[];
  chats: DbChat[];
  messages: DbChatMessage[];
  modelTranscripts: DbModelTranscript[];
  artifacts: DbArtifact[];
  workspaceFiles: DbWorkspaceFile[];
  memoryChunks: DbMemoryChunk[];
  scheduledTasks: DbScheduledTask[];
  taskRunLogs: DbTaskRunLog[];
  embeddingCache: DbEmbeddingCache[];
  heartbeatState: DbHeartbeatState[];
}

interface FullBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: number;
  local: Record<string, unknown>;
  tables: FullBackupTables;
}

const tables = [
  chatDb.agents,
  chatDb.chats,
  chatDb.messages,
  chatDb.modelTranscripts,
  chatDb.artifacts,
  chatDb.workspaceFiles,
  chatDb.memoryChunks,
  chatDb.scheduledTasks,
  chatDb.taskRunLogs,
  chatDb.embeddingCache,
  chatDb.heartbeatState,
] as const;

const readTables = async (): Promise<FullBackupTables> =>
  chatDb.transaction('r', [...tables], async () => {
    const [
      agents,
      chats,
      messages,
      modelTranscripts,
      artifacts,
      workspaceFiles,
      memoryChunks,
      scheduledTasks,
      taskRunLogs,
      embeddingCache,
      heartbeatState,
    ] = await Promise.all([
      chatDb.agents.toArray(),
      chatDb.chats.toArray(),
      chatDb.messages.toArray(),
      chatDb.modelTranscripts.toArray(),
      chatDb.artifacts.toArray(),
      chatDb.workspaceFiles.toArray(),
      chatDb.memoryChunks.toArray(),
      chatDb.scheduledTasks.toArray(),
      chatDb.taskRunLogs.toArray(),
      chatDb.embeddingCache.toArray(),
      chatDb.heartbeatState.toArray(),
    ]);
    // A stream can finish writing after its chat was deleted. Keep the snapshot
    // relationally consistent without changing live IndexedDB data.
    const chatIds = new Set(chats.map(chat => chat.id));
    return {
      agents,
      chats,
      messages: messages.filter(message => chatIds.has(message.chatId)),
      modelTranscripts: modelTranscripts.filter(transcript => chatIds.has(transcript.chatId)),
      artifacts: artifacts.filter(artifact => chatIds.has(artifact.chatId)),
      workspaceFiles,
      memoryChunks,
      scheduledTasks,
      taskRunLogs,
      embeddingCache,
      heartbeatState,
    };
  });

const captureFullBackup = async (): Promise<FullBackup> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [stored, data] = await Promise.all([chrome.storage.local.get(null), readTables()]);
    const after = await chrome.storage.local.get(null);
    if (whatsAppKeys(stored) !== whatsAppKeys(after)) continue;
    const local = Object.fromEntries(
      Object.entries(stored).filter(([key]) => isBackupLocalKey(key)),
    );
    return validateFullBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      local,
      tables: data,
    });
  }
  throw new Error('WhatsApp credentials changed during backup; retry later');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Configuration containers have one current shape; unknown fields can carry old secrets. */
const assertFields = (value: unknown, allowed: readonly string[], path: string): void => {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error(`Invalid backup configuration: ${path}`);
  }
};

const assertAiPreferences = (local: Record<string, unknown>): void => {
  if ('settings' in local) assertFields(local.settings, ['theme', 'locale'], 'settings');
  if ('selected-model-id' in local && typeof local['selected-model-id'] !== 'string') {
    throw new Error('Invalid backup configuration: selected-model-id');
  }
  if ('tool-config' in local) assertToolConfig(local['tool-config']);
  if ('stt-config' in local) {
    assertFields(
      local['stt-config'],
      ['engine', 'openai', 'language', 'localModel', 'hotkey'],
      'stt-config',
    );
    assertFields(
      (local['stt-config'] as Record<string, unknown>).openai,
      ['modelId'],
      'stt-config.openai',
    );
  }
  if ('tts-config' in local) {
    assertFields(
      local['tts-config'],
      [
        'engine',
        'autoMode',
        'maxChars',
        'summarize',
        'summaryTimeout',
        'chatUiAutoPlay',
        'kokoro',
        'openai',
      ],
      'tts-config',
    );
    assertFields(
      (local['tts-config'] as Record<string, unknown>).openai,
      ['modelId', 'voice'],
      'tts-config.openai',
    );
    assertFields(
      (local['tts-config'] as Record<string, unknown>).kokoro,
      ['model', 'voice', 'speed', 'adaptiveChunking'],
      'tts-config.kokoro',
    );
  }
  if ('embedding-config' in local) {
    assertFields(
      local['embedding-config'],
      ['provider', 'openaiCompatible', 'local', 'search', 'mmr', 'temporalDecay'],
      'embedding-config',
    );
    assertFields(
      (local['embedding-config'] as Record<string, unknown>).openaiCompatible,
      ['modelId'],
      'embedding-config.openaiCompatible',
    );
    const embedding = local['embedding-config'] as Record<string, unknown>;
    assertFields(embedding.local, ['model'], 'embedding-config.local');
    assertFields(
      embedding.search,
      ['vectorWeight', 'bm25Weight', 'candidateMultiplier'],
      'embedding-config.search',
    );
    assertFields(embedding.mmr, ['enabled', 'lambda'], 'embedding-config.mmr');
    assertFields(
      embedding.temporalDecay,
      ['enabled', 'halfLifeDays'],
      'embedding-config.temporalDecay',
    );
  }
};

const assertRows: (
  rows: unknown,
  key: string,
  idKey: string,
) => asserts rows is Record<string, unknown>[] = (rows, key, idKey) => {
  if (!Array.isArray(rows)) throw new Error(`Invalid backup: ${key} is not an array`);
  const ids = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row[idKey] !== 'string' || !row[idKey]) {
      throw new Error(`Invalid backup: ${key} contains an invalid record`);
    }
    if (ids.has(row[idKey])) throw new Error(`Invalid backup: duplicate ${key} ID`);
    ids.add(row[idKey]);
  }
};

const validateFullBackup = (value: unknown): FullBackup => {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error('Unsupported backup format or version');
  }
  if (!Number.isFinite(value.createdAt) || !isRecord(value.local) || !isRecord(value.tables)) {
    throw new Error('Invalid backup metadata');
  }
  for (const key of Object.keys(value.local)) {
    if (!isBackupLocalKey(key)) throw new Error(`Invalid backup storage key: ${key}`);
  }
  assertAiPreferences(value.local);
  const data = value.tables;
  const idKeys: Record<keyof FullBackupTables, string> = {
    agents: 'id',
    chats: 'id',
    messages: 'id',
    modelTranscripts: 'chatId',
    artifacts: 'id',
    workspaceFiles: 'id',
    memoryChunks: 'id',
    scheduledTasks: 'id',
    taskRunLogs: 'id',
    embeddingCache: 'id',
    heartbeatState: 'agentId',
  };
  for (const [key, idKey] of Object.entries(idKeys)) {
    assertRows(data[key], key, idKey);
  }
  const agents = new Set((data.agents as AgentConfig[]).map(row => row.id));
  for (const agent of data.agents as AgentConfig[]) {
    if (agent.toolConfig !== undefined) assertToolConfig(agent.toolConfig);
  }
  const chats = new Set((data.chats as DbChat[]).map(row => row.id));
  const tasks = new Set((data.scheduledTasks as DbScheduledTask[]).map(row => row.id));
  if (agents.size === 0) throw new Error('Invalid backup: no agents');
  for (const row of data.chats as DbChat[]) {
    if (row.agentId && !agents.has(row.agentId))
      throw new Error(`Invalid chat agent: ${row.agentId}`);
  }
  for (const row of data.workspaceFiles as DbWorkspaceFile[]) {
    if (row.agentId && !agents.has(row.agentId))
      throw new Error(`Invalid workspace agent: ${row.agentId}`);
  }
  for (const row of data.messages as DbChatMessage[]) {
    if (!chats.has(row.chatId)) throw new Error(`Invalid message chat: ${row.chatId}`);
  }
  for (const row of data.modelTranscripts as DbModelTranscript[]) {
    if (!chats.has(row.chatId)) throw new Error(`Invalid model transcript chat: ${row.chatId}`);
    if (
      row.schemaVersion !== 1 ||
      typeof row.sourceKey !== 'string' ||
      !Array.isArray(row.messages) ||
      (row.status !== 'running' && row.status !== 'complete')
    ) {
      throw new Error(`Invalid model transcript: ${row.chatId}`);
    }
  }
  for (const row of data.artifacts as DbArtifact[]) {
    if (!chats.has(row.chatId)) throw new Error(`Invalid artifact chat: ${row.chatId}`);
  }
  for (const row of data.taskRunLogs as DbTaskRunLog[]) {
    if (!tasks.has(row.taskId)) throw new Error(`Invalid task log: ${row.taskId}`);
  }
  return value as unknown as FullBackup;
};

const writeFullBackup = async (backup: FullBackup, resetRuntimeState: boolean): Promise<void> => {
  const current = await chrome.storage.local.get(null);
  const remove = Object.keys(current).filter(
    key => isBackupLocalKey(key) && !(key in backup.local),
  );
  if (remove.length) await chrome.storage.local.remove(remove);
  const local = { ...backup.local };
  if (resetRuntimeState) {
    const models = Array.isArray(current['server-models'])
      ? (current['server-models'] as Array<{ id?: unknown }>)
      : [];
    const ids = new Set(
      models.map(model => model?.id).filter((id): id is string => typeof id === 'string'),
    );
    if (typeof local['selected-model-id'] !== 'string' || !ids.has(local['selected-model-id'])) {
      const currentSelection = current['selected-model-id'];
      local['selected-model-id'] =
        typeof currentSelection === 'string' && ids.has(currentSelection)
          ? currentSelection
          : ((models[0]?.id as string | undefined) ?? '');
    }
  }
  if (resetRuntimeState && Array.isArray(local['channelConfigs'])) {
    local['channelConfigs'] = (local['channelConfigs'] as Record<string, unknown>[]).map(
      config => ({
        ...config,
        enabled: false,
        status: 'idle',
        lastError: undefined,
      }),
    );
  }
  if (Object.keys(local).length) await chrome.storage.local.set(local);

  await chatDb.transaction('rw', [...tables, chatDb.heartbeatLocks], async () => {
    for (const table of tables) await table.clear();
    const data = backup.tables;
    await Promise.all([
      chatDb.agents.bulkPut(data.agents),
      chatDb.chats.bulkPut(data.chats),
      chatDb.messages.bulkPut(data.messages),
      chatDb.modelTranscripts.bulkPut(data.modelTranscripts),
      chatDb.artifacts.bulkPut(data.artifacts),
      chatDb.workspaceFiles.bulkPut(data.workspaceFiles),
      chatDb.memoryChunks.bulkPut(data.memoryChunks),
      chatDb.scheduledTasks.bulkPut(
        resetRuntimeState
          ? data.scheduledTasks.map(task => ({
              ...task,
              state: { ...task.state, runningAtMs: undefined, nextRunAtMs: undefined },
            }))
          : data.scheduledTasks,
      ),
      chatDb.taskRunLogs.bulkPut(data.taskRunLogs),
      chatDb.embeddingCache.bulkPut(data.embeddingCache),
      chatDb.heartbeatState.bulkPut(data.heartbeatState),
    ]);
    await chatDb.heartbeatLocks.clear();
  });
};

/** The caller stops active services before restore and reloads them after success. */
const restoreFullBackup = async (value: unknown): Promise<void> => {
  const backup = validateFullBackup(value);
  const before = await captureFullBackup();
  try {
    await writeFullBackup(backup, true);
  } catch (error) {
    try {
      await writeFullBackup(before, false);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Restore failed and rollback failed');
    }
    throw error;
  }
};

export type { FullBackupTables, FullBackup };
export { BACKUP_FORMAT, BACKUP_VERSION, captureFullBackup, validateFullBackup, restoreFullBackup };
