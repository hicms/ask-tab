import { createLogger } from '../../logging/logger-buffer';
import { resolveModel } from '../agent-handler';
import { getChannelConfig } from '../config';
import { describeChannelStatus } from '../gateway';
import { findChatByChannelChatId, deleteChat, getMessagesByChatId } from '@extension/storage';
import type { ChannelAdapter, ChannelInboundMessage } from '../types';

const cmdLog = createLogger('channel-cmd');

const WA_COMMANDS = [
  { command: 'start', description: 'Welcome message' },
  { command: 'help', description: 'Show available commands' },
  { command: 'reset', description: 'Start a new conversation' },
  { command: 'status', description: 'Show model and usage info' },
];

/** Check if a message body is a command */
const isWhatsAppCommand = (body: string): boolean => body.startsWith('/') && /^\/[a-z]+/.test(body);

/** Handle a WhatsApp command. Returns true if handled, false if not recognized. */
const handleWhatsAppCommand = async (
  msg: ChannelInboundMessage,
  adapter: ChannelAdapter,
): Promise<boolean> => {
  const raw = msg.body.trim().split(/\s+/)[0].toLowerCase();
  // Strip @suffix for group compatibility (e.g. /help@botname)
  const command = raw.split('@')[0];

  switch (command) {
    case '/start':
      await handleStart(msg, adapter);
      return true;
    case '/help':
      await handleHelp(msg, adapter);
      return true;
    case '/reset':
      await handleReset(msg, adapter);
      return true;
    case '/status':
      await handleStatus(msg, adapter);
      return true;
    default:
      return false;
  }
};

const handleStart = async (msg: ChannelInboundMessage, adapter: ChannelAdapter): Promise<void> => {
  const name = msg.senderName ?? 'there';
  const text =
    `Hello ${name}! I'm your DeepChat AI assistant.\n\n` +
    `Send me any message and I'll respond using your configured AI model.\n\n` +
    `Use /help to see available commands.`;
  await adapter.sendMessage({ to: msg.channelChatId, text });
};

const handleHelp = async (msg: ChannelInboundMessage, adapter: ChannelAdapter): Promise<void> => {
  const lines = WA_COMMANDS.map(c => `/${c.command} — ${c.description}`);
  const text = `Available commands:\n\n${lines.join('\n')}`;
  await adapter.sendMessage({ to: msg.channelChatId, text });
};

const handleReset = async (msg: ChannelInboundMessage, adapter: ChannelAdapter): Promise<void> => {
  const existing = await findChatByChannelChatId('whatsapp', msg.channelChatId);
  if (existing) {
    await deleteChat(existing.id);
    cmdLog.info('Chat reset via /reset', { chatId: existing.id });
  }
  await adapter.sendMessage({
    to: msg.channelChatId,
    text: 'Conversation reset. Send a new message to start fresh.',
  });
};

const handleStatus = async (msg: ChannelInboundMessage, adapter: ChannelAdapter): Promise<void> => {
  const config = await getChannelConfig('whatsapp');
  const model = config ? await resolveModel(config) : null;

  const lines: string[] = [];
  lines.push(`Model: ${model?.name ?? 'Not configured'}`);
  lines.push(`Provider: ${model?.provider ?? 'N/A'}`);

  const existing = await findChatByChannelChatId('whatsapp', msg.channelChatId);
  if (existing) {
    const messages = await getMessagesByChatId(existing.id);
    lines.push(`Messages in conversation: ${messages.length}`);
  } else {
    lines.push('No active conversation');
  }

  lines.push(`Channel status: ${await describeChannelStatus('whatsapp')}`);

  await adapter.sendMessage({ to: msg.channelChatId, text: lines.join('\n') });
};

export { handleWhatsAppCommand, isWhatsAppCommand };
