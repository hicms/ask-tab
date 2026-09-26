/**
 * Client for the AskTab memory service. The server owns chunking, embedding and
 * hybrid ranking; the extension only mirrors memory documents and asks for results.
 */

import { requestAuthorized } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { getActiveAgentId } from '../tools/tool-utils';
import { listChats, listWorkspaceFiles } from '@extension/storage';
import type { DbWorkspaceFile } from '@extension/storage';

const memoryLog = createLogger('memory-sync');

/** Chats saved without an agent belong to the seeded default agent. */
const DEFAULT_AGENT_ID = 'main';

interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
}

interface MemoryDocument {
  path: string;
  content: string;
  updatedAt: number;
  chatId?: string;
}

const isMemoryEligible = (file: DbWorkspaceFile): boolean =>
  file.name === 'MEMORY.md' || file.name.startsWith('memory/');

const resolveAgentKey = async (agentId?: string): Promise<string> =>
  agentId || (await getActiveAgentId()) || DEFAULT_AGENT_ID;

const memoryEndpoint = (agentKey: string, action: 'sync' | 'documents' | 'search'): string =>
  `/api/memory/${encodeURIComponent(agentKey)}/${action}`;

const sendJson = (path: string, method: 'POST' | 'PUT', body: unknown): Promise<Response> =>
  requestAuthorized(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const putDocument = async (agentKey: string, document: MemoryDocument): Promise<void> => {
  await sendJson(memoryEndpoint(agentKey, 'documents'), 'PUT', document);
};

/** Mirror the agent's memory files and prune documents whose file or chat is gone. */
const syncMemory = async (agentId?: string): Promise<void> => {
  const agentKey = await resolveAgentKey(agentId);
  const [workspaceFiles, chats] = await Promise.all([
    listWorkspaceFiles(agentKey),
    listChats(Number.MAX_SAFE_INTEGER, 0),
  ]);
  const files = new Map(
    workspaceFiles.filter(isMemoryEligible).map(file => [file.name, file] as const),
  );
  const chatIds = chats
    .filter(chat => (chat.agentId || DEFAULT_AGENT_ID) === agentKey)
    .map(chat => chat.id);

  const response = await sendJson(memoryEndpoint(agentKey, 'sync'), 'POST', {
    files: [...files.values()].map(file => ({ path: file.name, updatedAt: file.updatedAt })),
    chatIds,
  });
  const { stale } = (await response.json()) as { stale?: string[] };

  const uploads = (stale ?? []).flatMap(path => {
    const file = files.get(path);
    return file ? [file] : [];
  });
  await Promise.all(
    uploads.map(file =>
      putDocument(agentKey, { path: file.name, content: file.content, updatedAt: file.updatedAt }),
    ),
  );
  memoryLog.trace('memory synced', {
    agentKey,
    files: files.size,
    chats: chatIds.length,
    uploaded: uploads.length,
  });
};

const searchMemory = async (
  agentId: string | undefined,
  query: string,
  options: MemorySearchOptions = {},
): Promise<MemorySearchResult[]> => {
  const agentKey = await resolveAgentKey(agentId);
  await syncMemory(agentKey);
  const response = await sendJson(memoryEndpoint(agentKey, 'search'), 'POST', {
    query,
    ...options,
  });
  return (await response.json()) as MemorySearchResult[];
};

/** The server replaces any earlier document stored for the same chat. */
const uploadTranscript = async (
  agentId: string | undefined,
  transcript: { chatId: string; path: string; content: string },
): Promise<void> => {
  const agentKey = await resolveAgentKey(agentId);
  await putDocument(agentKey, { ...transcript, updatedAt: Date.now() });
};

/** Deletes everything the server stores for an agent that no longer exists. */
const forgetAgentMemory = async (agentId: string): Promise<void> => {
  await requestAuthorized(`/api/memory/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
};

export { DEFAULT_AGENT_ID, forgetAgentMemory, searchMemory, syncMemory, uploadTranscript };
export type { MemorySearchOptions, MemorySearchResult };
