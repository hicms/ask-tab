import { formatWaitingTime, waitingMessageKey, WAITING_SILENCE_MS } from '../waiting-feedback';
import { useT } from '@extension/i18n';
import { SparklesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChatMessagePart } from '@extension/shared';

type WaitingActivityProps = {
  startedAt?: number;
  /** Real tool activity or reasoning always takes precedence over waiting copy. */
  text?: string;
};

const WaitingActivity = ({ startedAt, text }: WaitingActivityProps) => {
  const t = useT();
  const [mountedAt] = useState(Date.now);
  const start = startedAt ?? mountedAt;
  const [now, setNow] = useState(Date.now);
  const elapsed = Math.max(0, Math.floor((now - start) / 1000));
  const phrase = text || t(waitingMessageKey(elapsed));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="block min-w-0">
      <span className="waiting-activity" data-testid="waiting-activity">
        <span className="sr-only" role="status">
          {text || t('waiting_status')}
        </span>
        <span aria-hidden="true" className="waiting-activity-copy">
          <span
            className="waiting-activity-shimmer"
            key={text ? 'real' : waitingMessageKey(elapsed)}
            data-testid="waiting-phrase">
            {phrase}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
          data-testid="waiting-elapsed">
          {formatWaitingTime(elapsed)}
        </span>
      </span>
    </span>
  );
};

const WaitingIndicator = ({ startedAt }: WaitingActivityProps) => (
  <div className="waiting-indicator" data-testid="waiting-indicator">
    <span aria-hidden="true" className="waiting-orb">
      <SparklesIcon className="relative size-3.5" />
    </span>
    <div className="min-w-0 flex-1">
      <WaitingActivity startedAt={startedAt} />
    </div>
  </div>
);

/** Reappears during a quiet gap after visible output, without flashing between tokens. */
const WaitingAfterContent = ({
  startedAt,
  content,
}: {
  startedAt: number;
  content: ChatMessagePart[];
}) => {
  const [quietContent, setQuietContent] = useState<ChatMessagePart[]>();
  useEffect(() => {
    const timer = setTimeout(() => setQuietContent(content), WAITING_SILENCE_MS);
    return () => clearTimeout(timer);
  }, [content]);

  return quietContent === content ? <WaitingIndicator startedAt={startedAt} /> : null;
};

export { WaitingActivity, WaitingAfterContent, WaitingIndicator };
