/**
 * Thinking controls reach the provider body. The SDK cases run the real pi-ai
 * providers and SDKs; only fetch is replaced.
 */
import {
  applyReasoningSettings,
  loadReasoningSettings,
  withReasoningSettings,
} from './reasoning-payload';
import { publicModelsStorage, reasoningSelectionsStorage } from '@extension/storage';
import { streamSimple } from '@mariozechner/pi-ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReasoningSetting } from '@extension/shared';
import type { PublicModel } from '@extension/storage';
import type { Api, Context, Model } from '@mariozechner/pi-ai';

const catalogEntry = (overrides: Partial<PublicModel>): PublicModel => ({
  id: 'model',
  name: 'Model',
  protocol: 'openai-completions',
  kind: 'chat',
  embeddingSpaceId: null,
  isDefault: false,
  supportsTools: true,
  supportsReasoning: true,
  supportsImages: false,
  contextWindow: null,
  vendor: null,
  tier: null,
  priceMultiplier: null,
  reasoningControls: [],
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('applyReasoningSettings', () => {
  it('writes nested paths and keeps sibling fields', () => {
    const payload: Record<string, unknown> = { model: 'm', thinking: { budget: 1 } };
    applyReasoningSettings('anthropic-messages', payload, [
      { path: 'thinking.type', value: 'adaptive' },
      { path: 'output_config.effort', value: 'high' },
    ]);
    expect(payload).toEqual({
      model: 'm',
      thinking: { budget: 1, type: 'adaptive' },
      output_config: { effort: 'high' },
    });
  });

  it('replaces a whole object and does not share it with the catalog', () => {
    const value = { keep: 'all', type: 'enabled' };
    const payload: Record<string, unknown> = { thinking: { type: 'disabled' } };
    applyReasoningSettings('openai-completions', payload, [{ path: 'thinking', value }]);
    expect(payload.thinking).toEqual(value);
    expect(payload.thinking).not.toBe(value);
  });

  it('routes Gemini paths through the SDK extra body', () => {
    const payload: Record<string, unknown> = { model: 'g', config: { maxOutputTokens: 9 } };
    applyReasoningSettings('google-generative-ai', payload, [
      { path: 'generationConfig.thinkingConfig.thinkingLevel', value: 'low' },
    ]);
    expect(payload).toEqual({
      model: 'g',
      config: {
        maxOutputTokens: 9,
        httpOptions: {
          extraBody: { generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } },
        },
      },
    });
  });
});

describe('loadReasoningSettings', () => {
  it('sends the user choice where allowed and the default otherwise', async () => {
    vi.spyOn(publicModelsStorage, 'get').mockResolvedValue([
      catalogEntry({
        id: 'qwen',
        reasoningControls: [
          { path: 'reasoning_effort', values: ['none', 'low', 'xhigh'], default: 'xhigh' },
          { path: 'enable_thinking', values: [true, false], default: true },
          { path: 'preserve_thinking', values: [true, false], default: true },
        ],
      }),
    ]);
    vi.spyOn(reasoningSelectionsStorage, 'get').mockResolvedValue({
      qwen: { reasoning_effort: 'low', enable_thinking: false, preserve_thinking: 'withdrawn' },
    });
    expect(await loadReasoningSettings('qwen')).toEqual([
      { path: 'reasoning_effort', value: 'low' },
      { path: 'enable_thinking', value: false },
      { path: 'preserve_thinking', value: true },
    ]);
  });

  it('returns nothing for a model without controls or not in the catalog', async () => {
    vi.spyOn(publicModelsStorage, 'get').mockResolvedValue([catalogEntry({ id: 'plain' })]);
    vi.spyOn(reasoningSelectionsStorage, 'get').mockResolvedValue({});
    expect(await loadReasoningSettings('plain')).toEqual([]);
    expect(await loadReasoningSettings('missing')).toEqual([]);
  });
});

describe('withReasoningSettings', () => {
  it('leaves options untouched when there is nothing to send', () => {
    const options = { apiKey: 'k' };
    expect(withReasoningSettings('openai-completions', [], options)).toBe(options);
  });

  it('still calls an existing payload observer', () => {
    const observer = vi.fn();
    const options = withReasoningSettings(
      'openai-completions',
      [{ path: 'reasoning_effort', value: 'max' }],
      { onPayload: observer },
    );
    const payload = {};
    options?.onPayload?.(payload);
    expect(observer).toHaveBeenCalledWith({ reasoning_effort: 'max' });
  });
});

describe('request bodies sent by the real SDKs', () => {
  const relay = (api: Api, provider: string): Model<Api> => ({
    id: 'relay-model',
    name: 'Relay Model',
    api,
    provider,
    baseUrl: 'http://ask.test/api/llm/relay-model',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_000,
  });

  const captureBody = async (
    model: Model<Api>,
    context: Context,
    settings: ReasoningSetting[] = [],
  ) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ error: { type: 'test', message: 'stop here' } }, { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const stream = streamSimple(
      model,
      context,
      withReasoningSettings(model.api, settings, { apiKey: 'jwt', maxRetryDelayMs: 0 }),
    );
    await stream.result();
    const init = fetchMock.mock.calls[0]?.[1];
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
  };

  const hello: Context = { messages: [{ role: 'user', content: 'Hi', timestamp: 1 }] };

  it('OpenAI-compatible relay receives reasoning_effort and nested thinking fields', async () => {
    const body = await captureBody(relay('openai-completions', 'openai'), hello, [
      { path: 'reasoning_effort', value: 'max' },
      { path: 'thinking.clear_thinking', value: false },
    ]);
    expect(body).toMatchObject({ reasoning_effort: 'max', thinking: { clear_thinking: false } });
  });

  it('Anthropic relay receives adaptive thinking and effort', async () => {
    const body = await captureBody(relay('anthropic-messages', 'anthropic'), hello, [
      { path: 'thinking.type', value: 'adaptive' },
      { path: 'thinking.display', value: 'omitted' },
      { path: 'output_config.effort', value: 'xhigh' },
    ]);
    expect(body).toMatchObject({
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'xhigh' },
    });
  });

  it('Anthropic replay keeps signed thinking whose text was omitted', async () => {
    const model = relay('anthropic-messages', 'anthropic');
    const context: Context = {
      messages: [
        { role: 'user', content: 'What time is it?', timestamp: 1 },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '', thinkingSignature: 'sig-omitted' },
            { type: 'toolCall', id: 'toolu_1', name: 'get_time', arguments: {} },
          ],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'toolu_1',
          toolName: 'get_time',
          content: [{ type: 'text', text: '12:34' }],
          isError: false,
          timestamp: 3,
        },
      ],
    };
    const body = await captureBody(model, context);
    const messages = body.messages as Array<{ role: string; content: unknown[] }>;
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-omitted' },
        expect.objectContaining({ type: 'tool_use', id: 'toolu_1' }),
      ],
    });
  });
});
