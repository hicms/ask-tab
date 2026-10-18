import { buildProcessGroups } from '../../packages/ui/lib/process-groups';
import { needsTrailingWaiting } from '../../packages/ui/lib/waiting-feedback';
import { describe, expect, it } from 'vitest';
import type { ChatMessagePart } from '@extension/shared';

const needsWaiting = (parts: ChatMessagePart[]) =>
  needsTrailingWaiting(buildProcessGroups('assistant', parts, true));

describe('waiting without visible reasoning', () => {
  it('keeps empty and whitespace-only replies available for the initial indicator', () => {
    expect(buildProcessGroups('assistant', [], true)).toEqual([]);
    expect(
      buildProcessGroups(
        'assistant',
        [
          { type: 'reasoning', text: ' ' },
          { type: 'text', text: '\n' },
        ],
        true,
      ),
    ).toEqual([]);
    expect(needsWaiting([])).toBe(false);
  });

  it('resumes waiting after text, an image, or a completed document', () => {
    expect(needsWaiting([{ type: 'text', text: 'Here is what I found.' }])).toBe(true);
    expect(needsWaiting([{ type: 'file', mediaType: 'image/png', url: 'image.png' }])).toBe(true);
    expect(
      needsWaiting([
        {
          type: 'tool-call',
          toolCallId: 'doc',
          toolName: 'create_document',
          args: {},
          state: 'output-available',
          result: { id: 'doc' },
        },
      ]),
    ).toBe(true);
  });

  it('lets live reasoning, tools and a running document own their activity indicator', () => {
    expect(needsWaiting([{ type: 'reasoning', text: 'Considering the evidence.' }])).toBe(false);
    const tool: ChatMessagePart = {
      type: 'tool-call',
      toolCallId: 'read',
      toolName: 'read',
      args: {},
      state: 'input-available',
    };
    expect(needsWaiting([tool])).toBe(false);
    expect(needsWaiting([{ ...tool, state: 'output-available', result: 'done' }])).toBe(false);
    expect(needsWaiting([{ ...tool, toolName: 'create_document' }])).toBe(false);
  });
});
