import { ChatQueuedMessageIcon, ChatQueueIcon } from './chat-action-icons';
import { Button } from './ui';
import { useT } from '@extension/i18n';
import { XIcon } from 'lucide-react';
import type { ChatQueuePauseReason, ChatQueueState } from '@extension/shared';

const pauseLabels = {
  stopped: 'chat_queuePausedStopped',
  error: 'chat_queuePausedError',
  restarted: 'chat_queuePausedRestarted',
} as const satisfies Record<ChatQueuePauseReason, string>;

type QueuedMessagesProps = {
  queue: ChatQueueState;
  /** Only a running turn can take a steering message. */
  canSteer: boolean;
  onRemove: (itemId: string) => void;
  onSteer: (itemId: string) => void;
  onClear: () => void;
  onResume: () => void;
};

/** Messages waiting for the running turn, shown as the top of the composer. */
const QueuedMessages = ({
  queue,
  canSteer,
  onRemove,
  onSteer,
  onClear,
  onResume,
}: QueuedMessagesProps) => {
  const t = useT();
  const { items, pauseReason } = queue;
  if (items.length === 0) return null;

  return (
    <div className="text-foreground mb-3 space-y-2 text-sm" data-testid="queued-messages">
      <div className="flex items-center justify-between gap-2 px-1">
        <span aria-live="polite" className="text-muted-foreground text-xs font-medium">
          {t('chat_queueTitle', String(items.length))}
        </span>
        <Button
          className="h-6 px-2 text-xs"
          onClick={onClear}
          size="sm"
          type="button"
          variant="ghost">
          {t('chat_queueClear')}
        </Button>
      </div>
      {pauseReason && (
        <div
          className="bg-muted flex items-center justify-between gap-2 rounded-xl px-3 py-2"
          data-testid="queued-messages-paused">
          <span className="text-muted-foreground text-xs">{t(pauseLabels[pauseReason])}</span>
          <Button
            className="h-6 shrink-0 px-2 text-xs"
            onClick={onResume}
            size="sm"
            type="button"
            variant="secondary">
            {t('chat_queueResume')}
          </Button>
        </div>
      )}
      <ul className="max-h-56 space-y-2 overflow-y-auto">
        {items.map(item => (
          <li
            className="bg-muted flex min-h-[68px] items-center gap-3 rounded-xl p-3"
            data-testid="queued-message"
            key={item.id}>
            <ChatQueuedMessageIcon className="text-muted-foreground size-6 shrink-0" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p
                className="line-clamp-2 whitespace-pre-wrap break-words font-medium"
                data-testid="queued-message-text"
                title={item.text}>
                {item.text}
              </p>
              <p
                className="text-muted-foreground truncate text-xs"
                data-testid="queued-message-model"
                title={item.model.name}>
                {item.model.name}
              </p>
              {item.mode === 'steer' && (
                <p className="chat-action-icon flex items-center gap-1 text-xs">
                  <ChatQueueIcon className="size-4 shrink-0 animate-pulse" />
                  {t('chat_queueSteering')}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canSteer && item.mode === 'queue' && (
                <Button
                  aria-label={t('chat_queueSteerItem')}
                  className="chat-action-button chat-action-button-soft size-8 rounded-lg [&_svg]:size-5"
                  onClick={() => onSteer(item.id)}
                  size="icon-sm"
                  title={t('chat_queueSteerItem')}
                  type="button"
                  variant="ghost">
                  <ChatQueueIcon className="size-5" />
                </Button>
              )}
              <Button
                aria-label={t('chat_queueRemove')}
                className="text-muted-foreground hover:text-foreground size-8 rounded-lg bg-zinc-200/50 dark:bg-zinc-700/40 [&_svg]:size-[18px]"
                onClick={() => onRemove(item.id)}
                size="icon-sm"
                title={t('chat_queueRemove')}
                type="button"
                variant="ghost">
                <XIcon className="size-[18px]" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export { QueuedMessages };
