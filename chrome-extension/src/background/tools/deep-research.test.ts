/**
 * Unit tests for deep-research tool (deep-research.ts)
 *
 * Tests the thin wrapper that builds a research prompt and delegates to executeSpawnSubagent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Chrome API mock ──
Object.defineProperty(globalThis, 'chrome', {
  value: {
    alarms: { create: vi.fn(), clear: vi.fn(() => Promise.resolve()) },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
  },
  writable: true,
  configurable: true,
});

// ── Mock data ──

const mockToolConfig = {
  enabledTools: { deep_research: true },
  webSearchConfig: {
    provider: 'server' as const,
    browser: { engine: 'google' as const },
  },
  deepResearchConfig: {
    maxSources: 5,
    maxIterations: 2,
    maxDepth: 3,
    timeoutMs: 120_000,
  },
};

// ── Module mocks ──

vi.mock('@extension/storage', () => ({
  toolConfigStorage: {
    get: vi.fn(() => Promise.resolve(JSON.parse(JSON.stringify(mockToolConfig)))),
  },
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve({ enabled: false, level: 'info' })),
    subscribe: vi.fn(),
  },
}));

vi.mock('@extension/shared', () => ({}));

const mockSpawnSubagent = vi.fn<typeof import('./subagent').executeSpawnSubagent>(() =>
  Promise.resolve(JSON.stringify({ runId: 'test-run-id', status: 'spawned' })),
);
vi.mock('./subagent', () => ({
  executeSpawnSubagent: (...args: Parameters<typeof mockSpawnSubagent>) =>
    mockSpawnSubagent(...args),
}));

const mockExecuteWrite = vi.fn<typeof import('./workspace').executeWrite>(() =>
  Promise.resolve(JSON.stringify({ success: true })),
);
vi.mock('./workspace', () => ({
  executeWrite: (args: Parameters<typeof mockExecuteWrite>[0]) => mockExecuteWrite(args),
}));

// ── Import after mocks ──

const { deepResearchSchema, executeDeepResearch, generateWorkspacePath, buildResearchPrompt } =
  await import('./deep-research');

const { Value } = await import('@sinclair/typebox/value');

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteWrite.mockResolvedValue(JSON.stringify({ success: true }));
});

// ── A. Schema Validation ──

describe('deepResearchSchema', () => {
  it('accepts valid input with topic only', () => {
    expect(Value.Check(deepResearchSchema, { topic: 'AI safety' })).toBe(true);
  });

  it('accepts all options', () => {
    expect(
      Value.Check(deepResearchSchema, {
        topic: 'AI safety',
        focusAreas: ['alignment', 'interpretability'],
        saveToWorkspace: false,
      }),
    ).toBe(true);
  });

  it('rejects missing topic', () => {
    expect(Value.Check(deepResearchSchema, {})).toBe(false);
  });
});

// ── B. buildResearchPrompt ──

describe('buildResearchPrompt', () => {
  const defaultConfig = { maxSources: 5, maxIterations: 2, maxDepth: 3, timeoutMs: 120_000 };

  it('includes the topic in the prompt', () => {
    const prompt = buildResearchPrompt({ topic: 'AI safety' }, defaultConfig);
    expect(prompt).toContain('AI safety');
  });

  it('includes focusAreas when provided', () => {
    const prompt = buildResearchPrompt(
      { topic: 'AI safety', focusAreas: ['alignment', 'interpretability'] },
      defaultConfig,
    );
    expect(prompt).toContain('1. alignment');
    expect(prompt).toContain('2. interpretability');
    expect(prompt).toContain('do NOT decompose further');
  });

  it('instructs decomposition when no focusAreas', () => {
    const prompt = buildResearchPrompt({ topic: 'AI safety' }, defaultConfig);
    expect(prompt).toContain('Decompose the topic into up to 3 specific sub-questions');
  });

  it('includes config constraints in the prompt', () => {
    const prompt = buildResearchPrompt(
      { topic: 'Test' },
      { maxSources: 10, maxIterations: 4, maxDepth: 5, timeoutMs: 120_000 },
    );
    expect(prompt).toContain('Maximum sub-questions: 5');
    expect(prompt).toContain('Maximum sources per search: 10');
    expect(prompt).toContain('Maximum search iterations per sub-question: 4');
  });

  it('does not contain save instructions (saving handled by onComplete hook)', () => {
    const prompt = buildResearchPrompt({ topic: 'AI safety' }, defaultConfig);
    expect(prompt).not.toContain('save it to the workspace');
    expect(prompt).not.toContain('Step 4');
    expect(prompt).not.toContain('Save Report');
  });

  it('instructs outputting the report as the final response', () => {
    const prompt = buildResearchPrompt({ topic: 'AI safety' }, defaultConfig);
    expect(prompt).toContain('Output the complete report as your final response');
  });
});

// ── C. executeDeepResearch ──

describe('executeDeepResearch', () => {
  it('calls executeSpawnSubagent with correct tools (no write)', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    expect(mockSpawnSubagent).toHaveBeenCalledTimes(1);
    const [spawnArgs] = mockSpawnSubagent.mock.calls[0];
    expect(spawnArgs.tools).toEqual(['web_search', 'web_fetch']);
  });

  it('passes the research prompt as the task', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    const [spawnArgs] = mockSpawnSubagent.mock.calls[0];
    expect(spawnArgs.task).toContain('AI safety');
    expect(spawnArgs.task).toContain('Deep Research Task');
  });

  it('passes through context (chatId)', async () => {
    await executeDeepResearch({ topic: 'AI safety' }, { chatId: 'chat-123' });

    expect(mockSpawnSubagent).toHaveBeenCalledTimes(1);
    const [, context] = mockSpawnSubagent.mock.calls[0];
    expect(context).toEqual({ chatId: 'chat-123' });
  });

  it('passes undefined context when none provided', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    const [, context] = mockSpawnSubagent.mock.calls[0];
    expect(context).toBeUndefined();
  });

  it('passes options with label and onComplete as third argument', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    expect(mockSpawnSubagent).toHaveBeenCalledTimes(1);
    const [, , options] = mockSpawnSubagent.mock.calls[0];
    expect(options).toBeDefined();
    expect(options!.label).toBe('Deep research: AI safety');
    expect(typeof options!.onComplete).toBe('function');
  });

  it('returns the result from executeSpawnSubagent', async () => {
    const expectedResult = JSON.stringify({ runId: 'abc', status: 'spawned' });
    mockSpawnSubagent.mockResolvedValueOnce(expectedResult);

    const result = await executeDeepResearch({ topic: 'Test' });
    expect(result).toBe(expectedResult);
  });

  it('includes focusAreas in the prompt sent to subagent', async () => {
    await executeDeepResearch({
      topic: 'AI safety',
      focusAreas: ['alignment', 'interpretability'],
    });

    const [spawnArgs] = mockSpawnSubagent.mock.calls[0];
    expect(spawnArgs.task).toContain('alignment');
    expect(spawnArgs.task).toContain('interpretability');
  });

  it('reads config from toolConfigStorage', async () => {
    const { toolConfigStorage } = await import('@extension/storage');
    vi.mocked(toolConfigStorage.get).mockResolvedValueOnce({
      ...mockToolConfig,
      deepResearchConfig: { ...mockToolConfig.deepResearchConfig, maxDepth: 7, maxSources: 15 },
    });

    await executeDeepResearch({ topic: 'Test' });

    const [spawnArgs] = mockSpawnSubagent.mock.calls[0];
    expect(spawnArgs.task).toContain('Maximum sub-questions: 7');
    expect(spawnArgs.task).toContain('Maximum sources per search: 15');
  });

  it('uses defaults when deepResearchConfig is undefined', async () => {
    const { toolConfigStorage } = await import('@extension/storage');
    vi.mocked(toolConfigStorage.get).mockResolvedValueOnce({
      enabledTools: { deep_research: true },
      webSearchConfig: mockToolConfig.webSearchConfig,
    });

    await executeDeepResearch({ topic: 'Test' });

    const [spawnArgs] = mockSpawnSubagent.mock.calls[0];
    // Default maxDepth=3, maxSources=5, maxIterations=2
    expect(spawnArgs.task).toContain('Maximum sub-questions: 3');
    expect(spawnArgs.task).toContain('Maximum sources per search: 5');
    expect(spawnArgs.task).toContain('Maximum search iterations per sub-question: 2');
  });
});

// ── E. onComplete Hook Behavior ──

describe('onComplete hook', () => {
  it('calls executeWrite with workspace path on success', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    const [, , options] = mockSpawnSubagent.mock.calls[0];
    const result = await options!.onComplete!({
      responseText: '# Report\nFindings here',
      runId: 'test-run',
      durationMs: 1000,
    });

    expect(mockExecuteWrite).toHaveBeenCalledOnce();
    const writeArgs = mockExecuteWrite.mock.calls[0][0];
    expect(writeArgs.path).toMatch(/^memory\/research\/.*ai-safety\.md$/);
    expect(writeArgs.content).toBe('# Report\nFindings here');
    expect(writeArgs.mode).toBe('overwrite');
    expect(result?.findings).toContain('Report saved to workspace');
    expect(result?.findings).toContain('# Report\nFindings here');
  });

  it('does not call executeWrite when saveToWorkspace is false', async () => {
    await executeDeepResearch({ topic: 'AI safety', saveToWorkspace: false });

    const [, , options] = mockSpawnSubagent.mock.calls[0];
    const result = await options!.onComplete!({
      responseText: '# Report\nFindings',
      runId: 'test-run',
      durationMs: 1000,
    });

    expect(mockExecuteWrite).not.toHaveBeenCalled();
    expect(result?.findings).not.toContain('Report saved to workspace');
    expect(result?.findings).toBe('# Report\nFindings');
  });

  it('does not call executeWrite on error', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    const [, , options] = mockSpawnSubagent.mock.calls[0];
    const result = await options!.onComplete!({
      responseText: '',
      error: 'LLM timeout',
      runId: 'test-run',
      durationMs: 1000,
    });

    expect(mockExecuteWrite).not.toHaveBeenCalled();
    expect(result?.findings).toContain('LLM timeout');
  });

  it('returns findings with error fallback when responseText is empty', async () => {
    await executeDeepResearch({ topic: 'AI safety' });

    const [, , options] = mockSpawnSubagent.mock.calls[0];
    const result = await options!.onComplete!({
      responseText: '',
      error: 'Something failed',
      runId: 'test-run',
      durationMs: 500,
    });

    expect(result?.findings).toContain('Something failed');
  });
});

// ── D. Workspace Path Format ──

describe('generateWorkspacePath', () => {
  it('generates correct path format', () => {
    const path = generateWorkspacePath('AI Safety Research');
    expect(path).toMatch(/^memory\/research\/\d{4}-\d{2}-\d{2}-ai-safety-research\.md$/);
  });

  it('truncates long topic slugs', () => {
    const longTopic = 'A'.repeat(100);
    const path = generateWorkspacePath(longTopic);
    // Slug portion should be capped at 40 chars
    const slug = path.replace(/^memory\/research\/\d{4}-\d{2}-\d{2}-/, '').replace('.md', '');
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});
