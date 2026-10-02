import { setLocale, t } from '../../packages/i18n/lib/i18n-runtime';
import { processActivity, summarizeProcessGroup } from '../../packages/ui/lib/process-activity';
import { buildProcessGroups } from '../../packages/ui/lib/process-groups';
import { processTitle } from '../../packages/ui/lib/process-title';
import { SKIPPED_TOOL_RESULT } from '@extension/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessagePart } from '@extension/shared';

const call = (id: string, name: string, overrides = {}): ChatMessagePart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  args: {},
  state: 'output-available',
  result: 'ok',
  ...overrides,
});
const summaryOf = (parts: ChatMessagePart[], active = false) => {
  const group = buildProcessGroups('m', parts, active)[0];
  if (group.kind !== 'process-group') throw new Error('Fixture must begin with process content');
  return summarizeProcessGroup(group);
};

describe('process activity and localized titles', () => {
  beforeEach(async () => {
    await setLocale('zh_CN');
  });

  it('ranks distinct calls by frequency and first appearance, including failures', () => {
    const summary = summaryOf([
      call('a', 'web_search'),
      call('b', 'read'),
      call('c', 'read', { state: 'output-error' }),
      call('a', 'web_search'),
    ]);
    expect(summary.counts).toEqual([
      { kind: 'read', count: 2 },
      { kind: 'webSearch', count: 1 },
    ]);
    expect(summary.errors).toBe(1);
    expect(processTitle(summary, true, t)).toBe('已读取文件并搜索网页');
  });

  it('does not misclassify JavaScript management or custom tools', () => {
    expect(processActivity('execute_javascript', { action: 'execute' })).toBe('code');
    expect(processActivity('execute_javascript', { action: 'bundle' })).toBe('code');
    expect(processActivity('execute_javascript', { action: 'register' })).toBe('tools');
    expect(processActivity('functions.read', {})).toBe('tools');
    expect(processActivity('web_search', {})).toBe('webSearch');
    expect(processActivity('delete', {})).toBe('files');
  });

  it('combines two different prefixes, three categories, and more than three without counts', () => {
    const parts = [
      call('a', 'execute_javascript', { args: { action: 'execute' } }),
      call('b', 'read'),
      call('c', 'web_search'),
      call('d', 'browser'),
    ];
    expect(processTitle(summaryOf(parts.slice(0, 2)), true, t)).toBe('运行了代码并已读取文件');
    expect(processTitle(summaryOf(parts.slice(0, 3)), true, t)).toBe(
      '运行了代码，已读取文件，已搜索网页',
    );
    expect(processTitle(summaryOf(parts), true, t)).toBe('运行了代码，已读取文件，已搜索网页等');
  });

  it('uses English continuation and Traditional Chinese dictionaries', async () => {
    const summary = summaryOf([call('a', 'read'), call('b', 'web_search')]);
    await setLocale('en');
    expect(processTitle(summary, true, t)).toBe('Read files and searched the web');
    await setLocale('zh_TW');
    expect(processTitle(summary, true, t)).toBe('已讀取檔案並搜尋網頁');
  });

  it('selects the last running call, then returns to the older running call', () => {
    const pending = { state: 'input-available', result: undefined };
    const a = call('a', 'read', { ...pending, args: { path: 'a.md' } });
    const b = call('b', 'web_search', { ...pending, args: { query: 'second task' } });
    expect(processTitle(summaryOf([a, b], true), false, t)).toBe('正在搜索网页 · second task');
    expect(
      summaryOf([a, { ...b, state: 'output-available' } as ChatMessagePart], true).running,
    ).toBe('read');
  });

  it('goes back to thinking with the last paragraph after tools have returned', () => {
    const summary = summaryOf(
      [call('a', 'read'), { type: 'reasoning', text: 'Earlier\n\n**Now checking**\n the result' }],
      true,
    );
    expect(summary.running).toBeUndefined();
    expect(processTitle(summary, false, t)).toBe('正在分析请求 · Now checking the result');
  });

  it('clears live detail as soon as a reply closes an otherwise active interval', () => {
    const summary = summaryOf(
      [
        call('a', 'read', { state: 'input-available', result: undefined }),
        { type: 'text', text: 'Progress' },
      ],
      true,
    );
    expect(summary.running).toBeUndefined();
    expect(summary.detail).toBe('');
    expect(processTitle(summary, true, t)).toBe('已读取文件');
  });

  it('handles thought-only, skipped-only and orphan-result-only ranges separately', () => {
    expect(processTitle(summaryOf([{ type: 'reasoning', text: 'Think' }]), true, t)).toBe(
      '已完成分析',
    );
    const skipped = summaryOf([
      call('a', 'read', { state: 'output-error', result: SKIPPED_TOOL_RESULT }),
    ]);
    expect(skipped).toMatchObject({ counts: [], skipped: 1, errors: 0 });
    expect(processTitle(skipped, true, t)).toBe('已跳过工具调用');
    expect(
      processTitle(
        summaryOf([{ type: 'tool-result', toolCallId: 'a', toolName: 'read', result: 'orphan' }]),
        true,
        t,
      ),
    ).toBe('工具结果');
  });

  it('uses the first supported detail and truncates whole graphemes', () => {
    const pending = { state: 'input-available', result: undefined };
    expect(
      summaryOf(
        [
          call('a', 'read', {
            ...pending,
            args: { title: ' ', description: 5, path: '  src/one.ts\n ' },
          }),
        ],
        true,
      ).detail,
    ).toBe('src/one.ts');
    const emoji = '👩‍💻';
    expect(
      summaryOf([call('a', 'read', { ...pending, args: { title: emoji.repeat(200) } })], true)
        .detail,
    ).toBe(`${emoji.repeat(159)}…`);
    expect(
      summaryOf(
        [
          call('a', 'custom', {
            ...pending,
            args: { questions: [{ question: '' }, { question: 'Which file?' }] },
          }),
        ],
        true,
      ).detail,
    ).toBe('Which file?');
  });

  it('does not report standalone skipped results as failures across a reply boundary', () => {
    const result: ChatMessagePart = {
      type: 'tool-result',
      toolCallId: 'a',
      toolName: 'read',
      state: 'output-error',
      result: SKIPPED_TOOL_RESULT,
    };
    const groups = buildProcessGroups(
      'm',
      [call('a', 'read', { result: undefined }), { type: 'text', text: 'Update' }, result],
      false,
    );
    for (const group of groups) {
      if (group.kind !== 'process-group') continue;
      const summary = summarizeProcessGroup(group);
      expect(summary).toMatchObject({ counts: [], skipped: 1, errors: 0 });
      expect(processTitle(summary, true, t)).toBe('已跳过工具调用');
    }
    expect(summaryOf([result])).toMatchObject({ skipped: 1, errors: 0 });
  });
});
