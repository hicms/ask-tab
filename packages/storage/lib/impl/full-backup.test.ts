import 'fake-indexeddb/auto';
import { chatDb } from './chat-db';
import { defaultEmbeddingConfig } from './embedding-config-storage';
import { captureFullBackup, restoreFullBackup, validateFullBackup } from './full-backup';
import { defaultTtsConfig } from './tts-config-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let local: Record<string, unknown>;
let setLocal: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  local = {
    'suggested-actions': [{ id: 'action-1', label: 'Summarize', prompt: 'Summarize this' }],
    'server-models': [{ id: 'ask:model-1', modelId: 'model-1', name: 'Model', provider: 'custom' }],
    'ask-session': {
      token: 'session-token',
      userId: 'u',
      email: 'user@example.com',
      expiresAt: 9999999999999,
    },
    channelConfigs: [
      {
        channelId: 'telegram',
        enabled: true,
        status: 'active',
        credentials: { botToken: 'bot-secret' },
      },
    ],
    'wa-auth-creds': 'wa-secret',
    'wa-auth-keys:session:abc': 'signal-secret',
    'heartbeat.main': { enabled: true },
    'backup-settings': { enabled: true, lastSuccessAt: 1 },
  };
  setLocal = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(local, structuredClone(items));
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => structuredClone(local)),
        set: setLocal,
        remove: vi.fn(async (keys: string[]) => {
          for (const key of keys) delete local[key];
        }),
      },
    },
  });
  await Promise.all([
    chatDb.agents.clear(),
    chatDb.chats.clear(),
    chatDb.messages.clear(),
    chatDb.modelTranscripts.clear(),
    chatDb.artifacts.clear(),
    chatDb.workspaceFiles.clear(),
    chatDb.memoryChunks.clear(),
    chatDb.scheduledTasks.clear(),
    chatDb.taskRunLogs.clear(),
    chatDb.embeddingCache.clear(),
    chatDb.heartbeatState.clear(),
    chatDb.heartbeatLocks.clear(),
  ]);
  await chatDb.agents.put({
    id: 'main',
    name: 'Main',
    identity: { emoji: '🤖' },
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
  });
  await chatDb.chats.put({
    id: 'chat-1',
    title: 'Private',
    agentId: 'main',
    createdAt: 1,
    updatedAt: 1,
  });
  await chatDb.messages.put({
    id: 'message-1',
    chatId: 'chat-1',
    role: 'user',
    parts: [{ type: 'text', text: 'remember me' }],
    createdAt: 1,
  });
  await chatDb.modelTranscripts.put({
    chatId: 'chat-1',
    schemaVersion: 1,
    status: 'complete',
    sourceKey: 'source-1',
    lastUiMessageId: 'message-1',
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinkingSignature: 'reasoning_content', thinking: 'reason' }],
      },
    ],
  });
  await chatDb.artifacts.put({
    id: 'artifact-1',
    chatId: 'chat-1',
    title: 'note',
    kind: 'text',
    content: 'content',
    createdAt: 1,
    updatedAt: 1,
  });
  await chatDb.workspaceFiles.put({
    id: 'file-1',
    name: 'MEMORY.md',
    content: 'memory',
    enabled: false,
    owner: 'agent',
    predefined: true,
    agentId: 'main',
    createdAt: 1,
    updatedAt: 1,
  });
  await chatDb.memoryChunks.put({
    id: 'chunk-1',
    fileId: 'file-1',
    filePath: 'MEMORY.md',
    startLine: 1,
    endLine: 1,
    text: 'memory',
    fileUpdatedAt: 1,
    agentId: 'main',
  });
  await chatDb.scheduledTasks.put({
    id: 'task-1',
    name: 'Daily',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    schedule: { kind: 'every' },
    payload: { kind: 'agent' },
    state: { runningAtMs: 1, nextRunAtMs: 2 },
  });
  await chatDb.taskRunLogs.put({ id: 'run-1', taskId: 'task-1', timestamp: 1, status: 'ok' });
  await chatDb.embeddingCache.put({
    id: 'embed-1',
    provider: 'test',
    model: 'test',
    embeddingSpaceId: 'space-a',
    contentHash: 'hash',
    embedding: [0.1],
    dims: 1,
    updatedAt: 1,
  });
  await chatDb.heartbeatState.put({ agentId: 'main', lastRunAtMs: 1 });
  await chatDb.heartbeatLocks.put({ agentId: 'main', acquiredAt: 1, expiresAt: 2 });
});

describe('full backup', () => {
  it('captures all portable tables and approved local settings without account data', async () => {
    const backup = await captureFullBackup();
    expect(backup.tables.agents).toHaveLength(1);
    expect(backup.tables.messages[0]?.parts[0]).toEqual({ type: 'text', text: 'remember me' });
    expect(backup.tables.modelTranscripts[0]?.messages).toEqual(
      (await chatDb.modelTranscripts.get('chat-1'))?.messages,
    );
    expect(backup.tables.workspaceFiles[0]?.enabled).toBe(false);
    expect(backup.tables.memoryChunks).toHaveLength(1);
    expect(backup.tables.scheduledTasks).toHaveLength(1);
    expect(backup.tables.embeddingCache).toHaveLength(1);
    expect(backup.local['suggested-actions']).toEqual(local['suggested-actions']);
    expect(backup.local['wa-auth-keys:session:abc']).toBe('signal-secret');
    expect(backup.local['server-models']).toBeUndefined();
    expect(backup.local['ask-session']).toBeUndefined();
    expect(backup.local['backup-settings']).toBeUndefined();
    expect(JSON.stringify(backup)).not.toContain('session-token');
  });

  it('rejects credential fields in tool settings and agent overrides', async () => {
    local['tool-config'] = {
      enabledTools: {},
      webSearchConfig: { provider: 'server', browser: { engine: 'bing' }, apiKey: 'search-secret' },
    };
    await expect(captureFullBackup()).rejects.toThrow('Invalid tool configuration');
    delete local['tool-config'];
    await chatDb.agents.update('main', {
      toolConfig: {
        enabledTools: { web_search: true },
        webSearchConfig: {
          provider: 'server',
          browser: { engine: 'bing' },
          apiKey: 'search-secret',
        },
      },
    } as never);
    await expect(captureFullBackup()).rejects.toThrow('Invalid tool configuration');
  });

  it('omits messages and artifacts left behind after their chat was deleted', async () => {
    await chatDb.messages.put({
      id: 'late-message',
      chatId: 'deleted-chat',
      role: 'assistant',
      parts: [{ type: 'text', text: 'late response' }],
      createdAt: 2,
    });
    await chatDb.artifacts.put({
      id: 'late-artifact',
      chatId: 'deleted-chat',
      title: 'Late result',
      kind: 'text',
      content: 'late result',
      createdAt: 2,
      updatedAt: 2,
    });

    const backup = await captureFullBackup();
    expect(() => validateFullBackup(backup)).not.toThrow();
    expect(backup.tables.messages.map(message => message.id)).toEqual(['message-1']);
    expect(backup.tables.artifacts.map(artifact => artifact.id)).toEqual(['artifact-1']);
    expect(await chatDb.messages.get('late-message')).toBeDefined();
  });

  it('restores a selected snapshot, preserving data and clearing stale runtime state', async () => {
    const backup = await captureFullBackup();
    await chatDb.messages.clear();
    await chatDb.modelTranscripts.clear();
    await chatDb.workspaceFiles.clear();
    local['suggested-actions'] = [];
    local['obsolete-unknown-key'] = 'keep';
    await restoreFullBackup(backup);

    expect((await chatDb.messages.toArray())[0]?.parts[0]).toEqual({
      type: 'text',
      text: 'remember me',
    });
    expect((await chatDb.modelTranscripts.get('chat-1'))?.messages).toEqual(
      backup.tables.modelTranscripts[0]?.messages,
    );
    expect((await chatDb.workspaceFiles.toArray())[0]?.enabled).toBe(false);
    expect((await chatDb.scheduledTasks.get('task-1'))?.state.runningAtMs).toBeUndefined();
    expect(await chatDb.heartbeatLocks.count()).toBe(0);
    expect(local['suggested-actions']).toEqual(backup.local['suggested-actions']);
    expect((local['channelConfigs'] as { enabled: boolean }[])[0]?.enabled).toBe(false);
    expect(local['server-models']).toEqual([
      { id: 'ask:model-1', modelId: 'model-1', name: 'Model', provider: 'custom' },
    ]);
    expect(local['ask-session']).toEqual({
      token: 'session-token',
      userId: 'u',
      email: 'user@example.com',
      expiresAt: 9999999999999,
    });
    expect(local['backup-settings']).toEqual({ enabled: true, lastSuccessAt: 1 });
    expect(local['obsolete-unknown-key']).toBe('keep');
  });

  it('resolves a restored model choice against the current account catalog', async () => {
    local['selected-model-id'] = 'ask:model-1';
    const backup = await captureFullBackup();
    local['server-models'] = [
      { id: 'ask:new-model', modelId: 'new-model', name: 'Current', provider: 'custom' },
    ];
    local['selected-model-id'] = 'ask:new-model';

    await restoreFullBackup(backup);

    expect(local['selected-model-id']).toBe('ask:new-model');
    expect(local['server-models']).toEqual([
      { id: 'ask:new-model', modelId: 'new-model', name: 'Current', provider: 'custom' },
    ]);

    const withoutSelection = {
      ...backup,
      local: Object.fromEntries(
        Object.entries(backup.local).filter(([key]) => key !== 'selected-model-id'),
      ),
    };
    await restoreFullBackup(withoutSelection);
    expect(local['selected-model-id']).toBe('ask:new-model');
  });

  it('rejects a version 1 backup without changing current data', async () => {
    const current = await captureFullBackup();
    const { modelTranscripts: _omitted, ...oldTables } = current.tables;
    await expect(restoreFullBackup({ ...current, version: 1, tables: oldTables })).rejects.toThrow(
      'Unsupported',
    );
    expect(await chatDb.modelTranscripts.count()).toBe(1);
  });

  it('rejects invalid data before changing the current state', async () => {
    const backup = await captureFullBackup();
    backup.tables.messages[0]!.chatId = 'missing';
    await expect(restoreFullBackup(backup)).rejects.toThrow('Invalid message chat');
    expect((await chatDb.messages.get('message-1'))?.chatId).toBe('chat-1');
    expect(local['suggested-actions']).toHaveLength(1);
  });

  it('rolls back local data when writing the snapshot fails', async () => {
    const backup = await captureFullBackup();
    backup.local['suggested-actions'] = [];
    setLocal.mockRejectedValueOnce(new Error('storage full'));
    await expect(restoreFullBackup(backup)).rejects.toThrow('storage full');
    expect(local['suggested-actions']).toHaveLength(1);
    expect(await chatDb.messages.count()).toBe(1);
  });

  it('rejects unknown keys and unsupported versions', async () => {
    const backup = await captureFullBackup();
    expect(() => validateFullBackup({ ...backup, version: 99 })).toThrow('Unsupported');
    expect(() =>
      validateFullBackup({ ...backup, local: { ...backup.local, 'backup-settings': {} } }),
    ).toThrow('Invalid backup storage key');
  });

  it('rejects hidden AI credentials in nested preferences', async () => {
    const backup = await captureFullBackup();
    expect(() =>
      validateFullBackup({
        ...backup,
        local: {
          ...backup.local,
          'tts-config': {
            ...defaultTtsConfig,
            kokoro: { ...defaultTtsConfig.kokoro, apiKey: 'sk-synthetic' },
          },
        },
      }),
    ).toThrow('Invalid backup configuration: tts-config.kokoro');
    expect(() =>
      validateFullBackup({
        ...backup,
        local: {
          ...backup.local,
          'embedding-config': {
            ...defaultEmbeddingConfig,
            search: { ...defaultEmbeddingConfig.search, apiKey: 'sk-synthetic' },
          },
        },
      }),
    ).toThrow('Invalid backup configuration: embedding-config.search');
    expect(() =>
      validateFullBackup({
        ...backup,
        local: {
          ...backup.local,
          settings: { theme: 'dark', locale: 'en', apiKey: 'sk-synthetic' },
        },
      }),
    ).toThrow('Invalid backup configuration: settings');
  });
});
