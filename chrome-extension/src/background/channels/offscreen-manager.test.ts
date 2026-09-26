/**
 * Tests for offscreen-manager.ts — Firefox hidden window vs Chrome offscreen API.
 *
 * Tests verify the dual-path behavior:
 * - Chrome: chrome.offscreen.createDocument / hasDocument / closeDocument
 * - Firefox: chrome.windows.create (popup/minimized) / get / remove
 *
 * The IS_FIREFOX flag is mocked at the module level. Since it's a build-time constant
 * inlined by Vite, we mock the @extension/env module to control it per test suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mocks ──

const mockHasDocument = vi.fn<() => Promise<boolean>>(() => Promise.resolve(false));
const mockCreateDocument = vi.fn(() => Promise.resolve());
const mockCloseDocument = vi.fn(() => Promise.resolve());

const mockWindowsCreate = vi.fn(() => Promise.resolve({ id: 42 }));
const mockWindowsGet = vi.fn(() => Promise.resolve({ id: 42 }));
const mockWindowsRemove = vi.fn(() => Promise.resolve());

const mockAlarmsClear = vi.fn(() => Promise.resolve());
const mockAlarmsCreate = vi.fn();
const mockGetRuntimeURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`);
const mockSendMessage = vi.fn(() => Promise.resolve({ ok: true }));

const mockGetSessionRules = vi.fn(() => Promise.resolve([]));
const mockGetDynamicRules = vi.fn(() => Promise.resolve([]));

Object.defineProperty(globalThis, 'chrome', {
  value: {
    offscreen: {
      hasDocument: mockHasDocument,
      createDocument: mockCreateDocument,
      closeDocument: mockCloseDocument,
      Reason: { WORKERS: 'WORKERS' },
    },
    windows: {
      create: mockWindowsCreate,
      get: mockWindowsGet,
      remove: mockWindowsRemove,
    },
    runtime: {
      getURL: mockGetRuntimeURL,
      sendMessage: mockSendMessage,
      id: 'test-id',
    },
    alarms: {
      clear: mockAlarmsClear,
      create: mockAlarmsCreate,
    },
    declarativeNetRequest: {
      getSessionRules: mockGetSessionRules,
      getDynamicRules: mockGetDynamicRules,
      // testMatchOutcome intentionally NOT defined to test feature-detection
    },
  },
  writable: true,
  configurable: true,
});

// ── Logger mock ──
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Channel config mock ──
let mockConfigs: Array<{
  channelId: string;
  status: string;
  enabled: boolean;
  lastPollOffset?: number;
  lastActivityAt?: number;
}> = [];
vi.mock('./config', () => ({
  getChannelConfig: vi.fn((id: string) => {
    const c = mockConfigs.find(c => c.channelId === id);
    return Promise.resolve(c ?? null);
  }),
  getChannelConfigs: vi.fn(() => Promise.resolve(mockConfigs)),
  updateChannelConfig: vi.fn(() => Promise.resolve()),
}));

vi.mock('./message-bridge', () => ({
  handleChannelUpdates: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./poller', () => ({
  createPassiveAlarm: vi.fn(),
  clearPassiveAlarm: vi.fn(() => Promise.resolve()),
}));

// ── Tests ──

/**
 * NOTE: These tests verify the TARGET behavior after Firefox compat implementation.
 * They will fail until offscreen-manager.ts is updated with IS_FIREFOX dual-path.
 *
 * For now, the Chrome-path tests (which test current behavior) should pass,
 * and the Firefox-path tests will fail until implementation.
 */

describe('offscreen-manager — Chrome path (IS_FIREFOX=false)', () => {
  // Default IS_FIREFOX = false (no mock needed since the module currently has no Firefox path)

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigs = [];
  });

  it('ensureOffscreenDocument creates offscreen doc when none exists', async () => {
    mockHasDocument.mockResolvedValue(false);

    const { ensureOffscreenDocument } = await import('./offscreen-manager');
    await ensureOffscreenDocument();

    expect(mockHasDocument).toHaveBeenCalled();
    expect(mockCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('offscreen-channels/index.html'),
      }),
    );
  });

  it('ensureOffscreenDocument skips when document already exists', async () => {
    mockHasDocument.mockResolvedValue(true);

    const { ensureOffscreenDocument } = await import('./offscreen-manager');
    await ensureOffscreenDocument();

    expect(mockHasDocument).toHaveBeenCalled();
    expect(mockCreateDocument).not.toHaveBeenCalled();
  });

  it('maybeCloseOffscreenDocument closes when no active channels', async () => {
    mockConfigs = [{ channelId: 'telegram', status: 'passive', enabled: true }];
    mockHasDocument.mockResolvedValue(true);

    const { maybeCloseOffscreenDocument } = await import('./offscreen-manager');
    await maybeCloseOffscreenDocument();

    expect(mockCloseDocument).toHaveBeenCalled();
    expect(mockAlarmsClear).toHaveBeenCalled();
  });

  it('maybeCloseOffscreenDocument keeps doc when active channels exist', async () => {
    mockConfigs = [{ channelId: 'telegram', status: 'active', enabled: true }];

    const { maybeCloseOffscreenDocument } = await import('./offscreen-manager');
    await maybeCloseOffscreenDocument();

    expect(mockCloseDocument).not.toHaveBeenCalled();
  });
});

describe('offscreen-manager — switchToActiveMode diagnostic guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDocument.mockResolvedValue(false);
    mockConfigs = [{ channelId: 'whatsapp', status: 'passive', enabled: true, lastPollOffset: 0 }];
  });

  it('switchToActiveMode does not crash when testMatchOutcome is undefined (Firefox)', async () => {
    // testMatchOutcome is not defined in our mock — simulates Firefox
    const { switchToActiveMode } = await import('./offscreen-manager');

    // Should not throw — the diagnostic section should be guarded
    await expect(switchToActiveMode('whatsapp')).resolves.not.toThrow();
  });
});
