import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@extension/env', () => ({ IS_FIREFOX: false }));
vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

it('leaves browser tabs untouched when a run never operates the browser', async () => {
  const query = vi.fn(async () => [{ id: 10, windowId: 1, url: 'https://example.com' }]);
  const group = vi.fn(async () => 100);
  const update = vi.fn(async () => ({}));
  vi.stubGlobal('chrome', { tabs: { query, group }, tabGroups: { update } });
  const { beginAgentTabGroup, endAgentTabGroup } = await import(
    '../../chrome-extension/src/background/tools/agent-tab-group'
  );

  await beginAgentTabGroup('pure-chat', 'Explain this code');
  endAgentTabGroup('pure-chat');

  expect(group).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});
