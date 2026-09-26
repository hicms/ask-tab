import { diagnostics } from '../diagnostics.js';
import { t } from '@extension/i18n';
import { getMessagesByChatId } from '@extension/storage';
import { toast } from 'sonner';
import type { ChatMessage } from '../chat-types.js';
import type { SlashCommandDef } from './types.js';

const compactCommand: SlashCommandDef = {
  name: 'compact',
  description: 'Summarize older messages and free up context space',
  execute: async ctx => {
    diagnostics.debug(
      '[slash-cmd] /compact: chatId=%s, messageCount=%d',
      ctx.chatId,
      ctx.messages.length,
    );
    if (ctx.messages.length <= 2) {
      toast.error(t('slash_notEnoughMessages'));
      return;
    }

    toast.info(t('slash_compacting'));
    ctx.clearInput();
    ctx.setIsCompacting(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'COMPACT_REQUEST',
        chatId: ctx.chatId,
        modelConfig: ctx.model,
      });

      if (!response || response.error) {
        const errMsg = response?.error ?? t('slash_noResponse');
        diagnostics.debug('[slash-cmd] /compact: background returned error:', errMsg);
        toast.error(errMsg);
        return;
      }

      diagnostics.debug('[slash-cmd] /compact: compaction succeeded', {
        summaryLength: (response.summary ?? '').length,
        tokensBefore: response.tokensBefore,
        tokensAfter: response.tokensAfter,
        messagesDropped: response.messagesDropped,
        compactionMethod: response.compactionMethod,
        durationMs: response.durationMs,
      });
      const freshMsgs = await getMessagesByChatId(ctx.chatId);
      // freshMsgs already contains the __compaction_summary__ message saved by the background handler.
      // Only prepend a synthetic summary if IndexedDB doesn't already have one.
      // NOTE: This ID is coupled with compactMessagesWithSummary in compaction.ts —
      // if that ID changes, this check will silently break.
      const hasSummary = (freshMsgs as ChatMessage[]).some(m => m.id === '__compaction_summary__');
      const msgs: ChatMessage[] = hasSummary
        ? (freshMsgs as ChatMessage[])
        : [
            {
              id: '__compaction_summary__',
              chatId: ctx.chatId,
              role: 'system',
              parts: [
                {
                  type: 'text',
                  text: response.summary
                    ? `${t('slash_conversationSummary')}\n${response.summary}`
                    : t('slash_earlierCompacted'),
                },
              ],
              createdAt: Date.now(),
            },
            ...(freshMsgs as ChatMessage[]),
          ];
      ctx.replaceMessages(msgs);
      ctx.incrementCompactionCount();

      const fmtTokens = (n: number): string =>
        n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      const saved =
        response.tokensBefore && response.tokensAfter
          ? response.tokensBefore - response.tokensAfter
          : undefined;
      const detail =
        saved != null && saved > 0
          ? `${t('slash_compactSuccess')} (~${fmtTokens(saved)} tokens freed, ${response.compactionMethod})`
          : t('slash_compactSuccess');
      toast.success(detail);
    } catch (err) {
      diagnostics.debug('[slash-cmd] /compact: error', err);
      toast.error(err instanceof Error ? err.message : t('slash_compactFailed'));
    } finally {
      ctx.setIsCompacting(false);
    }
  },
};

export { compactCommand };
