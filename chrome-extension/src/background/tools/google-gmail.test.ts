/**
 * Tests for google-gmail.ts — Gmail tool schemas, MIME encoding, response parsing.
 * Mocks googleFetch to avoid real API calls.
 */

import {
  extractTextBody,
  getHeader,
  buildMimeMessage,
  encodeBase64Url,
  decodeBase64Url,
} from './google-gmail';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock ──
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── google-auth mock ──
const mockGoogleFetch = vi.fn();
vi.mock('./google-auth', () => ({
  googleFetch: (...args: unknown[]) => mockGoogleFetch(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper tests ──

describe('encodeBase64Url / decodeBase64Url', () => {
  it('round-trips ASCII text', () => {
    const original = 'Hello, World!';
    const encoded = encodeBase64Url(original);
    const decoded = decodeBase64Url(encoded);
    expect(decoded).toBe(original);
  });

  it('produces URL-safe characters (no +, /, =)', () => {
    const encoded = encodeBase64Url('test string with special chars!!!');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('round-trips Unicode text (UTF-8 safe)', () => {
    const original = '你好世界 🌍 café résumé';
    const encoded = encodeBase64Url(original);
    const decoded = decodeBase64Url(encoded);
    expect(decoded).toBe(original);
  });
});

describe('getHeader', () => {
  const headers = [
    { name: 'From', value: 'alice@example.com' },
    { name: 'Subject', value: 'Test Email' },
    { name: 'Date', value: '2026-02-25' },
  ];

  it('finds header by name (case-insensitive)', () => {
    expect(getHeader(headers, 'from')).toBe('alice@example.com');
    expect(getHeader(headers, 'FROM')).toBe('alice@example.com');
    expect(getHeader(headers, 'Subject')).toBe('Test Email');
  });

  it('returns empty string for missing header', () => {
    expect(getHeader(headers, 'Cc')).toBe('');
  });

  it('returns empty string for undefined headers', () => {
    expect(getHeader(undefined, 'From')).toBe('');
  });
});

describe('extractTextBody', () => {
  it('extracts text/plain body from simple message', () => {
    // Replace standard base64 chars with base64url
    const urlSafe = btoa('Hello plain text')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const part = {
      mimeType: 'text/plain',
      body: { data: urlSafe, size: 16 },
    };
    const result = extractTextBody(part);
    expect(result).toBe('Hello plain text');
  });

  it('prefers text/plain in multipart', () => {
    const plainData = btoa('Plain version')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const htmlData = btoa('<p>HTML version</p>')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const part = {
      mimeType: 'multipart/alternative',
      body: { data: undefined, size: 0 },
      parts: [
        { mimeType: 'text/html', body: { data: htmlData, size: 20 } },
        { mimeType: 'text/plain', body: { data: plainData, size: 13 } },
      ],
    };
    expect(extractTextBody(part)).toBe('Plain version');
  });

  it('falls back to stripped HTML when no text/plain', () => {
    const htmlData = btoa('<p>Hello <b>World</b></p>')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const part = {
      mimeType: 'multipart/alternative',
      body: { data: undefined, size: 0 },
      parts: [{ mimeType: 'text/html', body: { data: htmlData, size: 25 } }],
    };
    const result = extractTextBody(part);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<b>');
  });

  it('returns empty string when no content', () => {
    const part = {
      mimeType: 'multipart/mixed',
      body: { data: undefined, size: 0 },
      parts: [{ mimeType: 'image/png', body: { data: undefined, size: 0 } }],
    };
    expect(extractTextBody(part)).toBe('');
  });
});

describe('buildMimeMessage', () => {
  it('builds basic RFC 2822 message', () => {
    const mime = buildMimeMessage({
      to: 'bob@example.com',
      subject: 'Test',
      body: 'Hello Bob!',
    });
    expect(mime).toContain('To: bob@example.com');
    expect(mime).toContain('Subject: Test');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('MIME-Version: 1.0');
    expect(mime).toContain('Hello Bob!');
  });

  it('includes Cc and Bcc when provided', () => {
    const mime = buildMimeMessage({
      to: 'bob@example.com',
      subject: 'Test',
      body: 'Hello',
      cc: 'charlie@example.com',
      bcc: 'dave@example.com',
    });
    expect(mime).toContain('Cc: charlie@example.com');
    expect(mime).toContain('Bcc: dave@example.com');
  });

  it('omits Cc/Bcc when not provided', () => {
    const mime = buildMimeMessage({
      to: 'bob@example.com',
      subject: 'Test',
      body: 'Hello',
    });
    expect(mime).not.toContain('Cc:');
    expect(mime).not.toContain('Bcc:');
  });
});

// ── Gmail tool executor tests (via mock googleFetch) ──

describe('executeGmailSearch', () => {
  it('returns empty messages when no results', async () => {
    mockGoogleFetch.mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 });

    const { executeGmailSearch } = await import('./google-gmail');
    const result = await executeGmailSearch({ query: 'is:unread' });
    expect(result.messages).toEqual([]);
    expect(result.totalEstimate).toBe(0);
  });

  it('fetches metadata for each message', async () => {
    // First call: list messages
    mockGoogleFetch.mockResolvedValueOnce({
      messages: [{ id: 'msg1', threadId: 't1' }],
      resultSizeEstimate: 1,
    });
    // Second call: get message metadata
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'msg1',
      threadId: 't1',
      snippet: 'Test snippet',
      payload: {
        headers: [
          { name: 'From', value: 'alice@example.com' },
          { name: 'To', value: 'bob@example.com' },
          { name: 'Subject', value: 'Hello' },
          { name: 'Date', value: 'Mon, 25 Feb 2026' },
        ],
      },
    });

    const { executeGmailSearch } = await import('./google-gmail');
    const result = await executeGmailSearch({ query: 'from:alice', maxResults: 5 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].from).toBe('alice@example.com');
    expect(result.messages[0].subject).toBe('Hello');
  });
});

describe('executeGmailRead', () => {
  it('parses full message with text body', async () => {
    const bodyData = btoa('Email body content')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'msg1',
      threadId: 't1',
      snippet: 'snippet',
      internalDate: '1740000000000',
      payload: {
        mimeType: 'text/plain',
        body: { data: bodyData, size: 18 },
        headers: [
          { name: 'From', value: 'sender@example.com' },
          { name: 'To', value: 'recipient@example.com' },
          { name: 'Subject', value: 'Test Subject' },
          { name: 'Date', value: 'Tue, 25 Feb 2026' },
        ],
      },
    });

    const { executeGmailRead } = await import('./google-gmail');
    const result = await executeGmailRead({ messageId: 'msg1' });
    expect(result.from).toBe('sender@example.com');
    expect(result.subject).toBe('Test Subject');
    expect(result.body).toBe('Email body content');
  });
});

describe('executeGmailSend', () => {
  it('sends email and returns result', async () => {
    mockGoogleFetch.mockResolvedValueOnce({ id: 'sent1', threadId: 't1' });

    const { executeGmailSend } = await import('./google-gmail');
    const result = await executeGmailSend({
      to: 'bob@example.com',
      subject: 'Test',
      body: 'Hello!',
    });
    expect(result.status).toBe('sent');
    expect(result.id).toBe('sent1');

    // Verify the raw MIME message was sent
    const callArgs = mockGoogleFetch.mock.calls[0];
    expect(callArgs[0]).toContain('/messages/send');
    const body = JSON.parse((callArgs[2] as RequestInit).body as string);
    expect(body.raw).toBeTruthy();
  });
});

describe('executeGmailDraft', () => {
  it('creates draft and returns result', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'draft1',
      message: { id: 'msg1', threadId: 't1' },
    });

    const { executeGmailDraft } = await import('./google-gmail');
    const result = await executeGmailDraft({
      to: 'bob@example.com',
      subject: 'Draft Test',
      body: 'Draft body',
    });
    expect(result.status).toBe('draft_created');
    expect(result.draftId).toBe('draft1');
  });
});
