import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Chrome API mock ──
const mockGetTargets = vi.fn();
const mockAttach = vi.fn();
const mockDetach = vi.fn();
const mockSendCommand = vi.fn();

Object.defineProperty(globalThis, 'chrome', {
  value: {
    debugger: {
      getTargets: mockGetTargets,
      attach: mockAttach,
      detach: mockDetach,
      sendCommand: mockSendCommand,
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    runtime: { lastError: undefined as { message: string } | undefined },
  },
  writable: true,
  configurable: true,
});

// ── Mock storage (required by logger) ──
vi.mock('@extension/storage', () => ({
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve({ enabled: false, level: 'info' })),
    subscribe: vi.fn(),
  },
}));

const { executeDebugger, debuggerToolDef } = await import('./debugger');
const { releaseToolResources } = await import('./tool-lifecycle');

beforeEach(() => {
  vi.clearAllMocks();
  chrome.runtime.lastError = undefined;
});

// ── list_targets ──

describe('debugger — list_targets', () => {
  it('returns JSON of targets', async () => {
    const targets = [
      { id: 'target-1', type: 'page', title: 'Example', url: 'https://example.com' },
    ];
    mockGetTargets.mockImplementation((cb: (targets: unknown[]) => void) => {
      cb(targets);
    });

    const result = await executeDebugger({ action: 'list_targets' });
    expect(JSON.parse(result)).toEqual(targets);
  });

  it('returns error when getTargets fails', async () => {
    mockGetTargets.mockImplementation((cb: () => void) => {
      chrome.runtime.lastError = { message: 'Not allowed' };
      cb();
      chrome.runtime.lastError = undefined;
    });

    const result = await executeDebugger({ action: 'list_targets' });
    expect(result).toContain('Error');
    expect(result).toContain('Not allowed');
  });
});

// ── attach ──

describe('debugger — attach', () => {
  it('releases its connection with the registered task context', async () => {
    const signal = new AbortController().signal;
    mockAttach.mockImplementation((_target: unknown, _version: string, cb: () => void) => cb());
    mockDetach.mockImplementation((_target: unknown, cb: () => void) => cb());
    expect(debuggerToolDef.needsContext).toBe(true);
    expect(await debuggerToolDef.execute({ action: 'attach', tabId: 42 }, { signal })).toBe(
      'Debugger attached to tab 42',
    );
    expect(mockDetach).not.toHaveBeenCalled();
    await releaseToolResources(signal);
    expect(mockDetach).toHaveBeenCalledExactlyOnceWith({ tabId: 42 }, expect.any(Function));
  });

  it('attaches successfully', async () => {
    mockAttach.mockImplementation((_target: unknown, _version: string, cb: () => void) => {
      cb();
    });

    const result = await executeDebugger({ action: 'attach', tabId: 42 });
    expect(result).toBe('Debugger attached to tab 42');
  });

  it('returns error when tabId is missing', async () => {
    const result = await executeDebugger({ action: 'attach' });
    expect(result).toBe('Error: tabId is required for attach');
  });
});

// ── detach ──

describe('debugger — detach', () => {
  it('detaches successfully', async () => {
    mockDetach.mockImplementation((_target: unknown, cb: () => void) => {
      cb();
    });

    const result = await executeDebugger({ action: 'detach', tabId: 42 });
    expect(result).toBe('Debugger detached from tab 42');
  });

  it('returns error when tabId is missing', async () => {
    const result = await executeDebugger({ action: 'detach' });
    expect(result).toBe('Error: tabId is required for detach');
  });

  it('returns error on lastError', async () => {
    mockDetach.mockImplementation((_target: unknown, cb: () => void) => {
      chrome.runtime.lastError = { message: 'Debugger is not attached' };
      cb();
      chrome.runtime.lastError = undefined;
    });

    const result = await executeDebugger({ action: 'detach', tabId: 99 });
    expect(result).toContain('Error');
    expect(result).toContain('Debugger is not attached');
  });
});

// ── send ──

describe('debugger — send', () => {
  it('sends CDP command and returns result', async () => {
    const cdpResult = { result: { value: 42 } };
    mockSendCommand.mockImplementation(
      (_target: unknown, _method: string, _params: unknown, cb: (res: unknown) => void) => {
        cb(cdpResult);
      },
    );

    const result = await executeDebugger({
      action: 'send',
      tabId: 1,
      method: 'Runtime.evaluate',
      params: { expression: '1+1' },
    });
    expect(JSON.parse(result)).toEqual(cdpResult);
  });

  it('returns error when tabId is missing', async () => {
    const result = await executeDebugger({ action: 'send', method: 'Page.reload' });
    expect(result).toBe('Error: tabId is required for send');
  });

  it('returns error when method is missing', async () => {
    const result = await executeDebugger({ action: 'send', tabId: 1 });
    expect(result).toBe('Error: method is required for send');
  });

  it('returns error on CDP failure', async () => {
    mockSendCommand.mockImplementation(
      (_target: unknown, _method: string, _params: unknown, cb: () => void) => {
        chrome.runtime.lastError = { message: 'Method not found' };
        cb();
        chrome.runtime.lastError = undefined;
      },
    );

    const result = await executeDebugger({
      action: 'send',
      tabId: 1,
      method: 'Invalid.method',
    });
    expect(result).toContain('Error');
    expect(result).toContain('Method not found');
  });
});

// ── unknown action ──

describe('debugger — unknown action', () => {
  it('returns error for unknown action', async () => {
    const result = await executeDebugger({
      action: 'invalid' as Parameters<typeof executeDebugger>[0]['action'],
    });
    expect(result).toContain('Error');
    expect(result).toContain('Unknown action');
  });
});
