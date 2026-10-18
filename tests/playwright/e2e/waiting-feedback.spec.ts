import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import {
  abortedStreams,
  catalog,
  emit,
  emitToolCalls,
  installProvider,
  streamCount,
} from '../helpers/mock-llm';
import { selectProcessChat } from '../helpers/process-fixtures';

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} keeps a silent model visibly active with rotating copy and elapsed time`, async ({
    context,
    extensionId,
  }, testInfo) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker, { initialReasoning: '' });
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 360 : 1200, height: 850 });
    await expect(page.locator('textarea')).toBeVisible();
    await page.clock.install();
    await page.locator('textarea').fill('请认真考虑这个问题');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    const waiting = page.getByTestId('waiting-indicator');
    await expect(waiting).toHaveCount(1);
    await expect(waiting.getByTestId('waiting-phrase')).toHaveText('正在思考你的问题');
    await expect(page.getByTestId('message-reasoning')).toHaveCount(0);
    await page.clock.fastForward(6000);
    await expect(waiting.getByTestId('waiting-phrase')).toHaveText('正在梳理问题的思路');
    await expect(waiting.getByTestId('waiting-elapsed')).toHaveText(/0:0[6-9]/);
    await page.screenshot({
      path: testInfo.outputPath('waiting-light.png'),
      animations: 'disabled',
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .getByTestId('message-assistant-loading')
        .evaluate(el => getComputedStyle(el).animationName),
    ).toBe('none');
    expect(
      await waiting
        .locator('.waiting-activity-shimmer')
        .evaluate(el => getComputedStyle(el).animationName),
    ).toBe('none');
    expect(
      await waiting
        .locator('.waiting-orb')
        .evaluate(el => getComputedStyle(el, '::before').animationName),
    ).toBe('none');
    await worker.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, theme: 'dark' } });
    });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({
      path: testInfo.outputPath('waiting-dark.png'),
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.clock.fastForward(54000);
    await expect(waiting.getByTestId('waiting-phrase')).toHaveText('正在围绕你的问题展开思考');
    await expect(waiting.getByTestId('waiting-elapsed')).toHaveText(/1:0[0-9]/);
    await page.locator('button[type="submit"]').click();
    await expect.poll(() => abortedStreams(worker)).toEqual([true]);
    await expect(waiting).toHaveCount(0);
    await page.clock.fastForward(6000);
    await expect(page.getByTestId('waiting-activity')).toHaveCount(0);
  });

  test(`${pagePath} restores elapsed waiting and covers gaps after visible output`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker, { initialReasoning: '' });
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await expect(page.locator('textarea')).toBeVisible();
    await page.clock.install();
    await page.locator('textarea').fill('静默回复恢复测试');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    await expect(page.getByTestId('waiting-indicator')).toBeVisible();
    await page.clock.fastForward(12000);
    await page.getByRole('banner').getByRole('button', { name: '新会话', exact: true }).click();
    await selectProcessChat(page, pagePath, '静默回复恢复测试');
    await expect(page.getByTestId('waiting-elapsed')).toHaveText(/0:1[2-9]/);
    await emit(worker, 0, '先给出一段内容。', false, 'text');
    await expect(page.getByTestId('message-content').last()).toHaveText('先给出一段内容。');
    await expect(page.getByTestId('waiting-indicator')).toHaveCount(0);
    await page.clock.fastForward(1500);
    await expect(page.getByTestId('waiting-indicator')).toBeVisible();
    await emit(worker, 0, '继续输出。', false, 'text');
    await expect(page.getByTestId('message-content').last()).toContainText('继续输出。');
    await expect(page.getByTestId('waiting-indicator')).toHaveCount(0);
    await emit(worker, 0, '完成。', true);
    await expect(page.getByTestId('message-content').last()).toContainText('完成。');
    await page.clock.fastForward(6000);
    await expect(page.getByTestId('waiting-activity')).toHaveCount(0);
  });

  test(`${pagePath} keeps a single activity indicator between tool turns without reasoning`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker, { supportsTools: true, initialReasoning: '' });
    const page = await openChat(context, extensionId, pagePath, {
      cached: catalog.map(model => ({ ...model, supportsTools: true })),
    });
    await page.locator('textarea').fill('先写一份笔记');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    await emitToolCalls(worker, 0, [
      { id: 'write-note', name: 'write', args: { path: 'waiting.md', content: 'hello' } },
    ]);
    await expect.poll(() => streamCount(worker)).toBe(2);
    await expect(page.getByTestId('waiting-activity')).toHaveCount(1);
    await expect(page.getByTestId('waiting-indicator')).toHaveCount(0);
    await expect(page.getByTestId('process-group').getByTestId('waiting-phrase')).toBeVisible();
    await emit(worker, 1, '笔记已写好。', true);
    await expect(page.getByTestId('process-group-toggle')).toHaveText('已写入文件');
    await expect(page.getByTestId('waiting-activity')).toHaveCount(0);
  });
}
