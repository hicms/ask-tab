import { normalizeTelegramUpdate } from './normalizer';
import { describe, expect, it } from 'vitest';
import type { TgUpdate } from './types';

const baseMessage = {
  message_id: 42,
  chat: { id: 123, type: 'private' as const },
  from: { id: 456, is_bot: false, first_name: 'Alice' },
  date: 1700000000,
};

describe('normalizeTelegramUpdate', () => {
  it('converts a text DM to an inbound message', () => {
    const update: TgUpdate = {
      update_id: 1,
      message: {
        ...baseMessage,
        from: { id: 456, is_bot: false, first_name: 'Alice', username: 'alice' },
        text: 'hello',
      },
    };

    expect(normalizeTelegramUpdate(update)).toEqual({
      channelMessageId: '42',
      channelChatId: '123',
      senderId: '456',
      senderName: 'Alice',
      senderUsername: 'alice',
      body: 'hello',
      timestamp: 1700000000000,
      chatType: 'direct',
      replyToId: undefined,
    });
  });

  it('skips updates without a message', () => {
    expect(normalizeTelegramUpdate({ update_id: 2 })).toBeNull();
  });

  it('skips messages without text or audio media', () => {
    expect(normalizeTelegramUpdate({ update_id: 3, message: baseMessage })).toBeNull();
  });

  it('skips messages without a sender', () => {
    const update: TgUpdate = {
      update_id: 4,
      message: {
        message_id: 11,
        chat: { id: 123, type: 'private' },
        text: 'hello',
        date: 1700000000,
      },
    };
    expect(normalizeTelegramUpdate(update)).toBeNull();
  });

  it('maps group chats to the group chat type', () => {
    const update: TgUpdate = {
      update_id: 5,
      message: {
        ...baseMessage,
        chat: { id: -100123, type: 'supergroup' },
        text: 'hello group',
      },
    };
    expect(normalizeTelegramUpdate(update)?.chatType).toBe('group');
  });

  it('carries the replied-to message id', () => {
    const update: TgUpdate = {
      update_id: 6,
      message: {
        ...baseMessage,
        text: 'reply text',
        reply_to_message: {
          message_id: 10,
          chat: { id: 123, type: 'private' },
          date: 1699999000,
        },
      },
    };
    expect(normalizeTelegramUpdate(update)?.replyToId).toBe('10');
  });

  it('joins first and last name for the sender name', () => {
    const update: TgUpdate = {
      update_id: 7,
      message: {
        ...baseMessage,
        from: { id: 456, is_bot: false, first_name: 'Alice', last_name: 'Smith' },
        text: 'hello',
      },
    };
    expect(normalizeTelegramUpdate(update)?.senderName).toBe('Alice Smith');
  });

  it('converts the date from seconds to milliseconds', () => {
    const update: TgUpdate = { update_id: 8, message: { ...baseMessage, text: 'hello' } };
    expect(normalizeTelegramUpdate(update)?.timestamp).toBe(1700000000000);
  });

  it('keeps the text body alongside audio media', () => {
    const update: TgUpdate = {
      update_id: 9,
      message: {
        ...baseMessage,
        text: 'caption',
        voice: { file_id: 'v1', file_unique_id: 'u', duration: 3 },
      },
    };
    expect(normalizeTelegramUpdate(update)?.body).toBe('caption');
  });

  describe('audio media detection', () => {
    it('detects voice notes, falling back to audio/ogg mime', () => {
      const result = normalizeTelegramUpdate({
        update_id: 1,
        message: { ...baseMessage, voice: { file_id: 'v1', file_unique_id: 'u', duration: 3 } },
      });
      expect(result?.mediaFileId).toBe('v1');
      expect(result?.mediaMimeType).toBe('audio/ogg');
    });

    it('detects audio files with their mime type', () => {
      const result = normalizeTelegramUpdate({
        update_id: 1,
        message: {
          ...baseMessage,
          audio: { file_id: 'a1', file_unique_id: 'u', duration: 3, mime_type: 'audio/mpeg' },
        },
      });
      expect(result?.mediaFileId).toBe('a1');
      expect(result?.mediaMimeType).toBe('audio/mpeg');
    });

    it('detects round video notes', () => {
      const result = normalizeTelegramUpdate({
        update_id: 1,
        message: {
          ...baseMessage,
          video_note: { file_id: 'vn1', file_unique_id: 'u', duration: 3, length: 240 },
        },
      });
      expect(result?.mediaFileId).toBe('vn1');
      expect(result?.mediaMimeType).toBe('video/mp4');
    });

    it('detects audio documents', () => {
      const result = normalizeTelegramUpdate({
        update_id: 1,
        message: {
          ...baseMessage,
          document: { file_id: 'd1', file_unique_id: 'u', mime_type: 'audio/wav' },
        },
      });
      expect(result?.mediaFileId).toBe('d1');
      expect(result?.mediaMimeType).toBe('audio/wav');
    });

    it('ignores non-audio documents', () => {
      const result = normalizeTelegramUpdate({
        update_id: 1,
        message: {
          ...baseMessage,
          document: { file_id: 'd1', file_unique_id: 'u', mime_type: 'application/pdf' },
        },
      });
      expect(result).toBeNull();
    });

    it('prefers voice over other media when multiple are present', () => {
      const result = normalizeTelegramUpdate({
        update_id: 1,
        message: {
          ...baseMessage,
          voice: { file_id: 'v1', file_unique_id: 'u', duration: 3 },
          audio: { file_id: 'a1', file_unique_id: 'u', duration: 3, mime_type: 'audio/mpeg' },
        },
      });
      expect(result?.mediaFileId).toBe('v1');
    });
  });
});
