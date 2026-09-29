/**
 * Native Gemini relay through the real pi-ai Google provider and @google/genai
 * SDK. Only fetch is replaced, so URLs, headers and bodies are the SDK's own.
 */
import { loadModelHistory, modelSourceKey } from './model-transcript';
import { completeText, createStreamFn } from './stream-bridge';
import { chatDb } from '../../../../packages/storage/lib/impl/chat-db';
import { confirmSessionAfterModelError } from '../ask-service/client';
import { buildSystemPrompt } from '@extension/shared';
import { createChat, finishModelTurn } from '@extension/storage';
import { Type } from '@mariozechner/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatModel } from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  ToolCall,
  ToolResultMessage,
} from '@mariozechner/pi-ai';

vi.mock('@extension/env', () => ({ ASK_SERVICE_URL: 'http://ask.test' }));
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }),
}));
vi.mock('../ask-service/client', () => ({
  confirmSessionAfterModelError: vi.fn(async () => {}),
  requireSession: vi.fn(async () => ({
    token: 'jwt-1',
    userId: 'u',
    email: 'a@b.co',
    expiresAt: 9999999999999,
  })),
}));

const JWT = 'jwt-1';
// Gemini thought signatures are opaque base64 bytes.
const SIGNATURE = 'c2lnbmF0dXJlLWZvci13ZWF0aGVy';
const STREAM_URL =
  'http://ask.test/api/llm/gemini-3-8-flash/v1beta/models/gemini-3-8-flash:streamGenerateContent?alt=sse';
const PNG = 'iVBORw0KGgo=';

const gemini: ChatModel = {
  id: 'gemini-3-8-flash',
  dbId: 'ask:gemini-3-8-flash',
  name: 'Gemini-3.8-Flash',
  provider: 'google',
  supportsTools: true,
  supportsReasoning: true,
};

const weatherTool = {
  name: 'weather',
  description: 'Current weather for a city',
  parameters: Type.Object({ city: Type.String() }),
};

const sse = (...events: unknown[]) =>
  new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const toolCallResponse = () =>
  sse(
    {
      candidates: [
        { content: { role: 'model', parts: [{ text: 'Checking the weather', thought: true }] } },
      ],
      modelVersion: 'gemini-3-8-flash',
    },
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: { name: 'weather', args: { city: 'Shanghai' } },
                thoughtSignature: SIGNATURE,
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 6,
        totalTokenCount: 22,
      },
      modelVersion: 'gemini-3-8-flash',
    },
  );

const textResponse = (text: string) =>
  sse({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 2, totalTokenCount: 32 },
    modelVersion: 'gemini-3-8-flash',
  });

const fetchMock = vi.fn<typeof fetch>();

interface SentRequest {
  url: string;
  method?: string;
  headers: Headers;
  body: {
    contents: unknown[];
    systemInstruction: { parts: unknown[] };
    tools: Array<{ functionDeclarations: unknown[] }>;
    generationConfig?: { thinkingConfig?: unknown; maxOutputTokens?: number };
  };
}

const sent = (index: number): SentRequest => {
  const [url, init] = fetchMock.mock.calls[index]!;
  return {
    url: String(url),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)),
  };
};

const run = async (model: ChatModel, context: Context): Promise<AssistantMessage> => {
  const stream = (await createStreamFn(model)(
    // The bridge resolves its own relay model; the loop's model argument is unused.
    {} as never,
    context,
    { apiKey: JWT },
  )) as AssistantMessageEventStream;
  return stream.result();
};

const userTurn: Message = {
  role: 'user',
  content: [
    { type: 'text', text: 'What is the weather in this city?' },
    { type: 'image', data: PNG, mimeType: 'image/png' },
  ],
  timestamp: 1,
};

const toolResult = (call: ToolCall): ToolResultMessage => ({
  role: 'toolResult',
  toolCallId: call.id,
  toolName: call.name,
  content: [{ type: 'text', text: '20°C and sunny' }],
  isError: false,
  timestamp: 3,
});

const uiMessage = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
  id,
  chatId: 'chat-1',
  role,
  parts: [{ type: 'text', text }],
  createdAt: 1,
});

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(confirmSessionAfterModelError).mockClear();
  await chatDb.modelTranscripts.clear();
  await chatDb.messages.clear();
  await chatDb.chats.clear();
  await createChat({ id: 'chat-1', title: 'test', createdAt: 1, updatedAt: 1 });
});

describe('native Gemini relay', () => {
  it('sends a consistent text-only prompt when the model has no tool support', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('Web search is unavailable.'));
    const model = { ...gemini, supportsTools: false };
    const { text } = buildSystemPrompt({
      mode: 'full',
      supportsTools: model.supportsTools,
      tools: [{ name: 'web_search', description: 'Search the web' }],
      toolPromptHints: ['Use web_search before writing the article.'],
    });
    const result = await run(model, {
      systemPrompt: text,
      messages: [{ role: 'user', content: 'Research and write an article.', timestamp: 1 }],
      tools: [],
    });
    const request = sent(0);
    expect(request.body.tools).toBeUndefined();
    expect(JSON.stringify(request.body.systemInstruction)).toContain('No tools are available');
    expect(JSON.stringify(request.body.systemInstruction)).not.toContain('web_search');
    expect(result.stopReason).toBe('stop');
  });

  it.each(['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'SAFETY'])(
    'preserves the upstream finish reason %s after streamed thoughts',
    async finishReason => {
      fetchMock.mockResolvedValueOnce(
        sse(
          {
            candidates: [
              { content: { role: 'model', parts: [{ text: 'Planning search', thought: true }] } },
            ],
          },
          { candidates: [{ content: { role: 'model', parts: [{ text: '' }] } }] },
          { candidates: [{ content: { role: 'model' }, finishReason }] },
        ),
      );
      const result = await run(gemini, { messages: [userTurn] });
      expect(result.stopReason).toBe('error');
      expect(result.errorMessage).toBe(`Gemini generation ended with ${finishReason}`);
    },
  );

  it('does not mark a partial tool call as executable when the upstream finishes with an error', async () => {
    fetchMock.mockResolvedValueOnce(
      sse({
        candidates: [
          {
            content: { role: 'model', parts: [{ functionCall: { name: 'weather', args: {} } }] },
            finishReason: 'MALFORMED_FUNCTION_CALL',
          },
        ],
      }),
    );
    const result = await run(gemini, { messages: [userTurn], tools: [weatherTool] });
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBe('Gemini generation ended with MALFORMED_FUNCTION_CALL');
  });

  it('streams through the Ask relay with the JWT and a native request body', async () => {
    fetchMock.mockResolvedValueOnce(toolCallResponse());

    const message = await run(gemini, {
      systemPrompt: 'Use tools.',
      messages: [userTurn],
      tools: [weatherTool],
    });

    const request = sent(0);
    expect(request.url).toBe(STREAM_URL);
    expect(request.method).toBe('POST');
    expect(request.headers.get('x-goog-api-key')).toBe(JWT);
    expect(request.headers.get('authorization')).toBeNull();
    expect(new URL(request.url).searchParams.has('key')).toBe(false);
    expect(Object.keys(request.body).sort()).toEqual([
      'contents',
      'generationConfig',
      'systemInstruction',
      'tools',
    ]);

    expect(request.body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'What is the weather in this city?' },
          { inlineData: { mimeType: 'image/png', data: PNG } },
        ],
      },
    ]);
    expect(request.body.systemInstruction.parts).toEqual([{ text: 'Use tools.' }]);
    expect(request.body.tools[0].functionDeclarations[0]).toMatchObject({
      name: 'weather',
      parametersJsonSchema: { type: 'object', properties: { city: { type: 'string' } } },
    });
    expect(request.body.generationConfig?.thinkingConfig).toEqual({ includeThoughts: true });
    expect(request.body.generationConfig?.maxOutputTokens).toBeGreaterThan(0);

    expect(message).toMatchObject({
      api: 'google-generative-ai',
      provider: 'google',
      model: 'gemini-3-8-flash',
      stopReason: 'toolUse',
      usage: { input: 12, output: 10, totalTokens: 22 },
    });
    expect(message.content[0]).toEqual({
      type: 'thinking',
      thinking: 'Checking the weather',
      thinkingSignature: undefined,
    });
    expect(message.content[1]).toMatchObject({
      type: 'toolCall',
      name: 'weather',
      arguments: { city: 'Shanghai' },
      thoughtSignature: SIGNATURE,
    });
  });

  it('returns the thought signature with the tool result and on later turns', async () => {
    fetchMock
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(textResponse('It is 20°C and sunny.'))
      .mockResolvedValueOnce(textResponse('Still sunny.'));
    const first = await run(gemini, { messages: [userTurn], tools: [weatherTool] });
    const call = first.content.find((part): part is ToolCall => part.type === 'toolCall')!;

    const toolTurn: AgentMessage[] = [userTurn, first, toolResult(call)];
    const final = await run(gemini, { messages: toolTurn as Message[], tools: [weatherTool] });
    const replayedModelTurn = {
      role: 'model',
      parts: [
        { thought: true, text: 'Checking the weather' },
        {
          functionCall: { name: 'weather', args: { city: 'Shanghai' } },
          thoughtSignature: SIGNATURE,
        },
      ],
    };
    const functionResponse = {
      role: 'user',
      parts: [{ functionResponse: { name: 'weather', response: { output: '20°C and sunny' } } }],
    };
    expect(sent(1).body.contents.slice(1)).toEqual([replayedModelTurn, functionResponse]);
    expect(final).toMatchObject({
      stopReason: 'stop',
      content: [{ text: 'It is 20°C and sunny.' }],
    });

    const transcript = [...toolTurn, final];
    await finishModelTurn(
      { ...uiMessage('assistant-ui', 'assistant', 'It is 20°C and sunny.'), createdAt: 2 },
      modelSourceKey(gemini),
      transcript,
    );
    const history = await loadModelHistory(
      'chat-1',
      [
        uiMessage('user-ui', 'user', 'What is the weather in this city?'),
        uiMessage('assistant-ui', 'assistant', 'It is 20°C and sunny.'),
        uiMessage('next-ui', 'user', 'And now?'),
      ],
      gemini,
    );
    expect(history).toEqual(transcript);

    await run(gemini, {
      messages: [...history, { role: 'user', content: 'And now?', timestamp: 5 }] as Message[],
      tools: [weatherTool],
    });
    expect(sent(2).body.contents.slice(1)).toEqual([
      replayedModelTurn,
      functionResponse,
      { role: 'model', parts: [{ text: 'It is 20°C and sunny.' }] },
      { role: 'user', parts: [{ text: 'And now?' }] },
    ]);
  });

  it('does not request thoughts from a Gemini model without reasoning', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('OK'));
    const message = await run(
      { ...gemini, id: 'gemini-lite', supportsReasoning: false },
      { messages: [{ role: 'user', content: 'Hi', timestamp: 1 }] },
    );
    expect(sent(0).url).toBe(
      'http://ask.test/api/llm/gemini-lite/v1beta/models/gemini-lite:streamGenerateContent?alt=sse',
    );
    expect(sent(0).body.generationConfig?.thinkingConfig).toBeUndefined();
    expect(message.content).toEqual([{ type: 'text', text: 'OK' }]);
  });

  it('uses the same native stream route for background completions', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('Summary'));
    await expect(completeText(gemini, 'Summarize.', 'Long text')).resolves.toBe('Summary');
    expect(sent(0).url).toBe(STREAM_URL);
    expect(sent(0).headers.get('x-goog-api-key')).toBe(JWT);
    expect(sent(0).body.systemInstruction.parts).toEqual([{ text: 'Summarize.' }]);
  });

  it('reports relay errors and re-checks the session that sent them', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not signed in or session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const message = await run(gemini, {
      messages: [{ role: 'user', content: 'Hi', timestamp: 1 }],
    });
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('Not signed in or session expired');
    await vi.waitFor(() =>
      expect(confirmSessionAfterModelError).toHaveBeenCalledWith(
        'http://ask.test/api/llm/gemini-3-8-flash/v1beta',
        JWT,
      ),
    );
  });
});
