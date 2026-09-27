import { test, expect } from '../fixtures/extension';

test('a selected shortcut icon persists and appears on the eight-card welcome screen', async ({
  context,
  extensionId,
}) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async () => {
    const labels = [
      '提炼当前页面要点',
      '速览今日 AI 动态',
      '查看成都今日天气',
      '规划一趟三亚之旅',
      '解释这段代码',
      '帮我起草一封邮件',
      '整理会议纪要',
      '推荐周末好去处',
    ];
    await chrome.storage.local.set({
      settings: { theme: 'light', locale: 'zh_CN' },
      'suggested-actions': labels.map((label, index) => ({
        id: String(index),
        label,
        prompt: label,
        icon: 'page',
      })),
      'server-models': [{ id: 'custom:test', modelId: 'test', name: 'Test', provider: 'custom' }],
      'selected-model-id': 'custom:test',
    });
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await options.getByRole('button', { name: '快捷操作' }).click();
  await options.getByRole('button', { name: '选择图标' }).first().click();
  const dialog = options.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /选择图标 \d+/ })).toHaveCount(12);
  const chosenIcon = dialog.getByRole('button', { name: '选择图标 11' });
  const chosenArt = await chosenIcon.locator('svg path').first().getAttribute('d');
  expect(chosenArt).toBeTruthy();
  await chosenIcon.click();

  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const stored = await chrome.storage.local.get('suggested-actions');
        return stored['suggested-actions']?.[0]?.icon;
      }),
    )
    .toBe('book');

  const chat = await context.newPage();
  await chat.setViewportSize({ width: 662, height: 1215 });
  await chat.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  const cards = chat.locator('[data-testid="suggested-actions"] button');
  await expect(cards).toHaveCount(8);
  await expect(chat.getByText('你好，今天想了解什么？')).toBeVisible();
  await expect(cards.first().locator('svg path').first()).toHaveAttribute('d', chosenArt!);
  await options.close();
  await chat.close();
});
