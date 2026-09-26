import { t } from '@extension/i18n';
import { toast } from 'sonner';
import type { SlashCommandDef } from './types.js';

const copyCommand: SlashCommandDef = {
  name: 'copy',
  description: 'Copy last response to clipboard (/copy N for Nth-latest)',
  execute: async ctx => {
    const n = ctx.args ? parseInt(ctx.args, 10) : 1;
    if (isNaN(n) || n < 1) {
      toast.error(t('slash_invalidCopyArg'));
      return;
    }

    const assistantMessages = ctx.messages.filter(m => m.role === 'assistant');
    if (assistantMessages.length === 0 || n > assistantMessages.length) {
      toast.error(t('slash_noAssistantMessage'));
      return;
    }

    const target = assistantMessages[assistantMessages.length - n];
    const text = target.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join('\n');

    if (!text) {
      toast.error(t('slash_noAssistantMessage'));
      return;
    }

    await navigator.clipboard.writeText(text);
    ctx.clearInput();
    toast.success(t('slash_copied'));
  },
};

export { copyCommand };
