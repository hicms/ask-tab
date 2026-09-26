import { formatTelegramHtml } from './format';
import { AskServiceError, requestAuthorized } from '../../ask-service/client';
import { splitMessage } from '../utils';
import type { TgGetFileResponse, TgSendMessageResponse } from './types';

const TG_FETCH_TIMEOUT_MS = 15_000;

interface TgResponse {
  ok: boolean;
  description?: string;
}

/**
 * Call a Bot API method through the AskTab server, which holds the bot token.
 * Telegram rejections come back as `{ ok: false, description }` like the Bot API itself.
 */
const callBot = async <T extends TgResponse>(
  method: string,
  body: Record<string, unknown> | FormData,
): Promise<T> => {
  const init: RequestInit = {
    method: 'POST',
    signal: AbortSignal.timeout(TG_FETCH_TIMEOUT_MS),
  };
  if (body instanceof FormData) {
    init.body = body;
  } else {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  try {
    const response = await requestAuthorized(`/api/channels/telegram/bot/${method}`, init);
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof AskServiceError) return { ok: false, description: err.message } as T;
    throw err;
  }
};

const MAX_TG_MESSAGE_LENGTH = 4096;

/** Send a text message, splitting at 4096 chars and retrying without parse_mode on failure */
const sendTelegramMessage = async (chatId: string, text: string): Promise<void> => {
  const chunks = splitMessage(text, MAX_TG_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    await sendSingleMessage(chatId, chunk);
  }
};

const sendSingleMessage = async (chatId: string, text: string): Promise<TgSendMessageResponse> => {
  const data = await callBot<TgSendMessageResponse>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });

  if (!data.ok && data.description?.includes('parse')) {
    const retryData = await callBot<TgSendMessageResponse>('sendMessage', {
      chat_id: chatId,
      text,
    });
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

/** Register bot commands with Telegram via setMyCommands API */
const setMyCommands = async (
  commands: Array<{ command: string; description: string }>,
): Promise<void> => {
  const data = await callBot<TgResponse>('setMyCommands', { commands });
  if (!data.ok) {
    throw new Error(`setMyCommands failed: ${data.description ?? 'Unknown error'}`);
  }
};

/** Send a chat action (e.g. "typing") indicator */
const sendChatAction = async (chatId: string, action: string = 'typing'): Promise<void> => {
  await callBot<TgResponse>('sendChatAction', { chat_id: chatId, action });
};

/** Send an HTML-formatted message. Returns the message_id if successful. */
const sendHtmlMessage = async (chatId: string, html: string): Promise<number | undefined> => {
  const data = await callBot<TgSendMessageResponse>('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
  });
  if (!data.ok) {
    throw new Error(`sendHtmlMessage failed: ${data.description ?? 'Unknown error'}`);
  }
  return data.result?.message_id;
};

/** Edit an existing message's text (HTML parse mode) */
const editMessageText = async (chatId: string, messageId: number, html: string): Promise<void> => {
  const data = await callBot<TgResponse>('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
  });
  if (!data.ok) {
    throw new Error(`editMessageText failed: ${data.description ?? 'Unknown error'}`);
  }
};

/** Get file info (file_path) for downloading */
const getFile = async (fileId: string): Promise<{ filePath: string }> => {
  const data = await callBot<TgGetFileResponse>('getFile', { file_id: fileId });
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`getFile failed: ${data.description ?? 'No file_path'}`);
  }
  return { filePath: data.result.file_path };
};

/** Download a file previously resolved with getFile */
const downloadFile = async (filePath: string): Promise<ArrayBuffer> => {
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  try {
    const response = await requestAuthorized(`/api/channels/telegram/file/${path}`, {
      signal: AbortSignal.timeout(TG_FETCH_TIMEOUT_MS),
    });
    return await response.arrayBuffer();
  } catch (err) {
    if (err instanceof AskServiceError) throw new Error(`downloadFile failed: ${err.message}`);
    throw err;
  }
};

/** Set a reaction emoji on a message */
const setMessageReaction = async (
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<void> => {
  await callBot<TgResponse>('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  });
};

/** Remove all reactions from a message */
const removeMessageReaction = async (chatId: string, messageId: number): Promise<void> => {
  await callBot<TgResponse>('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [],
  });
};

/** Send a voice message (audio displayed as playable bubble in Telegram) */
const sendVoiceMessage = async (
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

  const data = await callBot<TgSendMessageResponse>('sendVoice', form);
  if (!data.ok) {
    throw new Error(`sendVoice failed: ${data.description ?? 'Unknown error'}`);
  }
  return data.result?.message_id;
};

/** Send an audio file (displayed with metadata, not as voice bubble) */
const sendAudioMessage = async (
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

  const data = await callBot<TgSendMessageResponse>('sendAudio', form);
  if (!data.ok) {
    throw new Error(`sendAudio failed: ${data.description ?? 'Unknown error'}`);
  }
  return data.result?.message_id;
};

export {
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
  MAX_TG_MESSAGE_LENGTH,
};
