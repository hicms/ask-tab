import { test, expect } from '../fixtures/extension';
import type { BrowserContext, Page } from '@playwright/test';

type AccountMessage = { type: string; email?: string; password?: string; inviteCode?: string };
type AccountReply = Record<string, unknown>;
type AccountWindow = Window & {
  accountCalls: AccountMessage[];
  accountReplies: AccountReply[];
  holdAccountReply: boolean;
  releaseAccountReply?: () => void;
};

const INVITE_CODE_REJECTED = 'Invitation code is required, invalid, or already used';

/**
 * The form talks to the background only through `chrome.runtime.sendMessage`; answering
 * account messages in the page keeps the test independent of a running AskTab server.
 */
const openRegisterForm = async (context: BrowserContext, extensionId: string) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const target = window as unknown as AccountWindow;
    target.accountCalls = [];
    target.accountReplies = [];
    target.holdAccountReply = false;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const accountTypes = new Set(['ASK_LOGIN', 'ASK_REGISTER', 'ASK_LOGOUT']);
    const replacement = (message: AccountMessage, ...rest: unknown[]) => {
      if (!accountTypes.has(message?.type)) {
        return (original as (...args: unknown[]) => Promise<unknown>)(message, ...rest);
      }
      target.accountCalls.push(message);
      const reply = target.accountReplies.shift() ?? { success: true };
      if (!target.holdAccountReply) return Promise.resolve(reply);
      return new Promise(resolve => {
        target.releaseAccountReply = () => resolve(reply);
      });
    };
    Object.defineProperty(chrome.runtime, 'sendMessage', { value: replacement });
  });
  await context
    .serviceWorkers()[0]!
    .evaluate(() => chrome.storage.local.set({ settings: { theme: 'light', locale: 'zh_CN' } }));
  await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  await expect(page.getByTestId('setup-email')).toBeVisible({ timeout: 10000 });
  return page;
};

const accountCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as AccountWindow).accountCalls);

const queueReply = (page: Page, reply: AccountReply) =>
  page.evaluate(value => (window as unknown as AccountWindow).accountReplies.push(value), reply);

const fillAccount = async (page: Page) => {
  await page.getByTestId('setup-email').fill('new@example.com');
  await page.getByTestId('setup-password').fill('password-1');
};

test('sign-in neither shows nor sends an invitation code', async ({ context, extensionId }) => {
  const page = await openRegisterForm(context, extensionId);
  await expect(page.getByTestId('setup-invite-code')).toHaveCount(0);
  await expect(page.getByText('注册需要邀请码，每个邀请码只能使用一次。')).toHaveCount(0);
  await fillAccount(page);
  await queueReply(page, { error: 'Incorrect', status: 401 });
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByText('邮箱或密码错误')).toBeVisible();
  expect(await accountCalls(page)).toEqual([
    { type: 'ASK_LOGIN', email: 'new@example.com', password: 'password-1' },
  ]);
});

test('registration requires an invitation code and reports server answers', async ({
  context,
  extensionId,
}) => {
  const page = await openRegisterForm(context, extensionId);
  await page.getByTestId('setup-account-mode').click();
  const inviteCode = page.getByTestId('setup-invite-code');
  await expect(page.getByLabel('邀请码')).toBeVisible();
  await expect(page.getByText('注册需要邀请码，每个邀请码只能使用一次。')).toBeVisible();
  await fillAccount(page);

  await inviteCode.fill('   ');
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByTestId('setup-invite-code-error')).toHaveText('请输入邀请码');
  await expect(inviteCode).toHaveAttribute('aria-invalid', 'true');
  expect(await accountCalls(page)).toEqual([]);

  await inviteCode.fill('  AbC-12 x9 \t');
  await expect(page.getByTestId('setup-invite-code-error')).toHaveCount(0);
  await queueReply(page, { error: INVITE_CODE_REJECTED, status: 400 });
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByText('邀请码无效或已被使用，请检查后重试。')).toBeVisible();
  await expect(inviteCode).toHaveValue('  AbC-12 x9 \t');
  expect(await accountCalls(page)).toEqual([
    {
      type: 'ASK_REGISTER',
      email: 'new@example.com',
      password: 'password-1',
      inviteCode: 'AbC-12 x9',
    },
  ]);

  await queueReply(page, { error: 'Invalid email address', status: 400 });
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByText('Invalid email address')).toBeVisible();
  await expect(page.getByText('邀请码无效或已被使用，请检查后重试。')).toHaveCount(0);
  await expect(inviteCode).toHaveValue('  AbC-12 x9 \t');

  await queueReply(page, { error: 'Email already registered', status: 409 });
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByText('该邮箱已注册')).toBeVisible();

  await queueReply(page, { error: 'Cannot reach the AskTab server', status: 0 });
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByText('无法连接 AskTab 服务器')).toBeVisible();
  await expect(inviteCode).toHaveValue('  AbC-12 x9 \t');
  // A network failure waits for the user; nothing is resent on its own.
  await page.waitForTimeout(500);
  expect(await accountCalls(page)).toHaveLength(4);
});

test('registration is sent once and then continues signed in', async ({ context, extensionId }) => {
  const page = await openRegisterForm(context, extensionId);
  await page.getByTestId('setup-account-mode').click();
  await fillAccount(page);
  await page.getByTestId('setup-invite-code').fill('Invite-OK');
  await page.evaluate(() => {
    (window as unknown as AccountWindow).holdAccountReply = true;
  });
  await queueReply(page, { email: 'new@example.com', models: 1 });

  const button = page.getByTestId('setup-start-button');
  await button.evaluate(element => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(button).toBeDisabled();
  await page.getByTestId('setup-invite-code').press('Enter');
  expect(await accountCalls(page)).toHaveLength(1);

  await page.evaluate(() => (window as unknown as AccountWindow).releaseAccountReply?.());
  await expect(page.getByTestId('setup-email')).toHaveCount(0);
  await expect(page.getByTestId('setup-invite-code')).toHaveCount(0);
  expect(await accountCalls(page)).toEqual([
    {
      type: 'ASK_REGISTER',
      email: 'new@example.com',
      password: 'password-1',
      inviteCode: 'Invite-OK',
    },
  ]);
});

test('a used invitation code is cleared once the account exists', async ({
  context,
  extensionId,
}) => {
  const page = await openRegisterForm(context, extensionId);
  await page.getByTestId('setup-account-mode').click();
  await fillAccount(page);
  await page.getByTestId('setup-invite-code').fill('Invite-OK');
  await queueReply(page, { email: 'new@example.com', models: 0 });
  await page.getByTestId('setup-start-button').click();
  await expect(page.getByText('服务器尚未配置模型，请联系管理员。')).toBeVisible();
  await expect(page.getByTestId('setup-invite-code')).toHaveValue('');
  expect((await accountCalls(page)).map(call => call.type)).toEqual(['ASK_REGISTER', 'ASK_LOGOUT']);
});
