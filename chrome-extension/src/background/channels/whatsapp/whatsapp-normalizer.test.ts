import { normalizeWhatsAppUpdate } from './normalizer';
import { describe, expect, it } from 'vitest';
import type { WaInboundUpdate } from './types';

const baseUpdate: WaInboundUpdate = {
  channelMessageId: 'm1',
  channelChatId: '123@s.whatsapp.net',
  senderId: '15551234567@s.whatsapp.net',
  senderName: 'Alice',
  body: 'hello',
  timestamp: 1700000000000,
  chatType: 'direct',
  fromMe: false,
};

const textItem = { id: 'q-1', mediaType: null };
const audioItem = { id: 'q-2', mediaType: 'audio/ogg' };

describe('normalizeWhatsAppUpdate', () => {
  it('converts a queued text message to an inbound message', () => {
    expect(normalizeWhatsAppUpdate(baseUpdate, textItem)).toEqual({
      channelMessageId: 'm1',
      channelChatId: '123@s.whatsapp.net',
      senderId: '15551234567@s.whatsapp.net',
      senderName: 'Alice',
      senderUsername: '15551234567',
      body: 'hello',
      timestamp: 1700000000000,
      chatType: 'direct',
      fromMe: false,
    });
  });

  it('skips messages without text or audio', () => {
    expect(normalizeWhatsAppUpdate({ ...baseUpdate, body: '  ' }, textItem)).toBeNull();
  });

  it('keeps audio messages even with an empty body', () => {
    const result = normalizeWhatsAppUpdate({ ...baseUpdate, body: '', isAudio: true }, audioItem);

    expect(result?.mediaFileId).toBe('q-2');
    expect(result?.mediaMimeType).toBe('audio/ogg');
  });

  it('falls back to audio/ogg when the queue item has no media type', () => {
    const result = normalizeWhatsAppUpdate({ ...baseUpdate, body: '', isAudio: true }, textItem);

    expect(result?.mediaMimeType).toBe('audio/ogg');
  });

  it('does not attach media for text messages', () => {
    const result = normalizeWhatsAppUpdate(baseUpdate, audioItem);

    expect(result?.mediaFileId).toBeUndefined();
  });

  it('derives the username from the phone number portion of the JID', () => {
    expect(normalizeWhatsAppUpdate(baseUpdate, textItem)?.senderUsername).toBe('15551234567');
  });

  it('maps group chats through', () => {
    const result = normalizeWhatsAppUpdate(
      { ...baseUpdate, channelChatId: '999@g.us', chatType: 'group' },
      textItem,
    );

    expect(result?.chatType).toBe('group');
  });

  it('preserves the fromMe flag', () => {
    const result = normalizeWhatsAppUpdate({ ...baseUpdate, fromMe: true }, textItem);

    expect(result?.fromMe).toBe(true);
  });

  it('passes senderName through as undefined when absent', () => {
    const { senderName: _, ...withoutName } = baseUpdate;
    const result = normalizeWhatsAppUpdate(withoutName, textItem);

    expect(result?.senderName).toBeUndefined();
  });
});
