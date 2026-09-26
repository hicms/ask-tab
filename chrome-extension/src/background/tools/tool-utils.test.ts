import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockListWorkspaceFiles = vi.fn();

vi.mock('@extension/storage', () => ({
  activeAgentStorage: { get: mockGet },
  listWorkspaceFiles: mockListWorkspaceFiles,
}));

const { getActiveAgentId, getWorkspaceFile } = await import('./tool-utils');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getActiveAgentId', () => {
  it('returns agent id when set', async () => {
    mockGet.mockResolvedValue('agent-1');
    expect(await getActiveAgentId()).toBe('agent-1');
  });

  it('returns undefined for empty string', async () => {
    mockGet.mockResolvedValue('');
    expect(await getActiveAgentId()).toBeUndefined();
  });

  it('returns undefined on error', async () => {
    mockGet.mockRejectedValue(new Error('storage error'));
    expect(await getActiveAgentId()).toBeUndefined();
  });
});

describe('getWorkspaceFile', () => {
  const files = [
    { id: '1', name: 'MEMORY.md', content: 'hello' },
    { id: '2', name: 'notes/todo.md', content: 'tasks' },
  ];

  it('returns matching file by name', async () => {
    mockListWorkspaceFiles.mockResolvedValue(files);
    const result = await getWorkspaceFile('MEMORY.md');
    expect(result).toEqual(files[0]);
  });

  it('returns undefined when file not found', async () => {
    mockListWorkspaceFiles.mockResolvedValue(files);
    const result = await getWorkspaceFile('nonexistent.md');
    expect(result).toBeUndefined();
  });

  it('passes agentId to listWorkspaceFiles', async () => {
    mockListWorkspaceFiles.mockResolvedValue([]);
    await getWorkspaceFile('test.md', 'agent-42');
    expect(mockListWorkspaceFiles).toHaveBeenCalledWith('agent-42');
  });
});
