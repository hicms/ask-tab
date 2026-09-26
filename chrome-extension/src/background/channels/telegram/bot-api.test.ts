import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Store original fetch
const originalFetch = globalThis.fetch;

describe('telegram bot-api', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validateBotToken: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getUpdatesShortPoll: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendTelegramMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendHtmlMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editMessageText: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getFile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let downloadFile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendVoiceMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendAudioMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let setMessageReaction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let removeMessageReaction: any;

  beforeEach(async () => {
    globalThis.fetch = vi.fn();
    // Dynamic import to pick up mocked fetch
    const mod = await import('./bot-api');
    validateBotToken = mod.validateBotToken;
    getUpdatesShortPoll = mod.getUpdatesShortPoll;
    sendTelegramMessage = mod.sendTelegramMessage;
    sendHtmlMessage = mod.sendHtmlMessage;
    editMessageText = mod.editMessageText;
    getFile = mod.getFile;
    downloadFile = mod.downloadFile;
    sendVoiceMessage = mod.sendVoiceMessage;
    sendAudioMessage = mod.sendAudioMessage;
    setMessageReaction = mod.setMessageReaction;
    removeMessageReaction = mod.removeMessageReaction;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('validateBotToken', () => {
    it('returns valid=true with bot info for valid token', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: { id: 123, username: 'test_bot', is_bot: true, first_name: 'Test' },
          }),
      });
      const result = await validateBotToken('123:abc');
      expect(result).toEqual({ valid: true, botUser: { id: 123, username: 'test_bot' } });
    });

    it('returns valid=false for 401 Unauthorized', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Unauthorized' }),
      });
      const result = await validateBotToken('bad-token');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });

    it('returns valid=false on network error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      const result = await validateBotToken('123:abc');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('calls correct Telegram API URL', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ ok: true, result: { id: 1, is_bot: true, first_name: 'Bot' } }),
      });
      await validateBotToken('123:abc');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123:abc/getMe',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  describe('getUpdatesShortPoll', () => {
    it('returns updates array on success', async () => {
      const updates = [{ update_id: 1, message: { message_id: 1 } }];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: updates }),
      });
      const result = await getUpdatesShortPoll('tok', 0);
      expect(result).toEqual(updates);
    });

    it('passes offset and timeout=0', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: [] }),
      });
      await getUpdatesShortPoll('tok', 42);
      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('offset=42');
      expect(calledUrl).toContain('timeout=0');
    });

    it('throws on non-ok response', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      await expect(getUpdatesShortPoll('tok')).rejects.toThrow('getUpdates failed');
    });

    it('returns empty array when result is undefined', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
      const result = await getUpdatesShortPoll('tok');
      expect(result).toEqual([]);
    });

    it('throws on data.ok=false from API response', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Bot was blocked' }),
      });
      await expect(getUpdatesShortPoll('tok')).rejects.toThrow('Bot was blocked');
    });
  });

  describe('sendTelegramMessage', () => {
    it('sends text with Markdown parse_mode', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
      });
      await sendTelegramMessage('tok', '123', 'Hello *world*');

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('/sendMessage');
      const body = JSON.parse(call[1].body as string);
      expect(body.parse_mode).toBe('Markdown');
      expect(body.chat_id).toBe('123');
      expect(body.text).toBe('Hello *world*');
    });

    it('retries without parse_mode on Markdown failure', async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      // First call: markdown parsing error
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: "can't parse entities" }),
      });
      // Second call: success without parse_mode
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
      });

      await sendTelegramMessage('tok', '123', 'Bad *markdown');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
      expect(retryBody.parse_mode).toBeUndefined();
    });

    it('splits messages >4096 chars', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
      });

      const longText = 'a'.repeat(4000) + '\n' + 'b'.repeat(4000);
      await sendTelegramMessage('tok', '123', longText);

      // Should have sent 2 messages
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws on non-ok response without parse error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Chat not found' }),
      });
      await expect(sendTelegramMessage('tok', '999', 'hello')).rejects.toThrow(
        'sendMessage failed: Chat not found',
      );
    });

    it('throws when retry also fails', async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: "can't parse entities" }),
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Still broken' }),
      });
      await expect(sendTelegramMessage('tok', '123', 'Bad')).rejects.toThrow(
        'sendMessage failed after retry',
      );
    });
  });

  describe('sendHtmlMessage', () => {
    it('sends HTML message and returns message_id', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
      });
      const result = await sendHtmlMessage('tok', '123', '<b>Hello</b>');
      expect(result).toBe(42);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body.parse_mode).toBe('HTML');
    });

    it('throws on failure', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Bad Request' }),
      });
      await expect(sendHtmlMessage('tok', '123', '<b>test</b>')).rejects.toThrow(
        'sendHtmlMessage failed',
      );
    });
  });

  describe('editMessageText', () => {
    it('edits message with HTML parse mode', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
      await editMessageText('tok', '123', 42, '<b>Updated</b>');

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body.message_id).toBe(42);
      expect(body.parse_mode).toBe('HTML');
    });

    it('throws on failure', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'message is not modified' }),
      });
      await expect(editMessageText('tok', '123', 42, 'same')).rejects.toThrow(
        'editMessageText failed',
      );
    });
  });

  describe('getFile', () => {
    it('returns file path on success', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: { file_id: 'abc', file_path: 'voice/file_0.ogg' },
          }),
      });
      const result = await getFile('tok', 'abc');
      expect(result.filePath).toBe('voice/file_0.ogg');
    });

    it('throws when file_path is missing', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { file_id: 'abc' } }),
      });
      await expect(getFile('tok', 'abc')).rejects.toThrow('getFile failed');
    });
  });

  describe('downloadFile', () => {
    it('downloads file and returns ArrayBuffer', async () => {
      const buf = new ArrayBuffer(8);
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(buf),
      });
      const result = await downloadFile('tok', 'voice/file.ogg');
      expect(result).toBe(buf);

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/file/bottok/voice/file.ogg');
    });

    it('throws on non-ok response', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      await expect(downloadFile('tok', 'bad/path')).rejects.toThrow('downloadFile failed');
    });
  });

  describe('setMessageReaction / removeMessageReaction', () => {
    it('sets emoji reaction', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      await setMessageReaction('tok', '123', 1, '👍');

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body.reaction).toEqual([{ type: 'emoji', emoji: '👍' }]);
      expect(body.message_id).toBe(1);
    });

    it('removes reaction by sending empty array', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      await removeMessageReaction('tok', '123', 1);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body.reaction).toEqual([]);
    });
  });

  describe('sendVoiceMessage', () => {
    it('sends voice with FormData', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 10 } }),
      });
      const audio = new ArrayBuffer(16);
      const result = await sendVoiceMessage('tok', '123', audio);
      expect(result).toBe(10);

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/sendVoice');
    });

    it('throws on failure', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, description: 'Voice too long' }),
      });
      await expect(sendVoiceMessage('tok', '123', new ArrayBuffer(0))).rejects.toThrow(
        'sendVoice failed',
      );
    });

    it('sends voice with caption and reply_to_message_id', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 12 } }),
      });
      const audio = new ArrayBuffer(16);
      const result = await sendVoiceMessage('tok', '123', audio, {
        caption: 'Voice reply',
        replyToMessageId: 42,
        parseMode: 'HTML',
      });
      expect(result).toBe(12);
    });
  });

  describe('sendAudioMessage', () => {
    it('sends audio file with FormData', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 11 } }),
      });
      const audio = new ArrayBuffer(16);
      const result = await sendAudioMessage('tok', '123', audio, {
        filename: 'reply.wav',
        contentType: 'audio/wav',
      });
      expect(result).toBe(11);

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/sendAudio');
    });
  });

  describe('getUpdatesLongPoll', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let getUpdatesLongPoll: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ConflictError: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let UnauthorizedError: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let RateLimitError: any;

    beforeEach(async () => {
      const mod = await import('./bot-api');
      getUpdatesLongPoll = mod.getUpdatesLongPoll;
      ConflictError = mod.ConflictError;
      UnauthorizedError = mod.UnauthorizedError;
      RateLimitError = mod.RateLimitError;
    });

    it('returns updates on success', async () => {
      const updates = [{ update_id: 1, message: { message_id: 1 } }];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: updates }),
      });
      const result = await getUpdatesLongPoll('tok', 0);
      expect(result).toEqual(updates);
    });

    it('throws ConflictError on 409', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ ok: false, description: 'Conflict' }),
      });
      try {
        await getUpdatesLongPoll('tok', 0);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
      }
    });

    it('throws UnauthorizedError on 401', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ ok: false, description: 'Unauthorized' }),
      });
      try {
        await getUpdatesLongPoll('tok', 0);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
      }
    });

    it('throws RateLimitError on 429 with retry_after', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ ok: false, parameters: { retry_after: 30 } }),
      });
      try {
        await getUpdatesLongPoll('tok', 0);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as InstanceType<typeof RateLimitError>).retryAfter).toBe(30);
      }
    });

    it('throws generic Error on other non-ok status', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ ok: false }),
      });
      await expect(getUpdatesLongPoll('tok', 0)).rejects.toThrow('getUpdates failed: 500');
    });

    it('uses timeout=25 for long polling', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: [] }),
      });
      await getUpdatesLongPoll('tok', 5);
      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('timeout=25');
      expect(calledUrl).toContain('offset=5');
    });
  });

  describe('setMyCommands', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let setMyCommands: any;

    beforeEach(async () => {
      const mod = await import('./bot-api');
      setMyCommands = mod.setMyCommands;
    });

    it('sends commands to Telegram API', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      await setMyCommands('tok', [{ command: 'start', description: 'Start the bot' }]);
      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/setMyCommands');
    });

    it('throws on non-ok response', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
      });
      await expect(
        setMyCommands('tok', [{ command: 'start', description: 'Start' }]),
      ).rejects.toThrow('setMyCommands failed: 400');
    });
  });

  describe('sendChatAction', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sendChatAction: any;

    beforeEach(async () => {
      const mod = await import('./bot-api');
      sendChatAction = mod.sendChatAction;
    });

    it('sends typing action', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      await sendChatAction('tok', '123');
      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body.action).toBe('typing');
    });
  });
});
