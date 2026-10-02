import { buildProcessGroups } from '../../packages/ui/lib/process-groups';
import { normalizeProcessParts } from '../../packages/ui/lib/process-normalization';
import { SKIPPED_TOOL_RESULT } from '@extension/shared';
import { describe, expect, it } from 'vitest';
import type { ChatMessagePart } from '@extension/shared';

const call = (id: string, overrides = {}): ChatMessagePart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'read',
  args: { path: 'notes.md' },
  state: 'input-available',
  ...overrides,
});
const thought: ChatMessagePart = { type: 'reasoning', text: 'Check the evidence.' };
const reply: ChatMessagePart = { type: 'text', text: 'A progress update.' };

describe('process intervals', () => {
  it('keeps interleaved thinking and tools together, then starts after a reply', () => {
    const groups = buildProcessGroups(
      'm',
      [thought, call('a'), thought, call('b'), reply, call('c')],
      true,
    );
    expect(groups.map(group => group.kind)).toEqual(['process-group', 'part', 'process-group']);
    expect(groups[0]).toMatchObject({
      closed: true,
      members: [{ kind: 'reasoning' }, { kind: 'tool' }, { kind: 'reasoning' }, { kind: 'tool' }],
    });
    expect(groups[2]).toMatchObject({ closed: false, members: [{ kind: 'tool' }] });
  });

  it('keeps documents and images visible in their original order', () => {
    const document = call('doc', { toolName: 'create_document' });
    const image: ChatMessagePart = { type: 'file', url: 'screenshot.png', mediaType: 'image/png' };
    const groups = buildProcessGroups(
      'm',
      [reply, call('a'), document, thought, image, call('b')],
      false,
    );
    expect(groups.map(group => group.kind)).toEqual([
      'part',
      'process-group',
      'part',
      'process-group',
      'part',
      'process-group',
    ]);
    expect(groups[2]).toMatchObject({ part: document });
    expect(groups[4]).toMatchObject({ part: image });
  });

  it('ignores whitespace without manufacturing groups or separators', () => {
    const empty: ChatMessagePart[] = [
      { type: 'reasoning', text: '\n' },
      { type: 'text', text: ' ' },
    ];
    expect(buildProcessGroups('m', empty, true)).toEqual([]);
    expect(buildProcessGroups('m', [call('a'), ...empty, thought], true)).toHaveLength(1);
  });

  it('retains identity through append, result settlement and completion', () => {
    const first = buildProcessGroups('m', [thought, call('a')], true)[0];
    const expanded = buildProcessGroups(
      'm',
      [thought, call('a', { state: 'output-available', result: 'ok' }), call('b')],
      true,
    )[0];
    const completed = buildProcessGroups('m', [thought, call('a')], false)[0];
    expect(expanded.key).toBe(first.key);
    expect(completed.key).toBe(first.key);
    expect(buildProcessGroups('steered', [thought, call('a')], true)[0].key).not.toBe(first.key);
  });
});

describe('legacy process normalization', () => {
  it.each([null, false, '', 0])(
    'recognizes an explicit legacy result %j without inferring success',
    result => {
      expect(
        normalizeProcessParts('m', [call('a', { state: undefined, result })], false)[0],
      ).toMatchObject({ kind: 'tool', state: 'returned', hasResult: true, result });
    },
  );

  it('does not show stale or unconfirmed historical calls as running', () => {
    for (const state of [undefined, 'input-available', 'input-streaming']) {
      expect(normalizeProcessParts('m', [call('a', { state })], false)[0]).toMatchObject({
        state: 'unknown',
      });
    }
    expect(normalizeProcessParts('m', [call('a', { state: undefined })], true)[0]).toMatchObject({
      state: 'unknown',
    });
    expect(normalizeProcessParts('m', [call('a')], true)[0]).toMatchObject({
      state: 'input-available',
    });
  });

  it('settles a call with a result in the same interval and deduplicates call records', () => {
    const parts: ChatMessagePart[] = [
      call('a'),
      call('a'),
      { type: 'tool-result', toolCallId: 'a', toolName: 'read', result: 'read output' },
    ];
    const before = structuredClone(parts);
    expect(normalizeProcessParts('m', parts, true)).toHaveLength(1);
    expect(normalizeProcessParts('m', parts, true)[0]).toMatchObject({
      result: 'read output',
      state: 'returned',
    });
    expect(parts).toEqual(before);
  });

  it('keeps a later result after the intervening reply without duplicating its output', () => {
    const result: ChatMessagePart = {
      type: 'tool-result',
      toolCallId: 'a',
      toolName: 'read',
      result: 'later output',
    };
    const items = normalizeProcessParts('m', [call('a'), reply, result], true);
    expect(items[0]).toMatchObject({ state: 'returned', hasResult: false, result: undefined });
    expect(items[1]).toMatchObject({ kind: 'part', part: reply });
    expect(items[2]).toMatchObject({ kind: 'result', part: result });
  });

  it('preserves an orphan result without inventing a call or arguments', () => {
    expect(
      normalizeProcessParts(
        'm',
        [{ type: 'tool-result', toolCallId: 'missing', toolName: 'read', result: null }],
        false,
      ),
    ).toMatchObject([{ kind: 'result', part: { result: null } }]);
  });

  it('keeps skipped distinct from a failed call', () => {
    const items = normalizeProcessParts(
      'm',
      [
        call('a', { state: 'output-error', result: SKIPPED_TOOL_RESULT }),
        call('b', { state: 'output-error', result: 'Permission denied' }),
      ],
      false,
    );
    expect(items).toMatchObject([{ skipped: true }, { skipped: false, state: 'output-error' }]);
  });

  it.each([false, true])(
    'recognizes a skipped standalone result with preceding call: %s',
    linked => {
      const result: ChatMessagePart = {
        type: 'tool-result',
        toolCallId: 'a',
        toolName: 'read',
        state: 'output-error',
        result: SKIPPED_TOOL_RESULT,
      };
      const parts = linked ? [call('a'), reply, result] : [result];
      expect(normalizeProcessParts('m', parts, false).at(-1)).toMatchObject({
        kind: 'result',
        part: result,
        skipped: true,
      });
    },
  );
});
