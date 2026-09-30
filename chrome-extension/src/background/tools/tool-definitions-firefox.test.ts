/**
 * Tests for tools/index.ts — Firefox tool registry behavior.
 *
 * Verifies that the debugger tool is excluded from ALL_TOOLS when IS_FIREFOX=true,
 * while the browser tool remains available.
 *
 * NOTE: These tests will fail until tools/index.ts is updated with IS_FIREFOX guard.
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mock IS_FIREFOX = true ──
vi.mock('../ask-service/endpoint', () => ({
  getServiceUrl: () => 'http://ask.test',
  serviceUrlReady: async () => {},
}));
vi.mock('@extension/env', () => ({
  IS_FIREFOX: true,
  IS_DEV: false,
  IS_PROD: true,
  IS_CI: false,
  default: {},
}));

// ── Chrome API mocks (browser.ts and transitive deps need these) ──
Object.defineProperty(globalThis, 'chrome', {
  value: {
    debugger: {
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    tabGroups: {
      query: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve(undefined)),
      get: vi.fn(() => Promise.resolve(undefined)),
    },
    runtime: { lastError: undefined, sendMessage: vi.fn(() => Promise.resolve()) },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(() => Promise.resolve()),
      onAlarm: { addListener: vi.fn() },
    },
    declarativeNetRequest: {
      getSessionRules: vi.fn(() => Promise.resolve([])),
      getDynamicRules: vi.fn(() => Promise.resolve([])),
    },
    scripting: { executeScript: vi.fn(() => Promise.resolve([{ result: '' }])) },
    windows: { update: vi.fn() },
    identity: {
      getAuthToken: vi.fn(),
      removeCachedAuthToken: vi.fn(),
      launchWebAuthFlow: vi.fn(),
      getRedirectURL: vi.fn(() => 'https://test.chromiumapp.org/'),
    },
  },
  writable: true,
  configurable: true,
});

// ── Storage mock ──
vi.mock('@extension/storage', () => ({
  toolConfigStorage: {
    get: vi.fn(() =>
      Promise.resolve({
        enabledTools: { browser: true, debugger: true },
        webSearchConfig: {
          provider: 'server',
          browser: { engine: 'google' },
        },
      }),
    ),
    set: vi.fn(),
    subscribe: vi.fn(),
  },
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve({ enabled: false, level: 'info' })),
    subscribe: vi.fn(),
  },
  activeAgentStorage: {
    get: vi.fn(() => Promise.resolve('')),
    set: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(),
  },
  getAgent: vi.fn(() => Promise.resolve(undefined)),
}));

// ── Logger mock ──
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  configReady: Promise.resolve(),
}));

// The first dynamic import loads the whole tool registry and can exceed
// the default 5s timeout when the full suite runs in parallel.
describe('Tool registry — Firefox (IS_FIREFOX=true)', { timeout: 30_000 }, () => {
  it('does NOT include debugger tool in agent tools', async () => {
    const { getAgentTools } = await import('./index');
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);

    expect(toolNames).not.toContain('debugger');
  });

  it('still includes browser tool in agent tools', async () => {
    const { getAgentTools } = await import('./index');
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);

    expect(toolNames).toContain('browser');
  });

  it('does NOT include debugger in implemented tool names', async () => {
    const { getImplementedToolNames } = await import('./index');
    const names = getImplementedToolNames();

    expect(names.has('debugger')).toBe(false);
  });
});
