import { isDocumentToolCall } from './artifact-stream';
import { isSkippedToolCall } from '@extension/shared';
import type { NormalizedPart, ToolDisplayState } from './process-types';
import type { ChatMessagePart } from '@extension/shared';

const isProcessBoundary = (part: ChatMessagePart): boolean =>
  part.type === 'file' ||
  (part.type === 'text' && part.text.trim() !== '') ||
  isDocumentToolCall(part);

/** Keep old result records in their original interval; never move output across a reply. */
const normalizeProcessParts = (
  messageId: string,
  parts: ChatMessagePart[],
  active: boolean,
): NormalizedPart[] => {
  let region = 0;
  const regions = parts.map(part => {
    if (isProcessBoundary(part)) region++;
    return region;
  });
  const calls = new Map<string, number>();
  const results = new Map<string, number>();
  parts.forEach((part, index) => {
    if (part.type === 'tool-call' && !calls.has(part.toolCallId)) calls.set(part.toolCallId, index);
    if (part.type === 'tool-result') results.set(part.toolCallId, index);
  });

  const items: NormalizedPart[] = [];
  parts.forEach((part, index) => {
    const key = `${messageId}:part:${index}`;
    if (isProcessBoundary(part)) {
      items.push({ kind: 'part', key, index, part });
    } else if (part.type === 'reasoning' && part.text.trim()) {
      items.push({
        kind: 'reasoning',
        key,
        index,
        text: part.text,
        running: active && index === parts.length - 1,
      });
    } else if (part.type === 'tool-call') {
      if (calls.get(part.toolCallId) !== index) return;
      const resultIndex = results.get(part.toolCallId);
      const resultPart = resultIndex === undefined ? undefined : parts[resultIndex];
      const recordedResult = resultPart?.type === 'tool-result' ? resultPart : undefined;
      const sameRegion = resultIndex !== undefined && regions[resultIndex] === regions[index];
      const inlineResult = Object.hasOwn(part, 'result') && part.result !== undefined;
      const hasResult = inlineResult || (sameRegion && recordedResult !== undefined);
      const result = inlineResult ? part.result : sameRegion ? recordedResult?.result : undefined;
      const state = recordedResult?.state ?? part.state;
      const skipped = isSkippedToolCall({
        ...part,
        state,
        result: recordedResult?.result ?? result,
      });
      let display: ToolDisplayState;
      if (skipped || state === 'output-error') display = 'output-error';
      else if (state === 'output-available') display = state;
      else if (inlineResult || recordedResult) display = 'returned';
      else if (active && (state === 'input-available' || state === 'input-streaming'))
        display = state;
      else display = 'unknown';
      items.push({
        kind: 'tool',
        key: `${messageId}:tool:${part.toolCallId}`,
        index,
        call: part,
        state: display,
        skipped,
        hasResult,
        result,
      });
    } else if (part.type === 'tool-result') {
      const callIndex = calls.get(part.toolCallId);
      if (
        callIndex !== undefined &&
        regions[callIndex] === regions[index] &&
        !isDocumentToolCall(parts[callIndex])
      )
        return;
      items.push({
        kind: 'result',
        key,
        index,
        part,
        state: part.state === 'output-error' ? 'output-error' : 'returned',
        skipped: isSkippedToolCall(part),
      });
    }
  });
  return items;
};

export { normalizeProcessParts };
