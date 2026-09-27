import { chatModelToPiModel } from './model-adapter';
import { describe, expect, it } from 'vitest';
import type { ChatModel } from '@extension/shared';

const model = (overrides: Partial<ChatModel> = {}): ChatModel => ({
  id: 'public-chat',
  name: 'Public chat',
  provider: 'custom',
  ...overrides,
});

describe('chatModelToPiModel', () => {
  it('routes a public OpenAI model only through the Rust relay', () => {
    const resolved = chatModelToPiModel(
      model({ apiKey: 'sk-should-ignore', baseUrl: 'https://upstream.test/v1' }),
    );
    expect(resolved.model.api).toBe('openai-completions');
    expect(resolved.model.baseUrl).toMatch(/\/api\/llm\/public-chat$/);
    expect(resolved.model.baseUrl).not.toContain('upstream.test');
    expect(JSON.stringify(resolved)).not.toContain('sk-should-ignore');
  });

  it('uses the Anthropic relay protocol for a published Anthropic model', () => {
    const resolved = chatModelToPiModel(model({ provider: 'anthropic', id: 'claude-public' }));
    expect(resolved.model.api).toBe('anthropic-messages');
    expect(resolved.model.baseUrl).toMatch(/\/api\/llm\/claude-public$/);
  });

  it('uses the native Gemini relay with the API version in the SDK base URL', () => {
    const resolved = chatModelToPiModel(
      model({ provider: 'google', id: 'gemini-3-8-flash', supportsReasoning: true }),
    );
    expect(resolved.model.api).toBe('google-generative-ai');
    expect(resolved.model.provider).toBe('google');
    expect(resolved.model.baseUrl).toMatch(/\/api\/llm\/gemini-3-8-flash\/v1beta$/);
    expect(resolved.model.reasoning).toBe(true);
    expect(resolved.model.compat).toBeUndefined();
  });

  it('encodes public IDs as a single route segment', () => {
    expect(chatModelToPiModel(model({ id: 'a/b' })).model.baseUrl).toMatch(/\/api\/llm\/a%2Fb$/);
  });

  it('rejects retired direct, web, and local providers', () => {
    for (const provider of ['openai', 'azure', 'web', 'local', 'constructor'] as const) {
      expect(() => chatModelToPiModel(model({ provider }))).toThrow(
        'Unsupported remote model provider',
      );
    }
  });
});
