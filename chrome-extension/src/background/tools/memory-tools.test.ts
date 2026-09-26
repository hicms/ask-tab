import { executeMemorySearch, executeMemoryGet, memoryToolDefs } from './memory-tools';
import { chatDb } from '@storage-internal/chat-db';
import { createWorkspaceFile } from '@storage-internal/chat-storage';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DbWorkspaceFile } from '@storage-internal/chat-db';

const searchMemory = vi.hoisted(() => vi.fn());
vi.mock('../memory/memory-service', () => ({ searchMemory }));

const makeFile = (
  overrides: Partial<DbWorkspaceFile> & { id: string; name: string },
): DbWorkspaceFile => ({
  content: '',
  enabled: true,
  owner: 'agent',
  predefined: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  agentId: 'main',
  ...overrides,
});

beforeEach(async () => {
  await chatDb.workspaceFiles.clear();
  searchMemory.mockReset().mockResolvedValue([]);
});

describe('memory_search tool', () => {
  it('formats server results with citations, scores, and snippets', async () => {
    searchMemory.mockResolvedValue([
      {
        path: 'memory/notes.md',
        startLine: 1,
        endLine: 2,
        score: 0.8765,
        snippet: 'User prefers TypeScript for backend development.',
      },
      { path: 'MEMORY.md', startLine: 4, endLine: 4, score: 0.1, snippet: 'React frontend' },
    ]);

    const result = await executeMemorySearch({ query: 'TypeScript backend' });

    expect(result).toBe(
      [
        '[1] memory/notes.md#L1-L2 (score: 0.88)\nUser prefers TypeScript for backend development.',
        '[2] MEMORY.md#L4-L4 (score: 0.10)\nReact frontend',
      ].join('\n\n'),
    );
  });

  it('searches the active agent with default limits', async () => {
    await executeMemorySearch({ query: 'TypeScript' });

    expect(searchMemory).toHaveBeenCalledWith('main', 'TypeScript', {
      maxResults: 10,
      minScore: 0,
    });
  });

  it('returns no-results message when the server finds nothing', async () => {
    const result = await executeMemorySearch({ query: 'zxcvbnm qwerty' });
    expect(result).toBe('No matching memory found.');
  });

  it('returns error for empty query without calling the service', async () => {
    const result = await executeMemorySearch({ query: '   ' });
    expect(result).toBe('Error: query must not be empty.');
    expect(searchMemory).not.toHaveBeenCalled();
  });

  it('passes maxResults and minScore, capping maxResults at 30', async () => {
    await executeMemorySearch({ query: 'project', maxResults: 3, minScore: 0.4 });
    await executeMemorySearch({ query: 'project', maxResults: 100 });

    expect(searchMemory.mock.calls.map(call => call[2])).toEqual([
      { maxResults: 3, minScore: 0.4 },
      { maxResults: 30, minScore: 0 },
    ]);
  });

  it('propagates service errors', async () => {
    searchMemory.mockRejectedValue(new Error('Sign in to your AskTab account first'));
    await expect(executeMemorySearch({ query: 'anything' })).rejects.toThrow('Sign in');
  });

  it('describes hybrid ranking instead of keyword-only search', () => {
    const description = memoryToolDefs.find(def => def.name === 'memory_search')?.description;
    expect(description).not.toContain('BM25');
    expect(description).toContain('hybrid');
  });
});

describe('memory_get tool', () => {
  it('returns full file content with line numbers', async () => {
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'memory/test.md',
        content: 'Line one\nLine two\nLine three',
      }),
    );
    const result = await executeMemoryGet({ path: 'memory/test.md' });
    expect(result).toContain('1: Line one');
    expect(result).toContain('2: Line two');
    expect(result).toContain('3: Line three');
  });

  it('returns specific line range with from/lines', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'memory/big.md',
        content: lines.join('\n'),
      }),
    );
    const result = await executeMemoryGet({ path: 'memory/big.md', from: 5, lines: 3 });
    expect(result).toContain('5: Line 5');
    expect(result).toContain('6: Line 6');
    expect(result).toContain('7: Line 7');
    expect(result).not.toContain('4: Line 4');
    expect(result).not.toContain('8: Line 8');
  });

  it('returns file-not-found for nonexistent path', async () => {
    const result = await executeMemoryGet({ path: 'memory/nonexistent.md' });
    expect(result).toContain('File not found');
  });

  it('handles from beyond file length', async () => {
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'memory/short.md',
        content: 'Only one line',
      }),
    );
    const result = await executeMemoryGet({ path: 'memory/short.md', from: 100 });
    expect(result).toContain('beyond the end');
  });

  it('caps lines at 200', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`);
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'memory/huge.md',
        content: lines.join('\n'),
      }),
    );
    const result = await executeMemoryGet({ path: 'memory/huge.md', lines: 500 });
    const outputLines = result.split('\n');
    expect(outputLines.length).toBeLessThanOrEqual(200);
  });
});
