import { activeAgentStorage, listWorkspaceFiles } from '@extension/storage';
import type { DbWorkspaceFile } from '@extension/storage';

/** Resolve the current active agent ID (undefined if none). */
const getActiveAgentId = async (): Promise<string | undefined> => {
  try {
    const id = await activeAgentStorage.get();
    return id || undefined;
  } catch {
    return undefined;
  }
};

/** Look up a single workspace file by name, optionally scoped to an agent. */
const getWorkspaceFile = async (
  path: string,
  agentId?: string,
): Promise<DbWorkspaceFile | undefined> => {
  const files = await listWorkspaceFiles(agentId);
  return files.find(f => f.name === path);
};

export { getActiveAgentId, getWorkspaceFile };
