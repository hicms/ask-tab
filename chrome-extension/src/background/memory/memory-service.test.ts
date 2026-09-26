import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbChat, DbWorkspaceFile } from '@extension/storage';

const requestAuthorized = vi.hoisted(() => vi.fn());
const getActiveAgentId = vi.hoisted(() => vi.fn());
const listWorkspaceFiles = vi.hoisted(() => vi.fn());
const listChats = vi.hoisted(() => vi.fn());

vi.mock('../ask-service/client', () => ({ requestAuthorized }));

vi.mock('../tools/tool-utils', () => ({ getActiveAgentId }));
vi.mock('@extension/storage', () => ({ listWorkspaceFiles, listChats }));
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const { forgetAgentMemory, searchMemory, syncMemory, uploadTranscript } = await import(
  './memory-service'
);

const file = (name: string, content: string, updatedAt: number): DbWorkspaceFile => ({
  id: `id-${name}`,
  name,
  content,
  enabled: true,
  owner: 'agent',
  predefined: false,
  createdAt: 1,
  updatedAt,
  agentId: 'agent-1',
});

const chat = (id: string, agentId?: string): DbChat => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  agentId,
});

const serviceError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const calls = () =>
  requestAuthorized.mock.calls.map(([path, init]: [string, RequestInit]) => ({
    path,
    method: init.method,
    body: JSON.parse(init.body as string),
  }));

beforeEach(() => {
  requestAuthorized.mockReset();
  getActiveAgentId.mockReset().mockResolvedValue('agent-1');
  listWorkspaceFiles
    .mockReset()
    .mockResolvedValue([
      file('MEMORY.md', '# Memory', 10),
      file('memory/2026-01-02.md', 'Daily note', 20),
      file('USER.md', 'Not memory', 30),
    ]);
  listChats
    .mockReset()
    .mockResolvedValue([chat('chat-a', 'agent-1'), chat('chat-b', 'other'), chat('chat-c')]);
});

describe('syncMemory', () => {
  it('reports memory files and agent chats, then uploads only stale files', async () => {
    requestAuthorized.mockResolvedValueOnce(json({ stale: ['memory/2026-01-02.md'] }));
    requestAuthorized.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await syncMemory('agent-1');

    expect(listWorkspaceFiles).toHaveBeenCalledWith('agent-1');
    expect(calls()).toEqual([
      {
        path: '/api/memory/agent-1/sync',
        method: 'POST',
        body: {
          files: [
            { path: 'MEMORY.md', updatedAt: 10 },
            { path: 'memory/2026-01-02.md', updatedAt: 20 },
          ],
          chatIds: ['chat-a'],
        },
      },
      {
        path: '/api/memory/agent-1/documents',
        method: 'PUT',
        body: { path: 'memory/2026-01-02.md', content: 'Daily note', updatedAt: 20 },
      },
    ]);
  });

  it('ignores stale paths that are not local memory files', async () => {
    requestAuthorized.mockResolvedValueOnce(json({ stale: ['USER.md', 'memory/gone.md'] }));

    await syncMemory('agent-1');

    expect(requestAuthorized).toHaveBeenCalledTimes(1);
  });

  it('uploads empty files so the server stores them without chunks', async () => {
    listWorkspaceFiles.mockResolvedValue([file('MEMORY.md', '', 5)]);
    requestAuthorized.mockResolvedValueOnce(json({ stale: ['MEMORY.md'] }));
    requestAuthorized.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await syncMemory('agent-1');

    expect(calls()[1]?.body).toEqual({ path: 'MEMORY.md', content: '', updatedAt: 5 });
  });

  it('uses the active agent, falling back to main, and owns unassigned chats as main', async () => {
    getActiveAgentId.mockResolvedValue(undefined);
    requestAuthorized.mockResolvedValue(json({ stale: [] }));

    await syncMemory();

    expect(listWorkspaceFiles).toHaveBeenCalledWith('main');
    expect(calls()[0]).toMatchObject({
      path: '/api/memory/main/sync',
      body: { chatIds: ['chat-c'] },
    });
  });

  it('URL-encodes the agent key', async () => {
    requestAuthorized.mockResolvedValue(json({ stale: [] }));

    await syncMemory('team/a b');

    expect(calls()[0]?.path).toBe('/api/memory/team%2Fa%20b/sync');
  });

  it('propagates upload failures', async () => {
    requestAuthorized.mockResolvedValueOnce(json({ stale: ['MEMORY.md'] }));
    requestAuthorized.mockRejectedValueOnce(serviceError('Invalid memory path', 400));

    await expect(syncMemory('agent-1')).rejects.toThrow('Invalid memory path');
  });
});

describe('searchMemory', () => {
  it('syncs before posting the search request and returns server results', async () => {
    const results = [
      { path: 'MEMORY.md', startLine: 1, endLine: 3, score: 0.9, snippet: '# Memory' },
    ];
    requestAuthorized.mockResolvedValueOnce(json({ stale: [] }));
    requestAuthorized.mockResolvedValueOnce(json(results));

    await expect(
      searchMemory('agent-1', 'memory', { maxResults: 5, minScore: 0.2 }),
    ).resolves.toEqual(results);

    expect(calls().map(call => call.path)).toEqual([
      '/api/memory/agent-1/sync',
      '/api/memory/agent-1/search',
    ]);
    expect(calls()[1]).toEqual({
      path: '/api/memory/agent-1/search',
      method: 'POST',
      body: { query: 'memory', maxResults: 5, minScore: 0.2 },
    });
  });

  it('omits unset options from the search body', async () => {
    requestAuthorized.mockResolvedValueOnce(json({ stale: [] }));
    requestAuthorized.mockResolvedValueOnce(json([]));

    await searchMemory('agent-1', 'anything');

    expect(calls()[1]?.body).toEqual({ query: 'anything' });
  });

  it('propagates sign-in errors without searching', async () => {
    requestAuthorized.mockRejectedValueOnce(
      serviceError('Sign in to your AskTab account first', 401),
    );

    await expect(searchMemory('agent-1', 'memory')).rejects.toMatchObject({ status: 401 });
    expect(requestAuthorized).toHaveBeenCalledTimes(1);
  });

  it('propagates search errors', async () => {
    requestAuthorized.mockResolvedValueOnce(json({ stale: [] }));
    requestAuthorized.mockRejectedValueOnce(serviceError('query must not be empty', 400));

    await expect(searchMemory('agent-1', 'memory')).rejects.toThrow('query must not be empty');
  });
});

describe('forgetAgentMemory', () => {
  it('deletes the agent key on the server', async () => {
    requestAuthorized.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await forgetAgentMemory('team/a b');

    expect(requestAuthorized).toHaveBeenCalledWith('/api/memory/team%2Fa%20b', {
      method: 'DELETE',
    });
  });
});

describe('uploadTranscript', () => {
  it('puts the transcript with its chat id', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    requestAuthorized.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await uploadTranscript('agent-1', {
      chatId: 'chat-a',
      path: 'transcript/2026-01-02/chat-a-title.md',
      content: 'User: hi',
    });

    expect(calls()).toEqual([
      {
        path: '/api/memory/agent-1/documents',
        method: 'PUT',
        body: {
          chatId: 'chat-a',
          path: 'transcript/2026-01-02/chat-a-title.md',
          content: 'User: hi',
          updatedAt: 1234,
        },
      },
    ]);
    vi.mocked(Date.now).mockRestore();
  });
});
