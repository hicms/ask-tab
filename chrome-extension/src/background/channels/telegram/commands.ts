import { sendTelegramMessage, setMyCommands } from './bot-api';
import { createLogger } from '../../logging/logger-buffer';
import { resolveModel } from '../agent-handler';
import { getChannelConfig } from '../config';
import {
  findChatByChannelChatId,
  deleteChat,
  getMessagesByChatId,
  ttsConfigStorage,
} from '@extension/storage';
import type { TtsAutoMode } from '../../tts/types';
import type { ChannelInboundMessage } from '../types';

const cmdLog = createLogger('channel-cmd');

const BOT_COMMANDS = [
  { command: 'start', description: 'Welcome message' },
  { command: 'help', description: 'Show available commands' },
  { command: 'reset', description: 'Start a new conversation' },
  { command: 'status', description: 'Show model and usage info' },
  { command: 'tts', description: 'TTS voice reply settings' },
];

/** Register bot commands with Telegram (call once on enable) */
const registerBotCommands = async (botToken: string): Promise<void> => {
  try {
    await setMyCommands(botToken, BOT_COMMANDS);
    cmdLog.debug('Bot commands registered');
  } catch (err) {
    cmdLog.warn('Failed to register bot commands', { error: String(err) });
  }
};

/** Check if a message body is a bot command */
const isBotCommand = (body: string): boolean => body.startsWith('/') && /^\/[a-z]+/.test(body);

/** Handle a bot command. Returns true if handled, false if not a recognized command. */
const handleBotCommand = async (msg: ChannelInboundMessage, botToken: string): Promise<boolean> => {
  const raw = msg.body.trim().split(/\s+/)[0].toLowerCase();
  // Strip @botname suffix (e.g. /start@mybot)
  const command = raw.split('@')[0];

  switch (command) {
    case '/start':
      await handleStart(msg, botToken);
      return true;
    case '/help':
      await handleHelp(msg, botToken);
      return true;
    case '/reset':
      await handleReset(msg, botToken);
      return true;
    case '/status':
      await handleStatus(msg, botToken);
      return true;
    case '/tts':
      await handleTts(msg, botToken);
      return true;
    default:
      return false;
  }
};

const handleStart = async (msg: ChannelInboundMessage, botToken: string): Promise<void> => {
  const name = msg.senderName ?? 'there';
  const text =
    `Hello ${name}! I'm your AskTab AI assistant.\n\n` +
    `Send me any message and I'll respond using your configured AI model. ` +
    `You can also send voice notes and I'll transcribe them.\n\n` +
    `Use /help to see available commands.`;
  await sendTelegramMessage(botToken, msg.channelChatId, text);
};

const handleHelp = async (msg: ChannelInboundMessage, botToken: string): Promise<void> => {
  const lines = BOT_COMMANDS.map(c => `/${c.command} — ${c.description}`);
  const text = `Available commands:\n\n${lines.join('\n')}`;
  await sendTelegramMessage(botToken, msg.channelChatId, text);
};

const handleReset = async (msg: ChannelInboundMessage, botToken: string): Promise<void> => {
  const existing = await findChatByChannelChatId('telegram', msg.channelChatId);
  if (existing) {
    await deleteChat(existing.id);
    cmdLog.info('Chat reset via /reset', { chatId: existing.id });
  }
  await sendTelegramMessage(
    botToken,
    msg.channelChatId,
    'Conversation reset. Send a new message to start fresh.',
  );
};

const handleStatus = async (msg: ChannelInboundMessage, botToken: string): Promise<void> => {
  const config = await getChannelConfig('telegram');
  const model = config ? await resolveModel(config) : null;

  const lines: string[] = [];
  lines.push(`Model: ${model?.name ?? 'Not configured'}`);
  lines.push(`Provider: ${model?.provider ?? 'N/A'}`);

  const existing = await findChatByChannelChatId('telegram', msg.channelChatId);
  if (existing) {
    const messages = await getMessagesByChatId(existing.id);
    lines.push(`Messages in conversation: ${messages.length}`);
  } else {
    lines.push('No active conversation');
  }

  lines.push(`Channel status: ${config?.status ?? 'unknown'}`);

  await sendTelegramMessage(botToken, msg.channelChatId, lines.join('\n'));
};

const VALID_AUTO_MODES = new Set<TtsAutoMode>(['off', 'always', 'inbound']);

const handleTts = async (msg: ChannelInboundMessage, botToken: string): Promise<void> => {
  const parts = msg.body.trim().split(/\s+/);
  const subcommand = (parts[1] ?? 'status').toLowerCase();

  const ttsConfig = await ttsConfigStorage.get();

  if (subcommand === 'status') {
    const lines = [
      'TTS Settings',
      `Engine: ${ttsConfig.engine}`,
      `Mode: ${ttsConfig.autoMode}`,
      `Voice: ${ttsConfig.engine === 'kokoro' ? ttsConfig.kokoro.voice : ttsConfig.openai.voice}`,
      `Speed: ${ttsConfig.engine === 'kokoro' ? ttsConfig.kokoro.speed : 'N/A'}`,
      `Summarize: ${ttsConfig.summarize ? 'on' : 'off'}`,
      `Max chars: ${ttsConfig.maxChars}`,
    ];
    await sendTelegramMessage(botToken, msg.channelChatId, lines.join('\n'));
    return;
  }

  if (subcommand === 'on') {
    await ttsConfigStorage.set({ ...ttsConfig, autoMode: 'always' });
    await sendTelegramMessage(botToken, msg.channelChatId, 'TTS enabled (mode: always).');
    return;
  }

  if (subcommand === 'off') {
    await ttsConfigStorage.set({ ...ttsConfig, autoMode: 'off' });
    await sendTelegramMessage(botToken, msg.channelChatId, 'TTS disabled.');
    return;
  }

  if (VALID_AUTO_MODES.has(subcommand as TtsAutoMode)) {
    await ttsConfigStorage.set({ ...ttsConfig, autoMode: subcommand as TtsAutoMode });
    await sendTelegramMessage(botToken, msg.channelChatId, `TTS mode set to: ${subcommand}.`);
    return;
  }

  // Unknown subcommand → usage help
  const usage = [
    'TTS Commands:',
    '/tts — Show current settings',
    '/tts on — Enable TTS (always mode)',
    '/tts off — Disable TTS',
    '/tts always — Auto-TTS for all replies',
    '/tts inbound — TTS only when you send voice',
  ];
  await sendTelegramMessage(botToken, msg.channelChatId, usage.join('\n'));
};

export { handleBotCommand, isBotCommand, registerBotCommands };
