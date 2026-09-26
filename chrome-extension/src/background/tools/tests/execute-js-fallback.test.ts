import { executeCode } from '../execute-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attach, send, scripting } = vi.hoisted(() => ({
  attach: vi.fn(),
  send: vi.fn(),
  scripting: vi.fn(),
}));
vi.mock('../cdp', () => ({ cdpAttach: attach, cdpSend: send }));
vi.mock('../execute-js-firefox', () => ({ executeCodeFirefox: scripting }));
vi.mock('@extension/env', () => ({ IS_FIREFOX: false }));
vi.mock('@extension/storage', () => ({
  createAgentToolConfig: vi.fn(),
  getAgent: vi.fn(),
  updateAgent: vi.fn(),
}));
vi.mock('../tool-utils', () => ({ getActiveAgentId: vi.fn(), getWorkspaceFile: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { tabs: { get: vi.fn(async () => ({ id: 7 })) } });
});

describe('single JavaScript entry point', () => {
  it('preserves page execution via scripting when Chrome debugger attachment is unavailable', async () => {
    attach.mockResolvedValue('Another debugger is already attached');
    scripting.mockResolvedValue('Page title');
    expect(await executeCode('return document.title', { a: 1 }, 5000, 7, 'title')).toBe(
      'Page title',
    );
    expect(scripting).toHaveBeenCalledWith('return document.title', { a: 1 }, 5000, 7, 'title');
    expect(send).not.toHaveBeenCalled();
  });

  it('never reruns a failed page script through scripting after CDP execution started', async () => {
    attach.mockResolvedValue(null);
    send.mockImplementation(async (_tabId, method, params) => {
      if (method === 'Runtime.evaluate' && params?.awaitPromise)
        throw new Error('execution failed');
      return {};
    });
    await expect(executeCode('return submitForm()', undefined, 5000, 7)).rejects.toThrow(
      'execution failed',
    );
    expect(scripting).not.toHaveBeenCalled();
  });
});
