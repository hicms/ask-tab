/**
 * Gmail tools — search, read, send, and draft emails via Gmail REST API.
 *
 * Uses chrome.identity OAuth via the shared google-auth helper.
 * Scopes are requested lazily at tool execution time.
 */

import { googleFetch } from './google-auth';
import { jsonFormatResult } from './tool-registration';
import { createLogger } from '../logging/logger-buffer';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration } from './tool-registration';
import type { Static } from '@sinclair/typebox';

const gmailLog = createLogger('tool');

// ── Scopes ──

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ── Schemas ──

const gmailSearchSchema = Type.Object({
  query: Type.String({
    description:
      'Gmail search query (supports Gmail search syntax like "is:unread", "from:alice@example.com", "newer_than:7d")',
  }),
  maxResults: Type.Optional(
    Type.Number({ description: 'Maximum number of results (default 10)', default: 10 }),
  ),
});

const gmailReadSchema = Type.Object({
  messageId: Type.String({ description: 'The Gmail message ID to read' }),
});

const gmailSendSchema = Type.Object({
  to: Type.String({ description: 'Recipient email address' }),
  subject: Type.String({ description: 'Email subject line' }),
  body: Type.String({ description: 'Email body text' }),
  cc: Type.Optional(Type.String({ description: 'CC recipients (comma-separated)' })),
  bcc: Type.Optional(Type.String({ description: 'BCC recipients (comma-separated)' })),
});

const gmailDraftSchema = Type.Object({
  to: Type.String({ description: 'Recipient email address' }),
  subject: Type.String({ description: 'Email subject line' }),
  body: Type.String({ description: 'Email body text' }),
  cc: Type.Optional(Type.String({ description: 'CC recipients (comma-separated)' })),
  bcc: Type.Optional(Type.String({ description: 'BCC recipients (comma-separated)' })),
});

type GmailSearchArgs = Static<typeof gmailSearchSchema>;
type GmailReadArgs = Static<typeof gmailReadSchema>;
type GmailSendArgs = Static<typeof gmailSendSchema>;
type GmailDraftArgs = Static<typeof gmailDraftSchema>;

// ── Gmail API types ──

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body: { data?: string; size: number };
  parts?: GmailMessagePart[];
  headers?: GmailHeader[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  payload: GmailMessagePart;
}

// ── Helpers ──

/** Decode base64url-encoded string (UTF-8 safe). */
const decodeBase64Url = (data: string): string => {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.codePointAt(0)!);
  return new TextDecoder().decode(bytes);
};

/** Encode string to base64url (UTF-8 safe). */
const encodeBase64Url = (str: string): string => {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, b => String.fromCodePoint(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Extract plain text body from a Gmail message payload (multipart MIME). */
const extractTextBody = (part: GmailMessagePart): string => {
  // Direct text/plain body
  if (part.mimeType === 'text/plain' && part.body.data) {
    return decodeBase64Url(part.body.data);
  }

  // Recurse into multipart
  if (part.parts) {
    // Prefer text/plain
    for (const sub of part.parts) {
      if (sub.mimeType === 'text/plain' && sub.body.data) {
        return decodeBase64Url(sub.body.data);
      }
    }
    // Fallback: strip HTML from text/html
    for (const sub of part.parts) {
      if (sub.mimeType === 'text/html' && sub.body.data) {
        const html = decodeBase64Url(sub.body.data);
        return html
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    // Recurse deeper (nested multipart)
    for (const sub of part.parts) {
      const text = extractTextBody(sub);
      if (text) return text;
    }
  }

  // Fallback: HTML body at top level
  if (part.mimeType === 'text/html' && part.body.data) {
    const html = decodeBase64Url(part.body.data);
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
};

/** Get a header value by name (case-insensitive). */
const getHeader = (headers: GmailHeader[] | undefined, name: string): string => {
  if (!headers) return '';
  const lower = name.toLowerCase();
  return headers.find(h => h.name.toLowerCase() === lower)?.value ?? '';
};

/** Build RFC 2822 MIME message. */
const buildMimeMessage = (args: GmailSendArgs | GmailDraftArgs): string => {
  const lines: string[] = [];
  lines.push(`To: ${args.to}`);
  if (args.cc) lines.push(`Cc: ${args.cc}`);
  if (args.bcc) lines.push(`Bcc: ${args.bcc}`);
  lines.push(`Subject: ${args.subject}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('MIME-Version: 1.0');
  lines.push('');
  lines.push(args.body);
  return lines.join('\r\n');
};

// ── Tool executors ──

const executeGmailSearch = async (args: GmailSearchArgs) => {
  const maxResults = args.maxResults ?? 10;
  gmailLog.trace('[gmail_search] execute', { query: args.query, maxResults });

  const q = encodeURIComponent(args.query);
  const listData = await googleFetch<GmailMessageListResponse>(
    `${GMAIL_API}/messages?q=${q}&maxResults=${maxResults}`,
    [GMAIL_READONLY],
  );

  if (!listData.messages?.length) {
    return { messages: [], totalEstimate: 0 };
  }

  // Fetch metadata for each message (batch via individual requests to keep it simple)
  const messages = await Promise.all(
    listData.messages.map(async m => {
      const msg = await googleFetch<GmailMessage>(
        `${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        [GMAIL_READONLY],
      );
      const headers = msg.payload.headers;
      return {
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        snippet: msg.snippet,
      };
    }),
  );

  return { messages, totalEstimate: listData.resultSizeEstimate ?? messages.length };
};

const executeGmailRead = async (args: GmailReadArgs) => {
  gmailLog.trace('[gmail_read] execute', { messageId: args.messageId });

  const msg = await googleFetch<GmailMessage>(
    `${GMAIL_API}/messages/${encodeURIComponent(args.messageId)}?format=full`,
    [GMAIL_READONLY],
  );

  const headers = msg.payload.headers;
  const body = extractTextBody(msg.payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    cc: getHeader(headers, 'Cc'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    body,
  };
};

const executeGmailSend = async (args: GmailSendArgs) => {
  gmailLog.trace('[gmail_send] execute', { to: args.to, subject: args.subject });

  const mimeMessage = buildMimeMessage(args);
  const encoded = encodeBase64Url(mimeMessage);

  const result = await googleFetch<{ id: string; threadId: string }>(
    `${GMAIL_API}/messages/send`,
    [GMAIL_SEND],
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded }),
    },
  );

  return { id: result.id, threadId: result.threadId, status: 'sent' };
};

const executeGmailDraft = async (args: GmailDraftArgs) => {
  gmailLog.trace('[gmail_draft] execute', { to: args.to, subject: args.subject });

  const mimeMessage = buildMimeMessage(args);
  const encoded = encodeBase64Url(mimeMessage);

  const result = await googleFetch<{ id: string; message: { id: string; threadId: string } }>(
    `${GMAIL_API}/drafts`,
    [GMAIL_COMPOSE],
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } }),
    },
  );

  return { draftId: result.id, messageId: result.message.id, status: 'draft_created' };
};

// ── Tool registration ──

const gmailToolDefs: ToolRegistration[] = [
  {
    name: 'gmail_search',
    label: 'Gmail Search',
    description:
      'Search Gmail for emails. Supports Gmail search syntax (e.g. "is:unread", "from:alice@example.com", "newer_than:7d"). Returns message ID, from, to, subject, snippet, and date.',
    schema: gmailSearchSchema,
    execute: args => executeGmailSearch(args as GmailSearchArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'gmail_read',
    label: 'Gmail Read',
    description:
      'Read the full content of a Gmail email by message ID. Returns parsed headers and plain text body.',
    schema: gmailReadSchema,
    execute: args => executeGmailRead(args as GmailReadArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'gmail_send',
    label: 'Gmail Send',
    description: 'Send an email via Gmail. Requires to, subject, and body. Optional cc and bcc.',
    schema: gmailSendSchema,
    execute: args => executeGmailSend(args as GmailSendArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'gmail_draft',
    label: 'Gmail Draft',
    description:
      'Create a draft email in Gmail. Same parameters as sending but saves as draft instead.',
    schema: gmailDraftSchema,
    execute: args => executeGmailDraft(args as GmailDraftArgs),
    formatResult: jsonFormatResult,
  },
];

export {
  gmailSearchSchema,
  gmailReadSchema,
  gmailSendSchema,
  gmailDraftSchema,
  executeGmailSearch,
  executeGmailRead,
  executeGmailSend,
  executeGmailDraft,
  // Exported for testing
  extractTextBody,
  getHeader,
  buildMimeMessage,
  encodeBase64Url,
  decodeBase64Url,
  gmailToolDefs,
};
export type { GmailSearchArgs, GmailReadArgs, GmailSendArgs, GmailDraftArgs };
