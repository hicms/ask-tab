// eslint-disable-next-line import-x/order -- vitest must be imported first for vi.mock hoisting
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mocks — must be set up BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockDebuggerAttach = vi.fn((_target: unknown, _version: string, cb: () => void) => cb());
const mockDebuggerSendCommand = vi.fn(
  (_target: unknown, _method: string, _params: unknown, cb: (result: unknown) => void) =>
    cb({ ok: true }),
);

Object.defineProperty(globalThis, 'chrome', {
  value: {
    debugger: {
      attach: mockDebuggerAttach,
      sendCommand: mockDebuggerSendCommand,
    },
    runtime: {
      lastError: undefined as { message: string } | undefined,
    },
  },
  writable: true,
  configurable: true,
});

// Now import the module under test
// eslint-disable-next-line import-x/first, import-x/order -- must come after chrome mock setup
import { cdpSend, cdpAttach, cdpSendWithReattach, keepTabRendering } from './cdp';

beforeEach(() => {
  vi.clearAllMocks();
  chrome.runtime.lastError = undefined as unknown as typeof chrome.runtime.lastError;
});

// ── cdpSend ─────────────────────────────────────

describe('cdpSend', () => {
  it('resolves with result on success', async () => {
    mockDebuggerSendCommand.mockImplementation(
      (_target: unknown, _method: string, _params: unknown, cb: (result: unknown) => void) => {
        cb({ data: 'hello' });
      },
    );

    const result = await cdpSend<{ data: string }>(1, 'Runtime.evaluate', { expression: '1+1' });
    expect(result).toEqual({ data: 'hello' });
    expect(mockDebuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Runtime.evaluate',
      { expression: '1+1' },
      expect.any(Function),
    );
  });

  it('rejects when chrome.runtime.lastError is set', async () => {
    mockDebuggerSendCommand.mockImplementation(
      (_target: unknown, _method: string, _params: unknown, cb: (result: unknown) => void) => {
        chrome.runtime.lastError = { message: 'Tab not found' } as typeof chrome.runtime.lastError;
        cb({});
        chrome.runtime.lastError = undefined as unknown as typeof chrome.runtime.lastError;
      },
    );

    await expect(cdpSend(1, 'Runtime.evaluate')).rejects.toThrow('Tab not found');
  });

  it('sends empty params when none provided', async () => {
    mockDebuggerSendCommand.mockImplementation(
      (_target: unknown, _method: string, params: unknown, cb: (result: unknown) => void) => {
        cb(params);
      },
    );

    const result = await cdpSend(1, 'Runtime.enable');
    expect(result).toEqual({});
  });
});

// ── cdpAttach ───────────────────────────────────

describe('cdpAttach', () => {
  it('returns null on success', async () => {
    const result = await cdpAttach(1);
    expect(result).toBeNull();
    expect(mockDebuggerAttach).toHaveBeenCalledWith({ tabId: 1 }, '1.3', expect.any(Function));
  });

  it('returns null when "Another debugger already attached"', async () => {
    mockDebuggerAttach.mockImplementation((_target: unknown, _version: string, cb: () => void) => {
      chrome.runtime.lastError = {
        message: 'Another debugger is already attached to this tab',
      } as typeof chrome.runtime.lastError;
      cb();
      chrome.runtime.lastError = undefined as unknown as typeof chrome.runtime.lastError;
    });

    const result = await cdpAttach(1);
    expect(result).toBeNull();
  });

  it('returns error string on other failures', async () => {
    mockDebuggerAttach.mockImplementation((_target: unknown, _version: string, cb: () => void) => {
      chrome.runtime.lastError = {
        message: 'Cannot access a chrome:// URL',
      } as typeof chrome.runtime.lastError;
      cb();
      chrome.runtime.lastError = undefined as unknown as typeof chrome.runtime.lastError;
    });

    const result = await cdpAttach(1);
    expect(result).toBe('Cannot access a chrome:// URL');
  });
});

// ── keepTabRendering ────────────────────────────

describe('keepTabRendering', () => {
  it('enables focus emulation so a background tab keeps rendering', async () => {
    await keepTabRendering(3);
    expect(mockDebuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 3 },
      'Emulation.setFocusEmulationEnabled',
      { enabled: true },
      expect.any(Function),
    );
  });

  it('does not throw when the browser rejects focus emulation', async () => {
    mockDebuggerSendCommand.mockImplementation(
      (_target: unknown, _method: string, _params: unknown, cb: (result: unknown) => void) => {
        chrome.runtime.lastError = {
          message: "'Emulation.setFocusEmulationEnabled' wasn't found",
        } as typeof chrome.runtime.lastError;
        cb({});
        chrome.runtime.lastError = undefined as unknown as typeof chrome.runtime.lastError;
      },
    );

    await expect(keepTabRendering(3)).resolves.toBeUndefined();
  });
});

// ── cdpSendWithReattach ─────────────────────────

describe('cdpSendWithReattach', () => {
  it('restores focus emulation after re-attaching a detached debugger', async () => {
    mockDebuggerAttach.mockImplementation((_target: unknown, _version: string, cb: () => void) =>
      cb(),
    );
    let detached = true;
    const methods: string[] = [];
    mockDebuggerSendCommand.mockImplementation(
      (_target: unknown, method: string, _params: unknown, cb: (result: unknown) => void) => {
        methods.push(method);
        if (detached && method === 'DOM.getDocument') {
          detached = false;
          chrome.runtime.lastError = {
            message: 'Debugger is not attached to the tab with id: 5.',
          } as typeof chrome.runtime.lastError;
          cb({});
          chrome.runtime.lastError = undefined as unknown as typeof chrome.runtime.lastError;
          return;
        }
        cb({ ok: true });
      },
    );

    await expect(cdpSendWithReattach(5, 'DOM.getDocument')).resolves.toEqual({ ok: true });
    expect(mockDebuggerAttach).toHaveBeenCalledWith({ tabId: 5 }, '1.3', expect.any(Function));
    expect(methods).toContain('Emulation.setFocusEmulationEnabled');
    expect(methods.at(-1)).toBe('DOM.getDocument');
  });
});
