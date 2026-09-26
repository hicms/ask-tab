import { getActiveAgentId, getWorkspaceFile } from './tool-utils';
import { hybridSearch } from '../memory/hybrid-search';
import { syncMemoryIndex } from '../memory/memory-sync';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration } from './tool-registration';
import type { Static } from '@sinclair/typebox';

// ── memory_search ───────────────────────────────

const memorySearchSchema = Type.Object({
  query: Type.String({ description: 'Search query for keyword matching over memory files' }),
  maxResults: Type.Optional(Type.Number({ description: 'Max results (default: 10, max: 30)' })),
  minScore: Type.Optional(Type.Number({ description: 'Min relevance score (default: 0.0)' })),
});

type MemorySearchArgs = Static<typeof memorySearchSchema>;

const executeMemorySearch = async (args: MemorySearchArgs): Promise<string> => {
  const { query, maxResults, minScore } = args;

  if (!query.trim()) {
    return 'Error: query must not be empty.';
  }

  const agentId = await getActiveAgentId();
  const { index, chunks } = await syncMemoryIndex(agentId);
  const results = await hybridSearch(index, query, chunks, {
    maxResults: Math.min(maxResults ?? 10, 30),
    minScore: minScore ?? 0.0,
  });

  if (results.length === 0) {
    return 'No matching memory found.';
  }

  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.citation} (score: ${r.score.toFixed(2)})\n${r.snippet}`,
  );
  return lines.join('\n\n');
};

// ── memory_get ──────────────────────────────────

const memoryGetSchema = Type.Object({
  path: Type.String({ description: 'File path (e.g. "memory/2026-02-15.md" or "MEMORY.md")' }),
  from: Type.Optional(Type.Number({ description: 'Start line (1-based, default: 1)' })),
  lines: Type.Optional(
    Type.Number({ description: 'Number of lines to return (default: all, max: 200)' }),
  ),
});

type MemoryGetArgs = Static<typeof memoryGetSchema>;

const executeMemoryGet = async (args: MemoryGetArgs): Promise<string> => {
  const { path, from, lines: lineCount } = args;

  const agentId = await getActiveAgentId();
  const file = await getWorkspaceFile(path, agentId);

  if (!file) {
    return `File not found: ${path}`;
  }

  if (!file.content) {
    return '(empty file)';
  }

  const allLines = file.content.split('\n');
  const startLine = Math.max((from ?? 1) - 1, 0);

  if (startLine >= allLines.length) {
    return `Line ${from} is beyond the end of the file (${allLines.length} lines total).`;
  }

  const count = Math.min(lineCount ?? allLines.length, 200);
  const selected = allLines.slice(startLine, startLine + count);

  return selected.map((line, i) => `${startLine + i + 1}: ${line}`).join('\n');
};

// ── Tool registration ──

const memoryToolDefs: ToolRegistration[] = [
  {
    name: 'memory_search',
    label: 'Memory Search',
    description:
      'Search memory files using keyword matching (BM25). Returns ranked results with file paths, line ranges, and snippets. Use this to recall prior work, decisions, preferences, or stored knowledge.',
    schema: memorySearchSchema,
    execute: args => executeMemorySearch(args as Parameters<typeof executeMemorySearch>[0]),
  },
  {
    name: 'memory_get',
    label: 'Memory Get',
    description:
      'Read specific lines from a memory or workspace file. Use this after memory_search to get full context around a search result.',
    schema: memoryGetSchema,
    execute: args => executeMemoryGet(args as Parameters<typeof executeMemoryGet>[0]),
  },
];

export {
  memorySearchSchema,
  memoryGetSchema,
  executeMemorySearch,
  executeMemoryGet,
  memoryToolDefs,
};
