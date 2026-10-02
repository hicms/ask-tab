import { normalizeProcessParts } from './process-normalization';
import type { ProcessItem, ProcessRenderItem } from './process-types';
import type { ChatMessagePart } from '@extension/shared';

const buildProcessGroups = (
  messageId: string,
  parts: ChatMessagePart[],
  active: boolean,
): ProcessRenderItem[] => {
  const output: ProcessRenderItem[] = [];
  let pending: ProcessItem[] = [];
  const flush = (closed: boolean) => {
    if (!pending.length) return;
    output.push({
      kind: 'process-group',
      key: `process:${pending[0].key}`,
      members: pending,
      closed,
    });
    pending = [];
  };
  for (const item of normalizeProcessParts(messageId, parts, active)) {
    if (item.kind === 'part') {
      flush(true);
      output.push(item);
    } else pending.push(item);
  }
  flush(!active);
  return output;
};

export { buildProcessGroups };
