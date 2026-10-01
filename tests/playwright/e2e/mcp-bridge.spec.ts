import { expect, test } from '../fixtures/extension';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const BRIDGE_ENTRY = resolve('packages/mcp-bridge/dist/index.mjs');
const PAGE_URL = 'http://asktab-mcp-e2e.test/';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

const textOf = (result: ToolResult): string =>
  result.content.map(part => part.text ?? '').join('\n');

test('an MCP client drives the browser through the local bridge', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() =>
    chrome.storage.local.set({ settings: { theme: 'light', locale: 'en' } }),
  );

  // Enable MCP and choose a port through the settings UI.
  const port = 47000 + Math.floor(Math.random() * 1000);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await options.getByRole('button', { name: 'Tools', exact: true }).click();
  await options.getByLabel('Allow MCP clients to use these tools').check();
  const portInput = options.getByLabel('Port', { exact: true });
  await portInput.fill(String(port));
  await portInput.blur();

  const readConfig = () =>
    worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('mcp-bridge-config');
      return stored['mcp-bridge-config'] as { enabled: boolean; port: number; token: string };
    });
  await expect.poll(async () => (await readConfig()).port).toBe(port);
  const { token } = await readConfig();
  expect(token).toHaveLength(32);

  // The page the client will operate on.
  await context.route(`${PAGE_URL}**`, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>before</title>
        <button onclick="document.title = 'clicked'">Press me</button>`,
    }),
  );
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const tabId = await worker.evaluate(
    async url => (await chrome.tabs.query({ url: `${url}*` }))[0]!.id!,
    PAGE_URL,
  );

  // The bridge starts after MCP was enabled; the extension reconnects on its own.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIDGE_ENTRY],
    env: { ASKTAB_MCP_PORT: String(port), ASKTAB_MCP_TOKEN: token },
  });
  const client = new Client({ name: 'asktab-e2e', version: '1.0.0' });
  let closed = false;
  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'browser',
      'debugger',
      'execute_javascript',
      'web_fetch',
    ]);

    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: 'browser', arguments: args }) as Promise<ToolResult>;

    const snapshot = await call({ action: 'snapshot', tabId });
    expect(snapshot.isError).toBeFalsy();
    const ref = Number(/\[(\d+)\] button[^\n]*Press me/.exec(textOf(snapshot))?.[1]);
    expect(Number.isInteger(ref)).toBe(true);

    // A separate call uses the ref from the snapshot: both belong to one MCP session.
    const click = await call({ action: 'click', tabId, ref });
    expect(click.isError).toBeFalsy();
    expect(textOf(click)).toContain('Clicked element');
    await expect.poll(() => page.title()).toBe('clicked');

    const screenshot = await call({ action: 'screenshot', tabId });
    expect(screenshot.isError).toBeFalsy();
    expect(screenshot.content.some(part => part.type === 'image')).toBe(true);

    const missing = await call({ action: 'click', tabId, ref: 9999 });
    expect(missing.isError).toBe(true);

    // Page markers from the session exist until the client disconnects.
    await expect.poll(() => page.locator('[data-asktab-visuals]').count()).toBeGreaterThan(0);
    await client.close();
    closed = true;
    await expect.poll(() => page.locator('[data-asktab-visuals]').count()).toBe(0);
  } finally {
    if (!closed) await client.close();
  }
});
