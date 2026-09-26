import { getAgentTools } from './index';
import {
  executeSpawnSubagent,
  executeListSubagents,
  executeKillSubagent,
  runSubagentBackground,
  registry,
  MAX_CONCURRENT,
  SUBAGENT_KEEP_ALIVE_ALARM,
} from './subagent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chrome API mocks
// ---------------------------------------------------------------------------

const chromeMockEvent = () => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  hasListener: vi.fn(),
});
Object.defineProperty(globalThis, 'chrome', {
  value: {
    alarms: { create: vi.fn(), clear: vi.fn(() => Promise.resolve()) },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()), onMessage: chromeMockEvent() },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 1 })),
      remove: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve({ id: 1 })),
      update: vi.fn(() => Promise.resolve({})),
      onRemoved: chromeMockEvent(),
      onUpdated: chromeMockEvent(),
      onActivated: chromeMockEvent(),
    },
    debugger: {
      onDetach: chromeMockEvent(),
      onEvent: chromeMockEvent(),
      attach: vi.fn(() => Promise.resolve()),
      detach: vi.fn(() => Promise.resolve()),
      sendCommand: vi.fn(() => Promise.resolve({})),
    },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      session: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      onChanged: chromeMockEvent(),
    },
    windows: { getAll: vi.fn(() => Promise.resolve([])), onRemoved: chromeMockEvent() },
  },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRunAgent = vi.fn(async () => ({
  responseText: 'Research findings here',
  parts: [],
  usage: { inputTokens: 100, outputTokens: 50 },
  agent: {},
  stepCount: 1,
  timedOut: false,
  retryAttempts: 0,
}));

vi.mock('../agents/agent-setup', () => ({
  resolveDefaultModel: vi.fn(async () => ({
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    routingMode: 'direct',
  })),
  runAgent: (args: unknown) => mockRunAgent(args),
}));

vi.mock('@extension/shared', () => ({
  buildSystemPrompt: vi.fn(() => ({ text: 'system prompt' })),
  resolveToolPromptHints: vi.fn(() => []),
  resolveToolListings: vi.fn(() => []),
}));

const mockAddMessage = vi.fn(async () => {});

vi.mock('@extension/storage', () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
  saveArtifact: vi.fn(async () => {}),
  toolConfigStorage: {
    get: vi.fn(async () => ({
      enabledTools: {
        web_search: true,
        web_fetch: true,
        write: true,
        read: true,
        edit: true,
        list: true,
      },
    })),
  },
}));

vi.mock('./index', () => ({
  getAgentTools: vi.fn(async () => [
    { name: 'web_search' },
    { name: 'web_fetch' },
    { name: 'write' },
    { name: 'read' },
  ]),
  getToolConfig: vi.fn(async () => ({
    enabledTools: {
      web_search: true,
      web_fetch: true,
      write: true,
      read: true,
      edit: true,
      list: true,
    },
  })),
  getImplementedToolNames: vi.fn(
    () => new Set(['web_search', 'web_fetch', 'write', 'read', 'edit', 'list']),
  ),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subagent tool', () => {
  beforeEach(() => {
    registry.clear();
    vi.clearAllMocks();
    mockRunAgent.mockResolvedValue({
      responseText: 'Research findings here',
      parts: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      agent: {},
      stepCount: 1,
      timedOut: false,
      retryAttempts: 0,
    });
  });

  afterEach(() => {
    registry.clear();
  });

  describe('executeSpawnSubagent — non-blocking', () => {
    it('cancels its background agent with the parent and skips completion hooks', async () => {
      const controller = new AbortController();
      const onComplete = vi.fn();
      let childSignal: AbortSignal | undefined;
      mockRunAgent.mockImplementationOnce((opts: { signal: AbortSignal }) => {
        childSignal = opts.signal;
        return new Promise((_, reject) =>
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true }),
        );
      });
      const result = JSON.parse(
        await executeSpawnSubagent(
          { task: 'research' },
          { chatId: 'cancel-chat', signal: controller.signal },
          { onComplete },
        ),
      );
      await vi.waitFor(() => expect(childSignal).toBeDefined());
      controller.abort();
      await vi.waitFor(() => expect(registry.get(result.runId)?.status).toBe('cancelled'));
      expect(childSignal?.aborted).toBe(true);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('returns immediately with status "spawned"', async () => {
      const result = JSON.parse(await executeSpawnSubagent({ task: 'research AI' }));

      expect(result.status).toBe('spawned');
      expect(result.runId).toBeDefined();
      expect(result.task).toBe('research AI');
    });

    it('registers the run in the registry as running', async () => {
      const result = JSON.parse(await executeSpawnSubagent({ task: 'test task' }));

      const run = registry.get(result.runId);
      expect(run).toBeDefined();
      expect(run!.status).toBe('running');
    });

    it('rejects when max concurrent reached', async () => {
      // Fill registry with running subagents
      for (let i = 0; i < MAX_CONCURRENT; i++) {
        registry.set(`run-${i}`, {
          runId: `run-${i}`,
          task: `task ${i}`,
          status: 'running',
          startedAt: Date.now(),
          abortController: new AbortController(),
        });
      }

      const result = JSON.parse(await executeSpawnSubagent({ task: 'one too many' }));

      expect(result.status).toBe('error');
      expect(result.error).toContain('Max concurrent');
    });
  });

  describe('runSubagentBackground', () => {
    it('completes run and updates registry', async () => {
      const run = {
        runId: 'test-run-1',
        task: 'research AI',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'research AI' });

      expect(run.status).toBe('completed');
      expect(run.findings).toBe('Research findings here');
      expect(run.usage).toEqual({ input: 100, output: 50 });
      expect(run.completedAt).toBeDefined();
    });

    it('injects system message when chatId is provided', async () => {
      const run = {
        runId: 'test-run-2',
        task: 'research AI',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'research AI' }, 'chat-123');

      expect(mockAddMessage).toHaveBeenCalledOnce();
      const msg = mockAddMessage.mock.calls[0][0];
      expect(msg.chatId).toBe('chat-123');
      expect(msg.role).toBe('system');
      expect(msg.parts[0].text).toContain('[subagent-result runId=test-run-2]');
      expect(msg.parts[0].text).toContain('Research findings here');
    });

    it('builds tools with the parent chatId so browser tabs join the parent run group', async () => {
      const run = {
        runId: 'test-run-chat-tools',
        task: 'research AI',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'research AI' }, 'chat-123');

      expect(getAgentTools).toHaveBeenCalledWith({ headless: true, chatId: 'chat-123' });
    });

    it('broadcasts SUBAGENT_COMPLETE when chatId is provided', async () => {
      const run = {
        runId: 'test-run-3',
        task: 'research AI',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'research AI' }, 'chat-456');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBAGENT_COMPLETE',
          chatId: 'chat-456',
          runId: 'test-run-3',
          task: 'research AI',
          findings: 'Research findings here',
        }),
      );
    });

    it('does not inject message or broadcast when chatId is absent', async () => {
      const run = {
        runId: 'test-run-4',
        task: 'research AI',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'research AI' });

      expect(mockAddMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('handles runAgent failure gracefully', async () => {
      mockRunAgent.mockRejectedValueOnce(new Error('LLM timeout'));

      const run = {
        runId: 'test-run-5',
        task: 'failing task',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'failing task' }, 'chat-err');

      expect(run.status).toBe('failed');
      expect(run.error).toBe('LLM timeout');

      // Should still inject error message
      expect(mockAddMessage).toHaveBeenCalledOnce();
      const msg = mockAddMessage.mock.calls[0][0];
      expect(msg.parts[0].text).toContain('Error: LLM timeout');
    });

    it('broadcasts SUBAGENT_PROGRESS events during execution', async () => {
      // Make mockRunAgent invoke the callbacks
      mockRunAgent.mockImplementationOnce(async (opts: Record<string, unknown>) => {
        const onToolCallEnd = opts.onToolCallEnd as
          | ((tc: { id: string; name: string; args: Record<string, unknown> }) => void)
          | undefined;
        const onToolResult = opts.onToolResult as
          | ((tr: {
              toolCallId: string;
              toolName: string;
              result: unknown;
              isError: boolean;
            }) => void)
          | undefined;
        const onTurnEnd = opts.onTurnEnd as
          | ((info: {
              stepCount: number;
              usage: { input: number; output: number };
              message: unknown;
            }) => void)
          | undefined;

        onToolCallEnd?.({ id: 'tc1', name: 'web_search', args: { query: 'test' } });
        onToolResult?.({
          toolCallId: 'tc1',
          toolName: 'web_search',
          result: 'search results here',
          isError: false,
        });
        onTurnEnd?.({ stepCount: 1, usage: { input: 50, output: 25 }, message: {} });

        return {
          responseText: 'done',
          parts: [],
          usage: { inputTokens: 50, outputTokens: 25 },
          agent: {},
          stepCount: 1,
          timedOut: false,
          retryAttempts: 0,
        };
      });

      const run = {
        runId: 'test-progress',
        task: 'progress test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'progress test' }, 'chat-prog');

      // Filter SUBAGENT_PROGRESS calls
      const progressCalls = (
        chrome.runtime.sendMessage as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'SUBAGENT_PROGRESS',
      );

      // Should have: started, tool_start, tool_done, turn_end
      expect(progressCalls.length).toBe(4);
      expect(progressCalls[0][0]).toMatchObject({ event: 'started', runId: 'test-progress' });
      expect(progressCalls[1][0]).toMatchObject({
        event: 'tool_start',
        toolCallId: 'tc1',
        toolName: 'web_search',
        args: '{"query":"test"}',
      });
      expect(progressCalls[2][0]).toMatchObject({
        event: 'tool_done',
        toolCallId: 'tc1',
        toolName: 'web_search',
        isError: false,
        result: 'search results here',
      });
      expect(progressCalls[3][0]).toMatchObject({ event: 'turn_end', stepCount: 1 });
    });

    it('truncates large args/result payloads in progress broadcasts', async () => {
      const largePayload = 'x'.repeat(3000);
      mockRunAgent.mockImplementationOnce(async (opts: Record<string, unknown>) => {
        const onToolCallEnd = opts.onToolCallEnd as
          | ((tc: { id: string; name: string; args: Record<string, unknown> }) => void)
          | undefined;
        const onToolResult = opts.onToolResult as
          | ((tr: {
              toolCallId: string;
              toolName: string;
              result: unknown;
              isError: boolean;
            }) => void)
          | undefined;

        onToolCallEnd?.({ id: 'tc-big', name: 'web_fetch', args: { url: largePayload } });
        onToolResult?.({
          toolCallId: 'tc-big',
          toolName: 'web_fetch',
          result: largePayload,
          isError: false,
        });

        return {
          responseText: 'done',
          parts: [],
          usage: { inputTokens: 50, outputTokens: 25 },
          agent: {},
          stepCount: 1,
          timedOut: false,
          retryAttempts: 0,
        };
      });

      const run = {
        runId: 'test-truncate',
        task: 'truncation test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'truncation test' }, 'chat-trunc');

      const progressCalls = (
        chrome.runtime.sendMessage as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'SUBAGENT_PROGRESS',
      );

      // tool_start args should be truncated
      const toolStartMsg = progressCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).event === 'tool_start',
      );
      expect(toolStartMsg).toBeDefined();
      const argsStr = (toolStartMsg![0] as Record<string, unknown>).args as string;
      expect(argsStr.length).toBeLessThanOrEqual(2020); // 2000 + '…[truncated]'
      expect(argsStr).toContain('…[truncated]');

      // tool_done result should be truncated
      const toolDoneMsg = progressCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).event === 'tool_done',
      );
      expect(toolDoneMsg).toBeDefined();
      const resultStr = (toolDoneMsg![0] as Record<string, unknown>).result as string;
      expect(resultStr.length).toBeLessThanOrEqual(2020);
      expect(resultStr).toContain('…[truncated]');
    });

    it('does not broadcast SUBAGENT_PROGRESS when chatId is absent', async () => {
      mockRunAgent.mockImplementationOnce(async (opts: Record<string, unknown>) => {
        const onToolCallEnd = opts.onToolCallEnd as
          | ((tc: { id: string; name: string; args: Record<string, unknown> }) => void)
          | undefined;
        onToolCallEnd?.({ id: 'tc1', name: 'web_search', args: {} });

        return {
          responseText: 'done',
          parts: [],
          usage: { inputTokens: 50, outputTokens: 25 },
          agent: {},
          stepCount: 1,
          timedOut: false,
          retryAttempts: 0,
        };
      });

      const run = {
        runId: 'test-no-progress',
        task: 'no chat id',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'no chat id' });

      // No messages should have been sent at all (no chatId)
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('manages keep-alive alarm lifecycle', async () => {
      const run = {
        runId: 'test-run-6',
        task: 'alarm test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'alarm test' });

      // Alarm should have been created then cleared
      expect(chrome.alarms.create).toHaveBeenCalledWith(SUBAGENT_KEEP_ALIVE_ALARM, {
        periodInMinutes: 0.4,
      });
      expect(chrome.alarms.clear).toHaveBeenCalledWith(SUBAGENT_KEEP_ALIVE_ALARM);
    });
  });

  describe('SpawnSubagentOptions', () => {
    it('uses label in spawn result instead of raw task', async () => {
      const result = JSON.parse(
        await executeSpawnSubagent({ task: 'very long raw task prompt...' }, undefined, {
          label: 'Short label',
        }),
      );

      expect(result.task).toBe('Short label');
      expect(result.status).toBe('spawned');
    });

    it('stores label as run.task in registry', async () => {
      const result = JSON.parse(
        await executeSpawnSubagent({ task: 'raw task' }, undefined, { label: 'Display label' }),
      );

      const run = registry.get(result.runId);
      expect(run!.task).toBe('Display label');
    });

    it('uses label in system message Task: line', async () => {
      const run = {
        runId: 'label-test',
        task: 'Display label',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'raw long prompt' }, 'chat-label', {
        label: 'Display label',
      });

      const msg = mockAddMessage.mock.calls[0][0];
      expect(msg.parts[0].text).toContain('Task: Display label');
      expect(msg.parts[0].text).not.toContain('raw long prompt');
    });

    it('uses label in SUBAGENT_COMPLETE broadcast', async () => {
      const run = {
        runId: 'label-broadcast',
        task: 'Display label',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'raw task' }, 'chat-bc', { label: 'Display label' });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBAGENT_COMPLETE',
          task: 'Display label',
        }),
      );
    });

    it('calls onComplete hook with correct args after success', async () => {
      const onComplete = vi.fn(async () => ({ findings: 'Modified findings' }));
      const run = {
        runId: 'hook-test',
        task: 'test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'test' }, 'chat-hook', { onComplete });

      expect(onComplete).toHaveBeenCalledOnce();
      const hookArgs = onComplete.mock.calls[0][0];
      expect(hookArgs.responseText).toBe('Research findings here');
      expect(hookArgs.runId).toBe('hook-test');
      expect(hookArgs.durationMs).toBeGreaterThanOrEqual(0);
      expect(hookArgs.error).toBeUndefined();
    });

    it('uses hook-returned findings in system message', async () => {
      const onComplete = vi.fn(async () => ({ findings: 'Custom findings from hook' }));
      const run = {
        runId: 'hook-findings',
        task: 'test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'test' }, 'chat-hf', { onComplete });

      const msg = mockAddMessage.mock.calls[0][0];
      expect(msg.parts[0].text).toContain('Custom findings from hook');
    });

    it('calls onComplete with error info on failure', async () => {
      mockRunAgent.mockRejectedValueOnce(new Error('LLM exploded'));
      const onComplete = vi.fn(async () => {});

      const run = {
        runId: 'hook-error',
        task: 'test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      await runSubagentBackground(run, { task: 'test' }, 'chat-err', { onComplete });

      expect(onComplete).toHaveBeenCalledOnce();
      const hookArgs = onComplete.mock.calls[0][0];
      expect(hookArgs.error).toBe('LLM exploded');
      expect(hookArgs.responseText).toBe('');
    });

    it('catches onComplete hook errors without crashing the run', async () => {
      const onComplete = vi.fn(async () => {
        throw new Error('hook kaboom');
      });
      const run = {
        runId: 'hook-crash',
        task: 'test',
        status: 'running' as const,
        startedAt: Date.now(),
        abortController: new AbortController(),
      };
      registry.set(run.runId, run);

      // Should not throw
      await runSubagentBackground(run, { task: 'test' }, 'chat-crash', { onComplete });

      expect(run.status).toBe('completed');
      // System message still injected with default findings
      expect(mockAddMessage).toHaveBeenCalledOnce();
      const msg = mockAddMessage.mock.calls[0][0];
      expect(msg.parts[0].text).toContain('Research findings here');
    });

    it('falls back to args.task when no label option is provided', async () => {
      const result = JSON.parse(await executeSpawnSubagent({ task: 'plain task' }));

      expect(result.task).toBe('plain task');
    });
  });

  describe('executeListSubagents', () => {
    it('returns all registered runs', async () => {
      registry.set('r1', {
        runId: 'r1',
        task: 'task 1',
        status: 'running',
        startedAt: Date.now(),
        abortController: new AbortController(),
      });
      registry.set('r2', {
        runId: 'r2',
        task: 'task 2',
        status: 'completed',
        startedAt: Date.now() - 5000,
        completedAt: Date.now(),
        abortController: new AbortController(),
        findings: 'done',
      });

      const result = JSON.parse(await executeListSubagents());

      expect(result.count).toBe(2);
      expect(result.runs).toHaveLength(2);
    });
  });

  describe('executeKillSubagent', () => {
    it('cancels a running subagent', async () => {
      const ac = new AbortController();
      registry.set('kill-me', {
        runId: 'kill-me',
        task: 'long task',
        status: 'running',
        startedAt: Date.now(),
        abortController: ac,
      });

      const result = JSON.parse(await executeKillSubagent({ runId: 'kill-me' }));

      expect(result.status).toBe('ok');
      expect(ac.signal.aborted).toBe(true);
      expect(registry.get('kill-me')!.status).toBe('cancelled');
    });

    it('returns error for non-existent run', async () => {
      const result = JSON.parse(await executeKillSubagent({ runId: 'nope' }));

      expect(result.status).toBe('error');
      expect(result.error).toContain('No subagent found');
    });

    it('returns error for non-running subagent', async () => {
      registry.set('done', {
        runId: 'done',
        task: 'finished',
        status: 'completed',
        startedAt: Date.now(),
        completedAt: Date.now(),
        abortController: new AbortController(),
      });

      const result = JSON.parse(await executeKillSubagent({ runId: 'done' }));

      expect(result.status).toBe('error');
      expect(result.error).toContain('not running');
    });
  });
});
