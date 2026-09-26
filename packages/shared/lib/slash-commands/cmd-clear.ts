import { diagnostics } from '../diagnostics.js';
import { t } from '@extension/i18n';
import { deleteMessagesByChatId } from '@extension/storage';
import { toast } from 'sonner';
import type { SlashCommandDef } from './types.js';

const clearCommand: SlashCommandDef = {
  name: 'clear',
  description: 'Clear all messages in this conversation',
  execute: async ctx => {
    diagnostics.debug('[slash-cmd] /clear: clearing messages for chat', ctx.chatId);
    await deleteMessagesByChatId(ctx.chatId);
    ctx.replaceMessages([]);
    ctx.resetUsage();
    ctx.clearInput();
    diagnostics.debug('[slash-cmd] /clear: done');
    toast.success(t('slash_conversationCleared'));
  },
};

export { clearCommand };
