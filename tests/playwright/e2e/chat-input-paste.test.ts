import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import type { Page } from '@playwright/test';

const catalog = [
  { id: 'ask:paste-test', modelId: 'paste-test', name: 'Paste Test', provider: 'custom' },
];

const writeClipboard = async (page: Page, text: string, html?: string) => {
  const session = await page.context().newCDPSession(page);
  const url = new URL(page.url());
  await session.send('Browser.grantPermissions', {
    origin: `${url.protocol}//${url.host}`,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  await session.detach();
  await page.evaluate(
    async ({ text, html }) => {
      if (html) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
    },
    { text, html },
  );
};

const pasteText = async (page: Page, text: string, html?: string) => {
  await writeClipboard(page, text, html);
  await page.keyboard.press('ControlOrMeta+v');
};

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} accepts paste immediately after clicking the input`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const input = page.locator('textarea');
    await expect(input).toBeVisible();
    // Prepare the clipboard first: no permission work, focus repair or wait is
    // allowed between clicking and pressing the paste shortcut.
    await writeClipboard(page, '点击后立即粘贴');
    const session = await context.newCDPSession(page);
    // Playwright normally emulates focus, which would mask window-level loss.
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await input.click();
    await page.keyboard.press('ControlOrMeta+v');
    await expect(input).toHaveValue('点击后立即粘贴');
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => document.hasFocus())).toBe(true);

    // A deliberate focus change still wins; no delayed refocus steals it back.
    await page.getByRole('combobox').filter({ hasText: 'Paste Test' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(input).not.toBeFocused();
    await session.detach();
  });

  test(`${pagePath} keeps native mouse selection when claiming input focus`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const input = page.locator('textarea');
    await input.fill('replace');
    await writeClipboard(page, 'replacement');
    await input.dblclick({ position: { x: 24, y: 20 } });
    expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual(
      [0, 7],
    );
    await page.keyboard.press('ControlOrMeta+v');
    await expect(input).toHaveValue('replacement');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('replace');
  });

  test(`${pagePath} owns text paste, preserves the selection and native undo`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const input = page.locator('textarea');
    await input.fill('左侧待替换右侧');
    const original = await input.elementHandle();
    await input.evaluate(element => {
      element.setSelectionRange(2, 5);
      // Check after React's delegated handler, including stopPropagation.
      element.addEventListener('paste', event => {
        setTimeout(() => {
          element.dataset.pastePrevented = String(event.defaultPrevented);
        }, 0);
      });
    });
    await pasteText(page, '第一行\n第二行', '<b>第一行</b><br>第二行');
    await expect(input).toHaveValue('左侧第一行\n第二行右侧');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('data-paste-prevented', 'true');
    expect(
      await original!.evaluate(element => element === document.querySelector('textarea')),
    ).toBe(true);
    expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual(
      [9, 9],
    );

    await page.keyboard.press('ControlOrMeta+z');
    await expect(input).toHaveValue('左侧待替换右侧');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(input).toHaveValue('左侧第一行\n第二行右侧');
    await expect(input).toBeFocused();
    // A subsequent edit also proves the controlled React value stayed in sync.
    await page.keyboard.type('!');
    await expect(input).toHaveValue('左侧第一行\n第二行!右侧');
  });
}

test('paste falls back to replacing the selection when insertText is unavailable', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  const input = page.locator('textarea');
  await input.fill('before [replace] after');
  await input.evaluate(element => {
    element.setSelectionRange(7, 16);
    document.execCommand = () => {
      element.dataset.insertAttempted = 'true';
      return false;
    };
  });
  await pasteText(page, '第一行\r\n第二行');
  await expect(input).toHaveValue('before 第一行\n第二行 after');
  await expect(input).toHaveAttribute('data-insert-attempted', 'true');
  await expect(input).toBeFocused();
  await page.keyboard.type('!');
  await expect(input).toHaveValue('before 第一行\n第二行! after');
});

test('undoing a paste keeps the text typed immediately before it', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  const input = page.locator('textarea');
  await input.click();
  await page.keyboard.type('typed ');
  await pasteText(page, 'pasted');
  await expect(input).toHaveValue('typed pasted');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(input).toHaveValue('typed ');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(input).toHaveValue('typed pasted');
});

test('a command that inserts text but reports failure does not duplicate the paste', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  const input = page.locator('textarea');
  await input.fill('prefix ');
  await page.evaluate(() => {
    const original = document.execCommand.bind(document);
    document.execCommand = (...args) => {
      original(...args);
      return false;
    };
  });
  await pasteText(page, 'once');
  await expect(input).toHaveValue('prefix once');
  await expect(input).toBeFocused();
});

test('long text remains editable and a later user focus change is respected', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  const input = page.locator('textarea');
  await input.click();
  const text = '长文本粘贴测试\n'.repeat(1000);
  await pasteText(page, text);
  await expect(input).toHaveValue(text);
  await expect(input).toBeFocused();
  const button = page.getByRole('combobox').filter({ hasText: 'Paste Test' });
  await button.focus();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect(button).toBeFocused();
});

test('image paste still creates an attachment and leaves the text draft intact', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  const input = page.locator('textarea');
  await input.fill('图片说明');
  await input.evaluate(element => {
    const clipboardData = new DataTransfer();
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6mEAAAAASUVORK5CYII=',
      ),
      char => char.charCodeAt(0),
    );
    clipboardData.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    );
  });
  await expect(page.getByTestId('attachments-preview')).toContainText('pasted.png');
  await expect(input).toHaveValue('图片说明');
  await expect(input).toBeFocused();
});

test('Ctrl+V with Ctrl configured for dictation does not request microphone permission', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      'stt-config': {
        engine: 'auto',
        hotkey: 'ControlLeft',
        openai: { modelId: '' },
        language: 'en',
      },
    });
    navigator.mediaDevices.getUserMedia = async () => {
      document.body.dataset.micRequested = 'true';
      throw new DOMException('Test permission denial', 'NotAllowedError');
    };
  });
  await expect(page.getByTestId('mic-button')).toBeVisible();
  const input = page.locator('textarea');
  await input.click();
  await pasteText(page, '正常粘贴');
  await expect(input).toHaveValue('正常粘贴');
  await expect(input).toBeFocused();
  expect(await page.locator('body').getAttribute('data-mic-requested')).toBeNull();
  expect(context.pages().some(candidate => candidate.url().includes('mic-permission'))).toBe(false);
});
