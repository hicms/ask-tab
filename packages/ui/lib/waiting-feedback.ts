import type { ProcessRenderItem } from './process-types';
import type { MessageKeyType } from '@extension/i18n';

const WAITING_MESSAGE_COUNT = 24;
const WAITING_MESSAGE_INTERVAL_SECONDS = 6;
const WAITING_SILENCE_MS = 1200;

const waitingMessageKey = (elapsedSeconds: number): MessageKeyType =>
  `waiting_phrase${Math.floor(elapsedSeconds / WAITING_MESSAGE_INTERVAL_SECONDS) % WAITING_MESSAGE_COUNT}` as MessageKeyType;

const formatWaitingTime = (elapsedSeconds: number): string => {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

/** An open process group or a running document already owns the activity indicator. */
const needsTrailingWaiting = (items: ProcessRenderItem[]): boolean => {
  const last = items.at(-1);
  if (!last || last.kind === 'process-group') return false;
  return !(
    last.part.type === 'tool-call' &&
    (last.part.state === 'input-available' || last.part.state === 'input-streaming')
  );
};

export { formatWaitingTime, needsTrailingWaiting, waitingMessageKey, WAITING_SILENCE_MS };
