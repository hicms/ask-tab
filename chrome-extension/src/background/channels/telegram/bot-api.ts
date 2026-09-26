import { formatTelegramHtml } from './format';
import { splitMessage } from '../utils';
import type {
  TgGetFileResponse,
  TgGetMeResponse,
  TgGetUpdatesResponse,
  TgSendMessageResponse,
  TgUpdate,
} from './types';

const TG_API_BASE = 'https://api.telegram.org';
const TG_FETCH_TIMEOUT_MS = 15_000;

const botUrl = (token: string, method: string): string => `${TG_API_BASE}/bot${token}/${method}`;

/** Fetch with a 15-second timeout to prevent hanging calls from blocking the handler */
const tgFetch = (url: string, init?: RequestInit): Promise<Response> => {
  const timeoutSignal = AbortSignal.timeout(TG_FETCH_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;
  return fetch(url, { ...init, signal });
};

/** Validate a bot token via getMe */
const validateBotToken = async (
  token: string,
): Promise<{ valid: boolean; botUser?: { id: number; username?: string }; error?: string }> => {
  try {
    const response = await tgFetch(botUrl(token, 'getMe'));
    const data = (await response.json()) as TgGetMeResponse;
    if (data.ok && data.result) {
      return { valid: true, botUser: { id: data.result.id, username: data.result.username } };
    }
    return { valid: false, error: data.description ?? 'Invalid token' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
};

/** Short-poll getUpdates (timeout=0, used by passive alarm mode) */
const getUpdatesShortPoll = async (token: string, offset?: number): Promise<TgUpdate[]> => {
  const params = new URLSearchParams({
    timeout: '0',
    allowed_updates: JSON.stringify(['message']),
  });
  if (offset !== undefined) {
    params.set('offset', String(offset));
  }

  const response = await tgFetch(`${botUrl(token, 'getUpdates')}?${params}`);
  if (!response.ok) {
    throw new Error(`getUpdates failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as TgGetUpdatesResponse;
  if (!data.ok) {
    throw new Error(`getUpdates error: ${data.description ?? 'Unknown'}`);
  }
  return data.result ?? [];
};

/** Long-poll getUpdates (timeout=25s, used by offscreen doc active mode) */
const getUpdatesLongPoll = async (
  token: string,
  offset?: number,
  signal?: AbortSignal,
): Promise<TgUpdate[]> => {
  const params = new URLSearchParams({
    timeout: '25',
    allowed_updates: JSON.stringify(['message']),
  });
  if (offset !== undefined) {
    params.set('offset', String(offset));
  }

  const response = await fetch(`${botUrl(token, 'getUpdates')}?${params}`, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as TgGetUpdatesResponse;
    if (response.status === 409) {
      throw new ConflictError('Another getUpdates instance is running');
    }
    if (response.status === 401) {
      throw new UnauthorizedError('Bot token is invalid');
    }
    if (response.status === 429 && body.parameters?.retry_after) {
      throw new RateLimitError(body.parameters.retry_after);
    }
    throw new Error(`getUpdates failed: ${response.status}`);
  }
  const data = (await response.json()) as TgGetUpdatesResponse;
  if (!data.ok) {
    throw new Error(`getUpdates error: ${data.description ?? 'Unknown'}`);
  }
  return data.result ?? [];
};

const MAX_TG_MESSAGE_LENGTH = 4096;

/** Send a text message, splitting at 4096 chars and retrying without parse_mode on failure */
const sendTelegramMessage = async (token: string, chatId: string, text: string): Promise<void> => {
  const chunks = splitMessage(text, MAX_TG_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    await sendSingleMessage(token, chatId, chunk);
  }
};

const sendSingleMessage = async (
  token: string,
  chatId: string,
  text: string,
): Promise<TgSendMessageResponse> => {
  // Try with Markdown first
  const response = await tgFetch(botUrl(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });

  const data = (await response.json()) as TgSendMessageResponse;

  if (!data.ok && data.description?.includes('parse')) {
    // F5: Retry without parse_mode on Markdown formatting errors, and check result
    const retryResponse = await tgFetch(botUrl(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const retryData = (await retryResponse.json()) as TgSendMessageResponse;
    if (!retryData.ok) {
      throw new Error(
        `sendMessage failed after retry: ${retryData.description ?? 'Unknown error'}`,
      );
    }
    return retryData;
  }

  if (!data.ok) {
    throw new Error(`sendMessage failed: ${data.description ?? 'Unknown error'}`);
  }

  return data;
};

// Custom error classes for specific Telegram API errors
class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

class RateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super(`Rate limited, retry after ${retryAfter}s`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Register bot commands with Telegram via setMyCommands API */
const setMyCommands = async (
  token: string,
  commands: Array<{ command: string; description: string }>,
): Promise<void> => {
  const response = await tgFetch(botUrl(token, 'setMyCommands'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });

  if (!response.ok) {
    throw new Error(`setMyCommands failed: ${response.status}`);
  }
};

/** Send a chat action (e.g. "typing") indicator */
const sendChatAction = async (
  token: string,
  chatId: string,
  action: string = 'typing',
): Promise<void> => {
  await tgFetch(botUrl(token, 'sendChatAction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
};

/** Send an HTML-formatted message. Returns the message_id if successful. */
const sendHtmlMessage = async (
  token: string,
  chatId: string,
  html: string,
): Promise<number | undefined> => {
  const response = await tgFetch(botUrl(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML' }),
  });
  const data = (await response.json()) as TgSendMessageResponse;
  if (!data.ok) {
    throw new Error(`sendHtmlMessage failed: ${data.description ?? 'Unknown error'}`);
  }
  return data.result?.message_id;
};

/** Edit an existing message's text (HTML parse mode) */
const editMessageText = async (
  token: string,
  chatId: string,
  messageId: number,
  html: string,
): Promise<void> => {
  const response = await tgFetch(botUrl(token, 'editMessageText'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
    }),
  });
  const data = (await response.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`editMessageText failed: ${data.description ?? 'Unknown error'}`);
  }
};

/** Get file info (file_path) for downloading */
const getFile = async (token: string, fileId: string): Promise<{ filePath: string }> => {
  const response = await tgFetch(botUrl(token, 'getFile'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const data = (await response.json()) as TgGetFileResponse;
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`getFile failed: ${data.description ?? 'No file_path'}`);
  }
  return { filePath: data.result.file_path };
};

/** Download a file from Telegram servers */
const downloadFile = async (token: string, filePath: string): Promise<ArrayBuffer> => {
  const url = `${TG_API_BASE}/file/bot${token}/${filePath}`;
  const response = await tgFetch(url);
  if (!response.ok) {
    throw new Error(`downloadFile failed: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
};

/** Set a reaction emoji on a message */
const setMessageReaction = async (
  token: string,
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<void> => {
  await tgFetch(botUrl(token, 'setMessageReaction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji }],
    }),
  });
};

/** Remove all reactions from a message */
const removeMessageReaction = async (
  token: string,
  chatId: string,
  messageId: number,
): Promise<void> => {
  await tgFetch(botUrl(token, 'setMessageReaction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: [],
    }),
  });
};

/** Send a voice message (audio displayed as playable bubble in Telegram) */
const sendVoiceMessage = async (
  token: string,
  chatId: string,
  audio: ArrayBuffer,
  options?: {
    caption?: string;
    replyToMessageId?: number;
    parseMode?: string;
  },
): Promise<number | undefined> => {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('voice', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg');
  if (options?.caption) {
    form.append('caption', options.caption);
    if (options.parseMode) form.append('parse_mode', options.parseMode);
  }
  if (options?.replyToMessageId) {
    form.append('reply_to_message_id', String(options.replyToMessageId));
  }

  const response = await tgFetch(botUrl(token, 'sendVoice'), {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`sendVoice failed: ${data.description ?? 'Unknown error'}`);
  }
  return data.result?.message_id;
};

/** Send an audio file (displayed with metadata, not as voice bubble) */
const sendAudioMessage = async (
  token: string,
  chatId: string,
  audio: ArrayBuffer,
  options?: {
    filename?: string;
    contentType?: string;
    caption?: string;
    replyToMessageId?: number;
  },
): Promise<number | undefined> => {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append(
    'audio',
    new Blob([audio], { type: options?.contentType ?? 'audio/wav' }),
    options?.filename ?? 'audio.wav',
  );
  if (options?.caption) form.append('caption', options.caption);
  if (options?.replyToMessageId) {
    form.append('reply_to_message_id', String(options.replyToMessageId));
  }

  const response = await tgFetch(botUrl(token, 'sendAudio'), {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`sendAudio failed: ${data.description ?? 'Unknown error'}`);
  }
  return data.result?.message_id;
};

export {
  validateBotToken,
  getUpdatesShortPoll,
  getUpdatesLongPoll,
  sendTelegramMessage,
  sendChatAction,
  sendHtmlMessage,
  editMessageText,
  getFile,
  downloadFile,
  setMessageReaction,
  removeMessageReaction,
  sendVoiceMessage,
  sendAudioMessage,
  setMyCommands,
  formatTelegramHtml,
  ConflictError,
  UnauthorizedError,
  RateLimitError,
  MAX_TG_MESSAGE_LENGTH,
};
