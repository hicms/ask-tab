/**
 * Tests for agent-setup.ts
 * Covers: dbModelToChatModel, resolveDefaultModel, runAgent lifecycle
 */

// ── Imports (after mocks) ──────────────────────────────

import {
  dbModelToChatModel,
  resolveDefaultModel,
  runAgent,
  extractResponseFromToolResult,
  runHeadlessLLM,
} from './agent-setup';
import { watchSession } from '../ask-service/client';
import { hasOversizedToolResults } from '../context/tool-result-truncation';
import { classifyError } from '../errors/error-classification';
import { beginAgentTabGroup, endAgentTabGroup } from '../tools/agent-tab-group';
import {
  serverModelsStorage,
  selectedModelStorage,
  createChat,
  addMessage,
  touchChat,
  updateSessionTokens,
} from '@extension/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatModel } from '@extension/shared';
import type { DbChatModel } from '@extension/storage';

// ── Mock Agent state shared between mock factory and tests ─────

let mockAgentState: { error?: string } = { error: undefined };
let mockPromptFn: ReturnType<typeof vi.fn> = vi.fn(async () => {});

// ── Mocks ──────────────────────────────────────────────

vi.mock('./agent', () => {
  class MockAgent {
    state = mockAgentState;
    subscribe = vi.fn();
    prompt = mockPromptFn;
    abort = vi.fn();
    constructor() {
      // Re-read mutable state so each test can configure it
      this.state = mockAgentState;
      this.prompt = mockPromptFn;
    }
  }
  return { Agent: MockAgent };
});

vi.mock('./model-adapter', () => ({
  chatModelToPiModel: vi.fn(() => ({
    model: {
      id: 'test',
      name: 'Test',
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: 'http://ask.test/api/llm/test',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 32000,
    },
  })),
}));

vi.mock('./stream-bridge', () => ({
  createStreamFn: vi.fn(() => vi.fn()),
}));

vi.mock('../context/transform', () => ({
  createTransformContext: vi.fn(() => ({
    transformContext: vi.fn(async (msgs: unknown[]) => msgs),
    getResult: () => ({ wasCompacted: false }),
  })),
}));

vi.mock('../errors/error-classification', () => ({
  classifyError: vi.fn(() => 'unknown'),
  isCompactionFailureError: vi.fn(() => false),
  parseProviderTokenLimit: vi.fn(() => undefined),
}));

vi.mock('../context/tool-result-truncation', () => ({
  hasOversizedToolResults: vi.fn(() => false),
  truncateToolResults: vi.fn((msgs: unknown[]) => ({ messages: msgs, truncatedCount: 0 })),
}));

vi.mock('../ask-service/client', () => ({
  requireSession: vi.fn(async () => ({
    token: 'test-jwt',
    userId: 'u',
    email: 'test@example.com',
    expiresAt: Date.now() + 60000,
  })),
  watchSession: vi.fn(() => () => {}),
}));

vi.mock('../tools', () => ({
  getAgentTools: vi.fn(async () => []),
  getToolConfig: vi.fn(async () => ({ enabledTools: [] })),
  getImplementedToolNames: vi.fn(() => new Set<string>()),
}));

vi.mock('../tools/agent-tab-group', () => ({
  beginAgentTabGroup: vi.fn(async () => {}),
  endAgentTabGroup: vi.fn(),
}));

vi.mock('@extension/shared', () => ({
  buildSystemPrompt: vi.fn(() => ({ text: 'system prompt' })),
  resolveToolPromptHints: vi.fn(() => []),
  resolveToolListings: vi.fn(() => []),
}));

vi.mock('@extension/storage', () => ({
  serverModelsStorage: { get: vi.fn(async () => []) },
  selectedModelStorage: { get: vi.fn(async () => null) },
  getAgent: vi.fn(async () => undefined),
  getEnabledWorkspaceFiles: vi.fn(async () => []),
  getEnabledSkills: vi.fn(async () => []),
  createChat: vi.fn(async () => {}),
  addMessage: vi.fn(async () => {}),
  saveModelTranscript: vi.fn(async () => {}),
  finishModelTurn: vi.fn(async () => {}),
  touchChat: vi.fn(async () => {}),
  updateSessionTokens: vi.fn(async () => {}),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('nanoid', () => ({ nanoid: () => 'test-id-123' }));

// ── Helpers ────────────────────────────────────────────

const makeDbModel = (overrides: Partial<DbChatModel> = {}): DbChatModel => ({
  id: 'db-id-1',
  modelId: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'custom',
  description: 'OpenAI GPT-4o',
  supportsTools: true,
  supportsReasoning: false,
  supportsImages: false,
  toolTimeoutSeconds: 300,
  ...overrides,
});

const makeChatModel = (overrides: Partial<ChatModel> = {}): ChatModel => ({
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'custom',
  supportsTools: true,
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────

describe('agent-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared mock state
    mockAgentState = { error: undefined };
    mockPromptFn = vi.fn(async () => {});
  });

  // ── dbModelToChatModel ───────────────────────────────

  describe('dbModelToChatModel', () => {
    it('maps public model fields without credentials', () => {
      const dbModel = makeDbModel();
      const result = dbModelToChatModel(dbModel);

      expect(result).toEqual({
        id: 'gpt-4o',
        dbId: 'db-id-1',
        name: 'GPT-4o',
        provider: 'custom',
        description: 'OpenAI GPT-4o',
        supportsTools: true,
        supportsReasoning: false,
        supportsImages: false,
        toolTimeoutSeconds: 300,
        contextWindow: undefined,
      });
    });

    it('uses modelId as id (not db id)', () => {
      const dbModel = makeDbModel({ id: 'db-uuid-123', modelId: 'claude-sonnet-4-20250514' });
      const result = dbModelToChatModel(dbModel);

      expect(result.id).toBe('claude-sonnet-4-20250514');
    });

    it('handles optional fields being undefined', () => {
      const dbModel = makeDbModel({
        description: undefined,
        supportsTools: undefined,
        supportsReasoning: undefined,
        supportsImages: undefined,
        toolTimeoutSeconds: undefined,
      });
      const result = dbModelToChatModel(dbModel);

      expect(result.description).toBeUndefined();
      expect(result.supportsTools).toBeUndefined();
      expect(result.supportsReasoning).toBeUndefined();
      expect(result.supportsImages).toBeUndefined();
      expect('baseUrl' in result).toBe(false);
      expect(result.toolTimeoutSeconds).toBeUndefined();
    });
  });

  // ── resolveDefaultModel ──────────────────────────────

  describe('resolveDefaultModel', () => {
    it('returns null when no models are stored', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue([]);

      const result = await resolveDefaultModel();
      expect(result).toBeNull();
    });

    it('returns null when models is null-ish', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue(null as never);

      const result = await resolveDefaultModel();
      expect(result).toBeNull();
    });

    it('returns selected model when selectedId matches by id', async () => {
      const models = [
        makeDbModel({ id: 'id-a', modelId: 'model-a', name: 'Model A' }),
        makeDbModel({ id: 'id-b', modelId: 'model-b', name: 'Model B' }),
      ];
      vi.mocked(serverModelsStorage.get).mockResolvedValue(models);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('id-b');

      const result = await resolveDefaultModel();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('model-b');
      expect(result!.name).toBe('Model B');
    });

    it('falls back to the first model when selectedId is not a catalog ID', async () => {
      const models = [
        makeDbModel({ id: 'id-a', modelId: 'model-a', name: 'Model A' }),
        makeDbModel({ id: 'id-b', modelId: 'model-b', name: 'Model B' }),
      ];
      vi.mocked(serverModelsStorage.get).mockResolvedValue(models);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('model-b');

      const result = await resolveDefaultModel();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('model-a');
    });

    it('falls back to first model when no selectedId', async () => {
      const models = [
        makeDbModel({ id: 'id-a', modelId: 'model-a', name: 'Model A' }),
        makeDbModel({ id: 'id-b', modelId: 'model-b', name: 'Model B' }),
      ];
      vi.mocked(serverModelsStorage.get).mockResolvedValue(models);
      vi.mocked(selectedModelStorage.get).mockResolvedValue(undefined as unknown as string);

      const result = await resolveDefaultModel();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('model-a');
      expect(result!.name).toBe('Model A');
    });

    it('falls back to first model when selectedId does not match any model', async () => {
      const models = [makeDbModel({ id: 'id-a', modelId: 'model-a', name: 'Model A' })];
      vi.mocked(serverModelsStorage.get).mockResolvedValue(models);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('nonexistent-id');

      const result = await resolveDefaultModel();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('model-a');
    });
  });

  // ── runAgent ─────────────────────────────────────────

  describe('runAgent', () => {
    it('opens and releases the agent tab group around a successful run', async () => {
      await runAgent({
        model: makeChatModel(),
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
        chatId: 'chat-1',
      });

      expect(beginAgentTabGroup).toHaveBeenCalledTimes(1);
      expect(beginAgentTabGroup).toHaveBeenCalledWith('chat-1', 'Hello');
      expect(endAgentTabGroup).toHaveBeenCalledTimes(1);
      expect(endAgentTabGroup).toHaveBeenCalledWith('chat-1');
      expect(watchSession).toHaveBeenCalledTimes(1);
      expect(vi.mocked(beginAgentTabGroup).mock.invocationCallOrder[0]).toBeLessThan(
        mockPromptFn.mock.invocationCallOrder[0]!,
      );
      expect(vi.mocked(endAgentTabGroup).mock.invocationCallOrder[0]).toBeGreaterThan(
        mockPromptFn.mock.invocationCallOrder[0]!,
      );
    });

    it('releases the agent tab group on early error returns and aborts', async () => {
      mockPromptFn = vi.fn(async () => {
        mockAgentState.error = 'Some API error occurred';
      });
      vi.mocked(classifyError).mockReturnValue('rate-limit' as never);
      await runAgent({
        model: makeChatModel(),
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
        chatId: 'chat-1',
      });

      const controller = new AbortController();
      controller.abort();
      await runAgent({
        model: makeChatModel(),
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
        chatId: 'chat-2',
        signal: controller.signal,
      });

      expect(beginAgentTabGroup).toHaveBeenCalledTimes(2);
      expect(endAgentTabGroup).toHaveBeenNthCalledWith(1, 'chat-1');
      expect(endAgentTabGroup).toHaveBeenNthCalledWith(2, 'chat-2');
    });

    it('releases the agent tab group when the attempt throws', async () => {
      mockPromptFn = vi.fn(async () => {
        throw new Error('network down');
      });

      await expect(
        runAgent({
          model: makeChatModel(),
          systemPrompt: 'You are helpful.',
          prompt: 'Hello',
          chatId: 'chat-1',
        }),
      ).rejects.toThrow('network down');

      expect(endAgentTabGroup).toHaveBeenCalledWith('chat-1');
    });

    it('returns response text on success', async () => {
      const model = makeChatModel();

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
      });

      // Agent.prompt was called
      expect(mockPromptFn).toHaveBeenCalledWith('Hello');

      // No error, retryAttempts is 0
      expect(result.error).toBeUndefined();
      expect(result.retryAttempts).toBe(0);
      // Default fallback text when agent produces no output
      expect(result.responseText).toBe('(No response generated)');
    });

    it('returns aborted result when signal is already aborted', async () => {
      const model = makeChatModel();
      const controller = new AbortController();
      controller.abort();

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
        signal: controller.signal,
      });

      expect(result.responseText).toBe('(Request was aborted)');
      expect(result.error).toBe('Request was aborted');
      expect(result.errorCategory).toBe('unknown');
    });

    it('sets errorCategory on error', async () => {
      // Configure the mock agent to set an error during prompt
      mockAgentState = { error: undefined };
      mockPromptFn = vi.fn(async () => {
        mockAgentState.error = 'Some API error occurred';
      });
      vi.mocked(classifyError).mockReturnValue('rate-limit' as never);

      const model = makeChatModel();

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
      });

      expect(result.error).toBe('Some API error occurred');
      expect(result.errorCategory).toBe('rate-limit');
      expect(classifyError).toHaveBeenCalledWith('Some API error occurred');
    });

    it('returns stepCount 0 and empty parts when agent produces no events', async () => {
      const model = makeChatModel();

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
      });

      expect(result.stepCount).toBe(0);
      expect(result.parts).toEqual([]);
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    it('does not retry on non-context-overflow errors', async () => {
      // Configure the mock agent to set an error during prompt
      mockAgentState = { error: undefined };
      mockPromptFn = vi.fn(async () => {
        mockAgentState.error = 'Authentication failed';
      });
      vi.mocked(classifyError).mockReturnValue('auth' as never);

      const model = makeChatModel();
      const onRetry = vi.fn();

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
        onRetry,
      });

      // Should NOT retry — auth errors are not retryable
      expect(onRetry).not.toHaveBeenCalled();
      expect(result.retryAttempts).toBe(0);
      expect(result.errorCategory).toBe('auth');
    });

    it('retries on context-overflow with compaction strategy', async () => {
      let callCount = 0;
      mockAgentState = { error: undefined };
      mockPromptFn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          mockAgentState.error = 'Context window overflow';
        } else {
          mockAgentState.error = undefined;
        }
      });
      vi.mocked(classifyError).mockReturnValueOnce('context-overflow' as never);
      vi.mocked(hasOversizedToolResults).mockReturnValue(false);

      const model = makeChatModel();
      const onRetry = vi.fn();

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'compaction',
        }),
      );
      expect(result.retryAttempts).toBe(1);
      expect(result.error).toBeUndefined();
    });
  });

  // ── extractResponseFromToolResult ──────────────────

  describe('extractResponseFromToolResult', () => {
    it('extracts report field from JSON', () => {
      const raw = JSON.stringify({ report: 'Here is the report.' });
      expect(extractResponseFromToolResult(raw)).toBe('Here is the report.');
    });

    it('extracts output field from JSON', () => {
      const raw = JSON.stringify({ output: 'Command output here' });
      expect(extractResponseFromToolResult(raw)).toBe('Command output here');
    });

    it('extracts text field from JSON', () => {
      const raw = JSON.stringify({ text: 'Some text result' });
      expect(extractResponseFromToolResult(raw)).toBe('Some text result');
    });

    it('extracts content field from JSON', () => {
      const raw = JSON.stringify({ content: 'Content value' });
      expect(extractResponseFromToolResult(raw)).toBe('Content value');
    });

    it('extracts result field from JSON', () => {
      const raw = JSON.stringify({ result: 'Result value' });
      expect(extractResponseFromToolResult(raw)).toBe('Result value');
    });

    it('returns raw string for JSON with no known fields', () => {
      const raw = JSON.stringify({ custom: 'data', count: 5 });
      expect(extractResponseFromToolResult(raw)).toBe(raw);
    });

    it('returns raw string for non-JSON input', () => {
      const raw = 'This is plain text, not JSON';
      expect(extractResponseFromToolResult(raw)).toBe(raw);
    });

    it('skips empty string fields and returns raw', () => {
      const raw = JSON.stringify({ report: '', output: '', other: 'data' });
      expect(extractResponseFromToolResult(raw)).toBe(raw);
    });

    it('prefers report over output when both present', () => {
      const raw = JSON.stringify({ report: 'Report text', output: 'Output text' });
      expect(extractResponseFromToolResult(raw)).toBe('Report text');
    });
  });

  // ── runHeadlessLLM ────────────────────────────────

  describe('runHeadlessLLM', () => {
    it('returns error when no model is configured', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue([]);
      vi.mocked(selectedModelStorage.get).mockResolvedValue(null as never);

      const result = await runHeadlessLLM({
        message: 'Hello',
        chatTitle: 'Test Chat',
      });

      expect(result.status).toBe('error');
      expect(result.error).toBe('No model configured');
      expect(result.chatId).toBe('');
    });

    it('creates chat, saves messages, and returns ok on success', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue([
        makeDbModel({ id: 'm1', modelId: 'gpt-4o' }),
      ]);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('gpt-4o');

      const result = await runHeadlessLLM({
        message: 'What is 2+2?',
        chatTitle: 'Math Question',
      });

      expect(result.status).toBe('ok');
      expect(result.chatId).toBe('test-id-123');
      expect(createChat).toHaveBeenCalled();
      expect(addMessage).toHaveBeenCalled();
      expect(touchChat).toHaveBeenCalled();
    });

    it('saves error message when agent throws', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue([
        makeDbModel({ id: 'm1', modelId: 'gpt-4o' }),
      ]);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('gpt-4o');
      mockPromptFn = vi.fn(async () => {
        throw new Error('LLM connection failed');
      });

      const result = await runHeadlessLLM({
        message: 'Hello',
        chatTitle: 'Failing Chat',
      });

      expect(result.status).toBe('error');
      expect(result.error).toBe('LLM connection failed');
      // Error message should be saved
      expect(addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          parts: expect.arrayContaining([
            expect.objectContaining({ text: expect.stringContaining('Error:') }),
          ]),
        }),
      );
      expect(touchChat).toHaveBeenCalled();
    });

    it('uses provided model instead of resolving from storage', async () => {
      const customModel = makeChatModel({ id: 'custom', name: 'Custom' });

      const result = await runHeadlessLLM({
        message: 'Hello',
        chatTitle: 'Custom Model Chat',
        model: customModel,
      });

      expect(result.status).toBe('ok');
      // Should not have tried to resolve from storage
      expect(serverModelsStorage.get).not.toHaveBeenCalled();
    });

    it('saves error message when runAgent returns error in result', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue([
        makeDbModel({ id: 'm1', modelId: 'gpt-4o' }),
      ]);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('gpt-4o');

      // Mock agent to set a non-retryable error during prompt
      mockAgentState = { error: 'Authentication failed: invalid key' };
      vi.mocked(classifyError).mockReturnValue('auth' as never);

      const result = await runHeadlessLLM({
        message: 'Hello',
        chatTitle: 'Error Chat',
      });

      expect(result.status).toBe('error');
      expect(result.error).toBe('Authentication failed: invalid key');
      expect(result.chatId).toBe('test-id-123');
      // Error message saved to DB
      expect(addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          parts: expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining('Error:'),
            }),
          ]),
        }),
      );
      expect(touchChat).toHaveBeenCalledWith('test-id-123');
    });

    it('does not update session tokens when usage is zero', async () => {
      vi.mocked(serverModelsStorage.get).mockResolvedValue([
        makeDbModel({ id: 'm1', modelId: 'gpt-4o' }),
      ]);
      vi.mocked(selectedModelStorage.get).mockResolvedValue('gpt-4o');

      // Mock Agent's subscribe/prompt don't simulate events,
      // so runAgent returns { usage: { inputTokens: 0, outputTokens: 0 } }
      // and totalTokens = 0 — updateSessionTokens should NOT be called.
      const result = await runHeadlessLLM({
        message: 'Hello',
        chatTitle: 'Usage Chat',
      });

      expect(result.status).toBe('ok');
      expect(updateSessionTokens).not.toHaveBeenCalled();
    });
  });

  // ── runAgent with prompt as AgentMessage ──────────

  describe('runAgent with AgentMessage prompt', () => {
    it('accepts AgentMessage object as prompt', async () => {
      const model = makeChatModel();
      const promptMsg = {
        role: 'user' as const,
        content: 'Hello from message object',
        timestamp: Date.now(),
      };

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: promptMsg,
      });

      expect(mockPromptFn).toHaveBeenCalledWith(promptMsg);
      expect(result.error).toBeUndefined();
    });
  });

  // ── runAgent with tools disabled ──────────────────

  describe('runAgent with local provider', () => {
    it('does not load tools when provider is local', async () => {
      const model = makeChatModel({ provider: 'local' as never, supportsTools: false });

      const result = await runAgent({
        model,
        systemPrompt: 'You are helpful.',
        prompt: 'Hello',
      });

      expect(result.error).toBeUndefined();
    });
  });
});
