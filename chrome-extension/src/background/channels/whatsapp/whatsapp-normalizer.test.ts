import { normalizeWhatsAppUpdate } from './normalizer';
import { describe, expect, it } from 'vitest';
import type { WaInboundUpdate } from './types';

const makeUpdate = (overrides?: Partial<WaInboundUpdate>): WaInboundUpdate => ({
  channelMessageId: 'msg-1',
  channelChatId: '1234567890@s.whatsapp.net',
  senderId: '1234567890@s.whatsapp.net',
  senderName: 'Alice',
  body: 'hello',
  timestamp: 1700000000000,
  chatType: 'direct',
  fromMe: false,
  ...overrides,
});

/** Config that accepts all directions — used by tests that don't focus on direction filtering */
const acceptAll = { acceptFromMe: true, acceptFromOthers: true };

describe('normalizeWhatsAppUpdate', () => {
  it('converts a text DM to NormalizedUpdate', () => {
    const result = normalizeWhatsAppUpdate(makeUpdate(), acceptAll);
    expect(result).toEqual({
      message: {
        channelMessageId: 'msg-1',
        channelChatId: '1234567890@s.whatsapp.net',
        senderId: '1234567890@s.whatsapp.net',
        senderName: 'Alice',
        senderUsername: '1234567890',
        body: 'hello',
        timestamp: 1700000000000,
        chatType: 'direct',
        fromMe: false,
      },
      offset: 1700000000000,
    });
  });

  it('skips empty messages', () => {
    expect(normalizeWhatsAppUpdate(makeUpdate({ body: '' }), acceptAll)).toBeNull();
    expect(normalizeWhatsAppUpdate(makeUpdate({ body: '   ' }), acceptAll)).toBeNull();
  });

  it('maps group chat type correctly', () => {
    const result = normalizeWhatsAppUpdate(
      makeUpdate({
        channelChatId: 'group@g.us',
        chatType: 'group',
      }),
      acceptAll,
    );
    expect(result?.message.chatType).toBe('group');
  });

  it('uses timestamp as offset', () => {
    const result = normalizeWhatsAppUpdate(makeUpdate({ timestamp: 1700000005000 }), acceptAll);
    expect(result?.offset).toBe(1700000005000);
  });

  it('preserves senderName when present', () => {
    const result = normalizeWhatsAppUpdate(makeUpdate({ senderName: 'Bob' }), acceptAll);
    expect(result?.message.senderName).toBe('Bob');
  });

  it('handles missing senderName', () => {
    const result = normalizeWhatsAppUpdate(makeUpdate({ senderName: undefined }), acceptAll);
    expect(result?.message.senderName).toBeUndefined();
  });

  it('passes fromMe through to normalized output', () => {
    const fromMeResult = normalizeWhatsAppUpdate(makeUpdate({ fromMe: true }), acceptAll);
    expect(fromMeResult?.message.fromMe).toBe(true);

    const notFromMeResult = normalizeWhatsAppUpdate(makeUpdate({ fromMe: false }), acceptAll);
    expect(notFromMeResult?.message.fromMe).toBe(false);
  });
});

describe('normalizeWhatsAppUpdate — direction config', () => {
  it('default config accepts fromMe but skips fromOthers', () => {
    // Default: acceptFromMe=true, acceptFromOthers=false
    expect(normalizeWhatsAppUpdate(makeUpdate({ fromMe: true }))).not.toBeNull();
    expect(normalizeWhatsAppUpdate(makeUpdate({ fromMe: false }))).toBeNull();
  });

  it('acceptFromMe: true allows fromMe messages', () => {
    const result = normalizeWhatsAppUpdate(makeUpdate({ fromMe: true }), { acceptFromMe: true });
    expect(result).not.toBeNull();
    expect(result?.message.body).toBe('hello');
  });

  it('acceptFromMe: false skips fromMe messages', () => {
    expect(
      normalizeWhatsAppUpdate(makeUpdate({ fromMe: true }), { acceptFromMe: false }),
    ).toBeNull();
  });

  it('acceptFromOthers: true allows non-fromMe messages', () => {
    const result = normalizeWhatsAppUpdate(makeUpdate({ fromMe: false }), {
      acceptFromOthers: true,
    });
    expect(result).not.toBeNull();
    expect(result?.message.body).toBe('hello');
  });

  it('acceptFromOthers: false skips non-fromMe messages', () => {
    expect(
      normalizeWhatsAppUpdate(makeUpdate({ fromMe: false }), { acceptFromOthers: false }),
    ).toBeNull();
  });

  it('both true allows all messages', () => {
    const cfg = { acceptFromMe: true, acceptFromOthers: true };
    expect(normalizeWhatsAppUpdate(makeUpdate({ fromMe: true }), cfg)).not.toBeNull();
    expect(normalizeWhatsAppUpdate(makeUpdate({ fromMe: false }), cfg)).not.toBeNull();
  });

  it('both false skips all messages', () => {
    const cfg = { acceptFromMe: false, acceptFromOthers: false };
    expect(normalizeWhatsAppUpdate(makeUpdate({ fromMe: true }), cfg)).toBeNull();
    expect(normalizeWhatsAppUpdate(makeUpdate({ fromMe: false }), cfg)).toBeNull();
  });
});
