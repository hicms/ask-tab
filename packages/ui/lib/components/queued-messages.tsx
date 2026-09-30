import { ChatQueueIcon } from './chat-action-icons';
import { Button } from './ui';
import { cn } from '../utils';
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
    <div
      className="bg-muted/60 text-foreground border-border border-b text-sm"
      data-testid="queued-messages">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
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
          className="bg-background mx-3 mt-1 flex items-center justify-between gap-2 rounded-md px-2 py-1"
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
      <ul className="max-h-40 overflow-y-auto px-1.5 py-1">
        {items.map(item => (
          <li
            className="hover:bg-background/70 group flex items-start gap-2 rounded-md px-1.5 py-1"
            data-testid="queued-message"
            key={item.id}>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 whitespace-pre-wrap break-words" title={item.text}>
                {item.text}
              </p>
              {item.mode === 'steer' && (
                <p className="chat-action-icon flex items-center gap-1 text-xs">
                  <ChatQueueIcon className="size-3 animate-pulse" />
                  {t('chat_queueSteering')}
                </p>
              )}
            </div>
            <div
              className={cn(
                'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
                'focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
              )}>
              {canSteer && item.mode === 'queue' && (
                <Button
                  aria-label={t('chat_queueSteerItem')}
                  className="chat-action-button size-6"
                  onClick={() => onSteer(item.id)}
                  size="icon-sm"
                  title={t('chat_queueSteerItem')}
                  type="button"
                  variant="ghost">
                  <ChatQueueIcon className="size-3.5" />
                </Button>
              )}
              <Button
                aria-label={t('chat_queueRemove')}
                className="size-6"
                onClick={() => onRemove(item.id)}
                size="icon-sm"
                title={t('chat_queueRemove')}
                type="button"
                variant="ghost">
                <XIcon className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export { QueuedMessages };
