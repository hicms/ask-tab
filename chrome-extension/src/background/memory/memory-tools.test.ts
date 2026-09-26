import { _resetCache } from './memory-sync';
import { executeMemorySearch, executeMemoryGet } from '../tools/memory-tools';
import { chatDb } from '@storage-internal/chat-db';
import { createWorkspaceFile } from '@storage-internal/chat-storage';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DbWorkspaceFile } from '@storage-internal/chat-db';

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
  await chatDb.memoryChunks.clear();
  _resetCache();
});

describe('memory_search tool', () => {
  it('returns formatted results for matching query', async () => {
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'memory/notes.md',
        content:
          'User prefers TypeScript for backend development.\nReact is the frontend framework.',
      }),
    );
    const result = await executeMemorySearch({ query: 'TypeScript backend' });
    expect(result).toContain('memory/notes.md');
    expect(result).toContain('score:');
    expect(result).toContain('TypeScript');
  });

  it('returns no-results message for non-matching query', async () => {
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'memory/notes.md',
        content: 'User prefers Python.',
      }),
    );
    const result = await executeMemorySearch({ query: 'zxcvbnm qwerty' });
    expect(result).toBe('No matching memory found.');
  });

  it('returns error for empty query', async () => {
    const result = await executeMemorySearch({ query: '   ' });
    expect(result).toContain('Error');
  });

  it('respects maxResults parameter', async () => {
    // Create multiple memory files
    for (let i = 0; i < 10; i++) {
      await createWorkspaceFile(
        makeFile({
          id: `f${i}`,
          name: `memory/note-${i}.md`,
          content: `Important information about project ${i} and development tasks`,
        }),
      );
    }
    const result = await executeMemorySearch({
      query: 'project development',
      maxResults: 3,
    });
    // Count result entries: [1], [2], [3]
    const matches = result.match(/\[\d+\]/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeLessThanOrEqual(3);
  });

  it('indexes only memory-eligible files (MEMORY.md + memory/*)', async () => {
    await createWorkspaceFile(
      makeFile({
        id: 'f1',
        name: 'MEMORY.md',
        content: 'Main memory file with keyword alphaSearch',
      }),
    );
    await createWorkspaceFile(
      makeFile({
        id: 'f2',
        name: 'memory/daily.md',
        content: 'Daily log with keyword alphaSearch',
      }),
    );
    await createWorkspaceFile(
      makeFile({
        id: 'f3',
        name: 'USER.md',
        content: 'User config with keyword alphaSearch',
        owner: 'user',
      }),
    );
    const result = await executeMemorySearch({ query: 'alphaSearch' });
    expect(result).toContain('MEMORY.md');
    expect(result).toContain('memory/daily.md');
    // USER.md should NOT appear — not memory-eligible
    expect(result).not.toContain('USER.md');
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
