import { makeConvertToLlm } from './message-adapter';
import { chatModelToPiModel } from './model-adapter';
import {
  createModelCheckpoint,
  displayHistoryAsContext,
  loadModelHistory,
  modelSourceKey,
} from './model-transcript';
import { chatDb } from '../../../../packages/storage/lib/impl/chat-db';
import {
  createChat,
  finishModelTurn,
  getModelTranscript,
  saveModelTranscript,
} from '@extension/storage';
import { convertMessages } from '@mariozechner/pi-ai/dist/providers/openai-completions.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ChatModel } from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, OpenAICompletionsCompat } from '@mariozechner/pi-ai';

const model: ChatModel = {
  id: 'reasoning-proxy-model',
  name: 'Reasoning proxy',
  provider: 'custom',
};

const uiMessage = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
  id,
  chatId: 'chat-1',
  role,
  parts: [{ type: 'text', text }],
  createdAt: id === 'new-user' ? 3 : 1,
});

const assistant = (content: AssistantMessage['content'], timestamp: number): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'openai',
  model: model.id,
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp,
});

beforeEach(async () => {
  await chatDb.modelTranscripts.clear();
  await chatDb.messages.clear();
  await chatDb.chats.clear();
  await createChat({ id: 'chat-1', title: 'test', createdAt: 1, updatedAt: 1 });
});

describe('model transcript replay', () => {
  it('persists ordered tool turns and sends original reasoning_content through the SDK encoder', async () => {
    const transcript: AgentMessage[] = [
      { role: 'user', content: 'Find x', timestamp: 1 },
      assistant(
        [
          { type: 'thinking', thinking: 'First analysis', thinkingSignature: 'reasoning_content' },
          { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { key: 'x' } },
        ],
        2,
      ),
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'lookup',
        content: [{ type: 'text', text: 'one' }],
        isError: false,
        timestamp: 3,
      },
      assistant(
        [
          { type: 'thinking', thinking: 'Second analysis', thinkingSignature: 'reasoning_content' },
          { type: 'toolCall', id: 'call-2', name: 'lookup', arguments: { key: 'y' } },
        ],
        4,
      ),
      {
        role: 'toolResult',
        toolCallId: 'call-2',
        toolName: 'lookup',
        content: [{ type: 'text', text: 'two' }],
        isError: false,
        timestamp: 5,
      },
      assistant([{ type: 'text', text: 'Done' }], 6),
    ];
    await createModelCheckpoint('chat-1', modelSourceKey(model))(transcript.slice(0, 2));
    expect((await getModelTranscript('chat-1'))?.status).toBe('running');
    await finishModelTurn(
      {
        id: 'assistant-ui',
        chatId: 'chat-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Done' }],
        createdAt: 2,
      },
      modelSourceKey(model),
      transcript,
    );

    const loaded = await loadModelHistory(
      'chat-1',
      [
        uiMessage('user-ui', 'user', 'Find x'),
        uiMessage('assistant-ui', 'assistant', 'Done'),
        uiMessage('new-user', 'user', 'Continue'),
      ],
      model,
    );
    expect(loaded).toEqual(transcript);
    expect(loaded.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
      'toolResult',
      'assistant',
    ]);

    const resolved = chatModelToPiModel(model).model;
    const encoded = convertMessages(
      resolved as Parameters<typeof convertMessages>[0],
      { systemPrompt: '', messages: makeConvertToLlm(model)(loaded), tools: [] },
      { requiresThinkingAsText: false } as Required<OpenAICompletionsCompat>,
    ) as Array<Record<string, unknown>>;
    const encodedAssistants = encoded.filter(message => message.role === 'assistant');
    expect(encodedAssistants.map(message => message.reasoning_content)).toEqual([
      'First analysis',
      'Second analysis',
      undefined,
    ]);
    expect(encoded.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('uses portable context when source changes and never exposes reasoning', async () => {
    const history = [
      uiMessage('user-ui', 'user', 'Question'),
      {
        ...uiMessage('assistant-ui', 'assistant', 'Answer'),
        parts: [
          { type: 'reasoning' as const, text: 'private thought', signature: 'opaque' },
          { type: 'text' as const, text: 'Answer' },
        ],
      },
      uiMessage('new-user', 'user', 'Continue'),
    ];
    await saveModelTranscript({
      chatId: 'chat-1',
      schemaVersion: 1,
      status: 'complete',
      sourceKey: modelSourceKey(model),
      lastUiMessageId: 'assistant-ui',
      messages: [{ role: 'user', content: 'Question', timestamp: 1 }],
    });
    const switched = await loadModelHistory('chat-1', history, {
      ...model,
      id: 'another-public-model',
    });
    expect(switched).toHaveLength(1);
    expect(switched[0]?.role).toBe('user');
    expect(JSON.stringify(switched)).toContain('Answer');
    expect(JSON.stringify(switched)).not.toContain('private thought');
    expect(JSON.stringify(switched)).not.toContain('opaque');
    expect(modelSourceKey(model)).not.toContain('secret-never-in-source-key');
    expect(displayHistoryAsContext([])).toEqual([]);
  });

  it('recovers interrupted history as context without replaying tool calls or reasoning', async () => {
    await saveModelTranscript({
      chatId: 'chat-1',
      schemaVersion: 1,
      status: 'running',
      sourceKey: modelSourceKey(model),
      messages: [
        assistant(
          [
            { type: 'thinking', thinking: 'private interrupted reasoning' },
            { type: 'toolCall', id: 'call-1', name: 'write', arguments: { path: 'notes.md' } },
          ],
          1,
        ),
      ],
    });
    const history = await loadModelHistory(
      'chat-1',
      [uiMessage('new-user', 'user', 'Continue')],
      model,
    );
    expect(history.map(m => m.role)).toEqual(['user']);
    expect(JSON.stringify(history)).toContain('unknown outcome');
    expect(JSON.stringify(history)).toContain('notes.md');
    expect(JSON.stringify(history)).not.toContain('private interrupted reasoning');
  });
});
