import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import { catalog, emit, installProvider, streamCount } from '../helpers/mock-llm';
import type { Locator } from '@playwright/test';

const markdown = [
  '# 一级标题',
  '## 二级标题',
  '### 三级标题',
  '#### 四级标题',
  '##### 五级标题',
  '###### 六级标题',
  '',
  '正文 **加粗文字** *斜体文字* ~~删除文字~~ `inline code` [链接](https://example.com)',
  '普通文本第一行',
  '普通文本第二行',
  '',
  '- 无序条目一',
  '- 无序条目二',
  '  - 嵌套条目',
  '',
  '1. 有序条目一',
  '2. 有序条目二',
  '',
  '- [x] 已完成',
  '- [ ] 未完成',
  '',
  '> 引用第一行',
  '> 引用第二行',
  '',
  '```text',
  '# literal heading',
  '**literal bold**',
  '```',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 内容一 | 内容二 |',
  '',
  '---',
].join('\n');

const expectSingleLineBreak = async (container: Locator, first: string, second: string) => {
  const layout = await container.evaluate(
    (element, { first, second }) => {
      const top = (text: string) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const index = node.textContent?.indexOf(text) ?? -1;
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + text.length);
          return range.getBoundingClientRect().top;
        }
        throw new Error(`Missing rendered text: ${text}`);
      };
      return {
        distance: top(second) - top(first),
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      };
    },
    { first, second },
  );
  expect.soft(layout.distance, `${first} → ${second}`).toBeCloseTo(layout.lineHeight, 1);
};

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} preserves user Markdown formatting and plain-text line breaks`, async ({
    context,
    extensionId,
  }, testInfo) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 420 : 1280, height: 900 });
    await page.locator('textarea').fill(markdown);
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    await emit(worker, 0, markdown, true);

    const user = page.getByTestId('message-user').getByTestId('message-content');
    const assistant = page.getByTestId('message-assistant').getByTestId('message-content');
    await expect(user.locator('h1')).toHaveText('一级标题');
    await expect(assistant.locator('h1')).toHaveText('一级标题');
    for (const content of [user, assistant]) {
      for (let level = 1; level <= 6; level++) {
        await expect(content.locator(`h${level}`)).toHaveCount(1);
        await expect(content.locator(`h${level}`)).toHaveCSS('font-weight', '600');
      }
      await expect(content.locator('h1')).toHaveCSS('font-size', '30px');
      await expect(content.locator('[data-streamdown="strong"]')).toHaveCSS('font-weight', '600');
      await expect(content.locator('em')).toHaveCSS('font-style', 'italic');
      await expect(content.locator('del')).toHaveCSS('text-decoration-line', 'line-through');
      await expect(content.locator('ul').first()).toHaveCSS('list-style-type', 'disc');
      await expect(content.locator('ol')).toHaveCSS('list-style-type', 'decimal');
      await expect(content.locator('ul ul')).toHaveCount(1);
      await expect(content.locator('input[type="checkbox"]:checked')).toHaveCount(1);
      await expect(content.locator('blockquote')).toContainText('引用第一行');
      await content.locator('pre').scrollIntoViewIfNeeded();
      await expect(content.locator('pre')).toContainText('# literal heading\n**literal bold**', {
        useInnerText: true,
      });
      await expect(content.locator('table th')).toHaveCount(2);
      await expect(content.locator('table td')).toHaveCount(2);
      await expect(content.locator('hr')).toHaveCount(1);
    }
    await expectSingleLineBreak(user, '普通文本第一行', '普通文本第二行');
    await expectSingleLineBreak(user.locator('blockquote'), '引用第一行', '引用第二行');
    const link = user.locator('[data-streamdown="link"]');
    await expect(link).toHaveText('链接');
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 420 : 1280, height: 1800 });
    for (const theme of ['light', 'dark']) {
      await worker.evaluate(
        theme => chrome.storage.local.set({ settings: { theme, locale: 'zh_CN' } }),
        theme,
      );
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      const foreground = theme === 'dark' ? 'rgb(232, 235, 239)' : 'rgb(32, 37, 45)';
      const background = theme === 'dark' ? 'rgb(37, 40, 45)' : 'rgb(243, 244, 246)';
      await expect(user).toHaveCSS('background-color', background);
      await expect(user.locator('h1')).toHaveCSS('color', foreground);
      await expect(user.locator('[data-streamdown="inline-code"]')).toHaveCSS('color', foreground);
      await expect(user.locator('table td').first()).toHaveCSS('color', foreground);
      await user.screenshot({ path: testInfo.outputPath(`user-markdown-${theme}.png`) });
    }
    await page.getByTestId('message-user').hover();
    await page.getByTestId('message-edit-button').click();
    await expect(page.getByTestId('message-editor').locator('textarea')).toHaveValue(markdown);
  });

  test(`${pagePath} handles Markdown line breaks, CJK emphasis and literal unfinished text`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const input = [
      '# 中文标题',
      '',
      '普通第一行\n普通第二行',
      '',
      '硬换行第一行  \n硬换行第二行',
      '',
      '转义换行第一行\\\n转义换行第二行',
      '',
      '- 列表第一行\n  列表第二行',
      '',
      '**重点：**后面的文字',
      '',
      '前文**「带标点。」**后文',
      '',
      '未闭合 **原样保留',
    ].join('\n');
    await page.locator('textarea').fill(input);
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    await emit(worker, 0, '收到。', true);
    const user = page.getByTestId('message-user').getByTestId('message-content');
    await expect(user.locator('h1')).toHaveText('中文标题');
    for (const prefix of ['普通', '硬换行', '转义换行', '列表']) {
      await expectSingleLineBreak(user, `${prefix}第一行`, `${prefix}第二行`);
    }
    await expect
      .soft(user.locator('[data-streamdown="strong"]').filter({ hasText: '重点：' }))
      .toHaveText('重点：');
    await expect
      .soft(user.locator('[data-streamdown="strong"]').filter({ hasText: '「带标点。」' }))
      .toHaveText('「带标点。」');
    await expect.soft(user).toContainText('未闭合 **原样保留');
  });
}
