import {
  downloadFile,
  editMessageText,
  getFile,
  removeMessageReaction,
  sendAudioMessage,
  sendChatAction,
  sendHtmlMessage,
  sendTelegramMessage,
  sendVoiceMessage,
  setMessageReaction,
  setMyCommands,
} from './bot-api';
import { AskServiceError, requestAuthorized } from '../../ask-service/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ask-service/client', () => {
  class AskServiceError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { AskServiceError, requestAuthorized: vi.fn() };
});

const request = vi.mocked(requestAuthorized);

const reply = (body: unknown): Response => new Response(JSON.stringify(body));

const call = (index = 0): { path: string; init: RequestInit } => {
  const [path, init] = request.mock.calls[index] ?? [];
  return { path: path as string, init: init ?? {} };
};

const jsonBody = (index = 0): Record<string, unknown> =>
  JSON.parse(call(index).init.body as string) as Record<string, unknown>;

describe('telegram bot-api', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation(async () => reply({ ok: true, result: { message_id: 1 } }));
  });

  describe('sendTelegramMessage', () => {
    it('posts Markdown text through the server bot relay', async () => {
      await sendTelegramMessage('123', 'Hello *world*');

      expect(call().path).toBe('/api/channels/telegram/bot/sendMessage');
      expect(call().init.method).toBe('POST');
      expect(call().init.signal).toBeInstanceOf(AbortSignal);
      expect(jsonBody()).toEqual({ chat_id: '123', text: 'Hello *world*', parse_mode: 'Markdown' });
    });

    it('retries without parse_mode when Telegram cannot parse the Markdown', async () => {
      request
        .mockResolvedValueOnce(reply({ ok: false, description: "can't parse entities" }))
        .mockResolvedValueOnce(reply({ ok: true, result: { message_id: 2 } }));

      await sendTelegramMessage('123', 'Bad *markdown');

      expect(request).toHaveBeenCalledTimes(2);
      expect(jsonBody(1).parse_mode).toBeUndefined();
    });

    it('retries when the server relays the parse error as an HTTP error', async () => {
      request
        .mockRejectedValueOnce(new AskServiceError("Bad Request: can't parse entities", 400))
        .mockResolvedValueOnce(reply({ ok: true, result: { message_id: 2 } }));

      await sendTelegramMessage('123', 'Bad *markdown');

      expect(request).toHaveBeenCalledTimes(2);
    });

    it('splits messages longer than 4096 characters', async () => {
      await sendTelegramMessage('123', `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`);

      expect(request).toHaveBeenCalledTimes(2);
    });

    it('throws with the Telegram description on failure', async () => {
      request.mockResolvedValue(reply({ ok: false, description: 'Chat not found' }));

      await expect(sendTelegramMessage('999', 'hello')).rejects.toThrow(
        'sendMessage failed: Chat not found',
      );
    });

    it('throws when the retry fails too', async () => {
      request
        .mockResolvedValueOnce(reply({ ok: false, description: "can't parse entities" }))
        .mockResolvedValueOnce(reply({ ok: false, description: 'Still broken' }));

      await expect(sendTelegramMessage('123', 'Bad')).rejects.toThrow(
        'sendMessage failed after retry: Still broken',
      );
    });

    it('propagates network failures', async () => {
      request.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(sendTelegramMessage('123', 'hello')).rejects.toThrow('Failed to fetch');
    });
  });

  it('sendHtmlMessage returns the message id', async () => {
    request.mockResolvedValue(reply({ ok: true, result: { message_id: 42 } }));

    expect(await sendHtmlMessage('123', '<b>Hello</b>')).toBe(42);
    expect(jsonBody().parse_mode).toBe('HTML');
  });

  it('sendHtmlMessage throws on failure', async () => {
    request.mockResolvedValue(reply({ ok: false, description: 'Bad Request' }));

    await expect(sendHtmlMessage('123', '<b>x</b>')).rejects.toThrow('sendHtmlMessage failed');
  });

  it('editMessageText edits with HTML parse mode', async () => {
    await editMessageText('123', 42, '<b>Updated</b>');

    expect(call().path).toBe('/api/channels/telegram/bot/editMessageText');
    expect(jsonBody()).toMatchObject({ chat_id: '123', message_id: 42, parse_mode: 'HTML' });
  });

  it('editMessageText throws on failure', async () => {
    request.mockResolvedValue(reply({ ok: false, description: 'message is not modified' }));

    await expect(editMessageText('123', 42, 'same')).rejects.toThrow('editMessageText failed');
  });

  it('getFile resolves the file path', async () => {
    request.mockResolvedValue(
      reply({ ok: true, result: { file_id: 'abc', file_path: 'voice/file_0.oga' } }),
    );

    expect(await getFile('abc')).toEqual({ filePath: 'voice/file_0.oga' });
    expect(jsonBody()).toEqual({ file_id: 'abc' });
  });

  it('getFile throws when the path is missing', async () => {
    request.mockResolvedValue(reply({ ok: true, result: { file_id: 'abc' } }));

    await expect(getFile('abc')).rejects.toThrow('getFile failed');
  });

  it('downloadFile fetches the file through the server', async () => {
    request.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    const data = await downloadFile('voice/file 0.oga');

    expect(call().path).toBe('/api/channels/telegram/file/voice/file%200.oga');
    expect(data.byteLength).toBe(3);
  });

  it('downloadFile wraps server errors', async () => {
    request.mockRejectedValue(new AskServiceError('Not Found', 404));

    await expect(downloadFile('bad/path')).rejects.toThrow('downloadFile failed: Not Found');
  });

  it('sets and clears reactions', async () => {
    await setMessageReaction('123', 1, '👍');
    await removeMessageReaction('123', 1);

    expect(jsonBody(0).reaction).toEqual([{ type: 'emoji', emoji: '👍' }]);
    expect(jsonBody(1).reaction).toEqual([]);
  });

  it('sends a typing action', async () => {
    await sendChatAction('123');

    expect(call().path).toBe('/api/channels/telegram/bot/sendChatAction');
    expect(jsonBody()).toEqual({ chat_id: '123', action: 'typing' });
  });

  it('registers bot commands', async () => {
    await setMyCommands([{ command: 'start', description: 'Start' }]);

    expect(jsonBody()).toEqual({ commands: [{ command: 'start', description: 'Start' }] });
  });

  it('setMyCommands throws on failure', async () => {
    request.mockResolvedValue(reply({ ok: false, description: 'Unauthorized' }));

    await expect(setMyCommands([])).rejects.toThrow('setMyCommands failed: Unauthorized');
  });

  describe('sendVoiceMessage', () => {
    it('uploads an OGG voice note as multipart form data', async () => {
      request.mockResolvedValue(reply({ ok: true, result: { message_id: 10 } }));

      const id = await sendVoiceMessage('123', new ArrayBuffer(16), {
        caption: 'Voice reply',
        parseMode: 'HTML',
        replyToMessageId: 42,
      });

      expect(id).toBe(10);
      expect(call().path).toBe('/api/channels/telegram/bot/sendVoice');
      const form = call().init.body as FormData;
      expect(form.get('chat_id')).toBe('123');
      expect(form.get('caption')).toBe('Voice reply');
      expect(form.get('parse_mode')).toBe('HTML');
      expect(form.get('reply_to_message_id')).toBe('42');
      const voice = form.get('voice') as File;
      expect(voice.name).toBe('voice.ogg');
      expect(voice.type).toBe('audio/ogg');
      expect(call().init.headers).toBeUndefined();
    });

    it('throws on failure', async () => {
      request.mockResolvedValue(reply({ ok: false, description: 'Voice too long' }));

      await expect(sendVoiceMessage('123', new ArrayBuffer(0))).rejects.toThrow(
        'sendVoice failed: Voice too long',
      );
    });
  });

  describe('sendAudioMessage', () => {
    it('uses the given file name and type', async () => {
      await sendAudioMessage('123', new ArrayBuffer(10), {
        filename: 'reply.mp3',
        contentType: 'audio/mpeg',
      });

      expect(call().path).toBe('/api/channels/telegram/bot/sendAudio');
      const audio = (call().init.body as FormData).get('audio') as File;
      expect(audio.name).toBe('reply.mp3');
      expect(audio.type).toBe('audio/mpeg');
    });

    it('defaults to a WAV file', async () => {
      await sendAudioMessage('123', new ArrayBuffer(10));

      const audio = (call().init.body as FormData).get('audio') as File;
      expect(audio.name).toBe('audio.wav');
      expect(audio.type).toBe('audio/wav');
    });

    it('throws on failure', async () => {
      request.mockResolvedValue(reply({ ok: false, description: 'Bad Request' }));

      await expect(sendAudioMessage('123', new ArrayBuffer(10))).rejects.toThrow(
        'sendAudio failed: Bad Request',
      );
    });
  });
});
