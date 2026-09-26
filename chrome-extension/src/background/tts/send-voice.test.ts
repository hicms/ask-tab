import { sendVoiceMessage, sendAudioMessage } from '../channels/telegram/bot-api';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the actual functions from bot-api.ts

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('bot-api sendVoiceMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends FormData to correct URL', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
    });

    const audio = new ArrayBuffer(100);
    const msgId = await sendVoiceMessage('TOKEN123', '456', audio);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botTOKEN123/sendVoice',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(msgId).toBe(42);
  });

  it('includes caption when provided', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });

    const audio = new ArrayBuffer(10);
    await sendVoiceMessage('T', '1', audio, { caption: 'test caption', parseMode: 'HTML' });

    const callArgs = mockFetch.mock.calls[0];
    const formData = callArgs[1].body as FormData;
    expect(formData.get('caption')).toBe('test caption');
    expect(formData.get('parse_mode')).toBe('HTML');
  });

  it('includes replyToMessageId when provided', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });

    const audio = new ArrayBuffer(10);
    await sendVoiceMessage('T', '1', audio, { replyToMessageId: 99 });

    const formData = mockFetch.mock.calls[0][1].body as FormData;
    expect(formData.get('reply_to_message_id')).toBe('99');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: 'Chat not found' }),
    });

    await expect(sendVoiceMessage('T', '999', new ArrayBuffer(10))).rejects.toThrow(
      'sendVoice failed: Chat not found',
    );
  });

  it('throws with generic message when no description', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false }),
    });

    await expect(sendVoiceMessage('T', '999', new ArrayBuffer(10))).rejects.toThrow(
      'sendVoice failed: Unknown error',
    );
  });
});

describe('bot-api sendAudioMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends to correct URL', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 10 } }),
    });

    await sendAudioMessage('TOKEN', 'CHAT', new ArrayBuffer(50));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botTOKEN/sendAudio',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses custom filename and content type', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 10 } }),
    });

    await sendAudioMessage('T', '1', new ArrayBuffer(10), {
      filename: 'reply.ogg',
      contentType: 'audio/ogg',
    });

    const formData = mockFetch.mock.calls[0][1].body as FormData;
    const audioBlob = formData.get('audio') as File;
    expect(audioBlob.name).toBe('reply.ogg');
    expect(audioBlob.type).toBe('audio/ogg');
  });

  it('uses default filename and content type when not specified', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 10 } }),
    });

    await sendAudioMessage('T', '1', new ArrayBuffer(10));

    const formData = mockFetch.mock.calls[0][1].body as FormData;
    const audioBlob = formData.get('audio') as File;
    expect(audioBlob.name).toBe('audio.wav');
    expect(audioBlob.type).toBe('audio/wav');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: 'Bad Request' }),
    });

    await expect(sendAudioMessage('T', '999', new ArrayBuffer(10))).rejects.toThrow(
      'sendAudio failed: Bad Request',
    );
  });
});
