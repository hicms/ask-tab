import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import {
  catalog,
  emit,
  emitToolCalls,
  failStream,
  installProvider,
  streamCount,
} from '../helpers/mock-llm';
import {
  seedLegacyProcess,
  selectProcessChat,
  publishSubagentResult,
} from '../helpers/process-fixtures';

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} collapses reasoning into a live process group and preserves manual disclosure`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 420 : 1280, height: 900 });
    await page.locator('textarea').fill('分析这个任务');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    const group = page.getByTestId('process-group');
    const toggle = group.getByTestId('process-group-toggle');
    await expect(toggle).toContainText('正在分析请求');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(group.getByTestId('message-reasoning')).toBeHidden();
    await toggle.click();
    const reasoning = group.getByTestId('message-reasoning');
    await expect(reasoning).toBeVisible();
    const detailToggle = reasoning.getByRole('button').first();
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'false');
    await detailToggle.click();
    await emit(worker, 0, '\n继续检查。');
    await expect(reasoning).toContainText('继续检查。');
    await toggle.click();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'true');
    await emit(worker, 0, '最终答案保持可见。', true);
    await expect(toggle).toHaveText('已完成分析');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(page.getByTestId('message-content').last()).toHaveText('最终答案保持可见。');
    await expect(page.getByTestId('message-content').last()).toBeVisible();
  });

  test(`${pagePath} summarizes real tool results across steps and keeps disclosure through settlement`, async ({
    context,
    extensionId,
  }, testInfo) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker, { supportsTools: true, initialReasoning: '' });
    const page = await openChat(context, extensionId, pagePath, {
      cached: catalog.map(model => ({ ...model, supportsTools: true })),
    });
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 420 : 1280, height: 900 });
    await page.locator('textarea').fill('记录并读取笔记');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    const group = page.getByTestId('process-group');
    const toggle = group.getByTestId('process-group-toggle');
    await expect(page.getByTestId('message-assistant-loading')).toBeVisible();
    await emitToolCalls(worker, 0, [
      {
        id: 'write-note',
        name: 'write',
        args: {
          path: 'process-test.md',
          content: Array.from(
            { length: 80 },
            (_, index) => `第${index + 1}行：工具输出保持可用。`,
          ).join('\n'),
        },
      },
      { id: 'read-note', name: 'read', args: { path: 'process-test.md' } },
    ]);
    await expect.poll(() => streamCount(worker)).toBe(2);
    await expect(group).toHaveCount(1);
    await expect(page.getByTestId('message-assistant-loading')).toHaveCount(0);
    await toggle.click();
    await expect(group.getByTestId('process-tool')).toHaveCount(2);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const read = group.getByTestId('process-tool').last();
    await read.getByRole('button').first().click();
    await expect(read).toContainText('工具输出保持可用。');
    await read.getByRole('button', { name: 'Show full content', exact: true }).click();
    await toggle.click();
    await toggle.click();
    await expect(read.getByRole('button', { name: 'Show less', exact: true })).toBeVisible();
    await read.getByRole('button').first().click();
    await read.getByRole('button').first().click();
    await expect(read.getByRole('button', { name: 'Show less', exact: true })).toBeVisible();
    await emit(worker, 1, '笔记已核对。', true);
    await expect(toggle).toHaveText('已写入文件并读取文件');
    await expect(read.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('message-content').last()).toHaveText('笔记已核对。');
    await page.screenshot({
      path: testInfo.outputPath('process-expanded.png'),
      animations: 'disabled',
    });
    await toggle.click();
    await page.screenshot({
      path: testInfo.outputPath('process-collapsed.png'),
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.reload();
    await selectProcessChat(page, pagePath, '记录并读取笔记');
    await expect(page.getByTestId('process-group-toggle')).toHaveText('已写入文件并读取文件');
    await expect(page.getByTestId('process-group-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test(`${pagePath} preserves unknown, skipped and orphan historical results without a running spinner`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await expect(page.locator('textarea')).toBeVisible();
    await seedLegacyProcess(context.serviceWorkers()[0]);
    await selectProcessChat(page, pagePath, '历史过程兼容');
    const groups = page.getByTestId('process-group');
    await expect(groups).toHaveCount(2);
    const group = groups.first();
    await expect(group.getByTestId('process-group-toggle')).toHaveText('已读取文件');
    await expect(group.getByTestId('process-notices')).toHaveText(
      '1 项失败或中断 · 1 项已跳过 · 1 项结果未确认',
    );
    await expect(page.getByText('历史正文保持可见。', { exact: true })).toBeVisible();
    await group.getByTestId('process-group-toggle').click();
    const tools = group.getByTestId('process-tool');
    await expect(tools).toHaveCount(4);
    await expect(tools.nth(0)).toContainText('已收到结果');
    await expect(tools.nth(1)).toContainText('结果未确认');
    await expect(tools.nth(2)).toContainText('已跳过');
    await tools.nth(3).getByRole('button').first().click();
    await expect(tools.nth(3).getByText('独立错误结果', { exact: true }).last()).toBeVisible();
    await expect(group.locator('.animate-spin')).toHaveCount(0);
    const skippedResults = groups.last();
    await expect(skippedResults.getByTestId('process-group-toggle')).toHaveText('已跳过工具调用');
    await expect(skippedResults.getByTestId('process-notices')).toHaveText('2 项已跳过');
    await skippedResults.getByTestId('process-group-toggle').click();
    await expect(skippedResults.getByTestId('process-tool')).toHaveCount(2);
    await expect(skippedResults.getByTestId('process-tool').first()).toContainText('已跳过');
    await expect(skippedResults.getByTestId('process-tool').last()).toContainText('已跳过');
  });

  test(`${pagePath} retries only the active disclosure and streams past an inserted system card`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.locator('textarea').fill('子代理插入测试');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    const toggles = page.getByTestId('process-group-toggle');
    await toggles.first().click();
    await emit(worker, 0, '第一轮答案。', true);
    await page.locator('textarea').fill('第二轮重试');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(2);
    await toggles.last().click();
    await failStream(worker, 1, 'context_length_exceeded');
    await expect.poll(() => streamCount(worker)).toBe(3);
    await expect(toggles).toHaveCount(2);
    await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles.last()).toHaveAttribute('aria-expanded', 'false');
    await publishSubagentResult(worker, '子代理插入测试');
    await expect(page.getByText('子代理结果卡片。', { exact: true })).toBeVisible();
    await emit(worker, 2, '\n系统卡片之后继续思考。');
    await expect(toggles.last()).toContainText('系统卡片之后继续思考。');
    await emit(worker, 2, '重试后的最终答案。', true);
    await expect(page.getByText('重试后的最终答案。', { exact: true })).toBeVisible();
    await expect(toggles.last()).toHaveText('已完成分析');
    await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
  });
}
