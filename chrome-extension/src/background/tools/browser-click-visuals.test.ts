import { clickByRef } from './browser-click';
import { typeByRef } from './browser-type';
import { sendVisualCommand } from './browser-visuals';
import { cdpSendWithReattach } from './cdp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./browser-visuals', () => ({ sendVisualCommand: vi.fn() }));
vi.mock('./cdp', () => ({ cdpSendWithReattach: vi.fn() }));

const sendCdp = vi.mocked(cdpSendWithReattach);
const showVisual = vi.mocked(sendVisualCommand);

beforeEach(() => {
  sendCdp.mockReset();
  showVisual.mockReset().mockResolvedValue(true);
  vi.stubGlobal('chrome', { tabs: { update: vi.fn().mockResolvedValue({}) } });
});

describe('CDP click visuals', () => {
  it('moves to the exact ref after validation and pulses before mouse release', async () => {
    const steps: string[] = [];
    vi.mocked(chrome.tabs.update).mockImplementation(async () => {
      steps.push('activate');
      return {} as chrome.tabs.Tab;
    });
    sendCdp.mockImplementation(async (_tabId, method, params) => {
      if (method === 'DOM.resolveNode') return { object: { objectId: 'target' } };
      if (method === 'Runtime.callFunctionOn') {
        return String(params?.functionDeclaration).includes('elementFromPoint')
          ? { result: { value: true } }
          : {};
      }
      if (method === 'DOM.getBoxModel') {
        steps.push('box');
        return { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } };
      }
      if (method === 'Input.dispatchMouseEvent') steps.push(String(params?.type));
      return {};
    });
    showVisual.mockImplementation(async (_tabId, _world, command, ref) => {
      steps.push(`${command}:${ref}`);
      return true;
    });

    expect(await clickByRef(5, 7, { backendNodeId: 107 })).toContain('Clicked element [7]');
    expect(steps).toEqual([
      'activate',
      'move:7',
      'box',
      'mouseMoved',
      'mousePressed',
      'click:7',
      'mouseReleased',
    ]);
  });

  it('shows typing feedback in the active tab before inserting text', async () => {
    const steps: string[] = [];
    vi.mocked(chrome.tabs.update).mockImplementation(async () => {
      steps.push('activate');
      return {} as chrome.tabs.Tab;
    });
    sendCdp.mockImplementation(async (_tabId, method) => {
      if (method === 'DOM.resolveNode') return { object: { objectId: 'input' } };
      if (method === 'Runtime.callFunctionOn') {
        steps.push('focus');
        return { result: { value: false } };
      }
      if (method === 'Input.insertText') steps.push('insertText');
      return {};
    });
    showVisual.mockImplementation(async (_tabId, _world, command, ref) => {
      steps.push(`${command}:${ref}`);
      return true;
    });

    expect(await typeByRef(5, 7, { nodeId: 7, backendNodeId: 107 }, 'hello')).toContain(
      'Typed "hello"',
    );
    expect(steps).toEqual(['activate', 'move:7', 'focus', 'click:7', 'insertText']);
  });
});
