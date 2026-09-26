import { clearSnapshotVisuals, showCdpSnapshotVisuals } from './browser-visuals';
import { cdpSendWithReattach } from './cdp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefEntry } from './browser-snapshot';

vi.mock('./cdp', () => ({ cdpSendWithReattach: vi.fn() }));

const executeScript = vi.fn();
const sendCdp = vi.mocked(cdpSendWithReattach);

beforeEach(() => {
  executeScript.mockReset().mockResolvedValue([{ result: true }]);
  sendCdp.mockReset().mockImplementation(async (_tabId, method, params) => {
    if (method === 'DOM.resolveNode') {
      return { object: { objectId: `node-${params?.backendNodeId}` } };
    }
    return {};
  });
  vi.stubGlobal('chrome', { scripting: { executeScript } });
});

describe('CDP snapshot visuals', () => {
  it('binds the exact snapshot ref to its backend node before showing labels', async () => {
    const refs = new Map<number, RefEntry>([
      [1, { nodeId: 11, backendNodeId: 101 }],
      [7, { nodeId: 17, backendNodeId: 107 }],
    ]);

    expect(await showCdpSnapshotVisuals(5, refs)).toBe(true);
    expect(sendCdp).toHaveBeenCalledWith(5, 'DOM.resolveNode', { backendNodeId: 101 });
    expect(sendCdp).toHaveBeenCalledWith(5, 'DOM.resolveNode', { backendNodeId: 107 });
    expect(sendCdp).toHaveBeenCalledWith(
      5,
      'Runtime.callFunctionOn',
      expect.objectContaining({ objectId: 'node-101', arguments: [{ value: 1 }] }),
    );
    expect(sendCdp).toHaveBeenCalledWith(
      5,
      'Runtime.callFunctionOn',
      expect.objectContaining({ objectId: 'node-107', arguments: [{ value: 7 }] }),
    );
    expect(executeScript.mock.calls.map(([call]) => call.args[0])).toEqual(['prepare', 'show']);
  });

  it('clears only the known snapshot world', async () => {
    await clearSnapshotVisuals(5, 'cdp');
    expect(executeScript.mock.calls.map(([call]) => [call.world, call.args[0]])).toEqual([
      ['MAIN', 'clear'],
    ]);
  });

  it('clears both worlds when the snapshot backend was lost', async () => {
    await clearSnapshotVisuals(5, undefined);
    expect(executeScript.mock.calls.map(([call]) => [call.world, call.args[0]])).toEqual([
      ['MAIN', 'clear'],
      ['ISOLATED', 'clear'],
    ]);
  });

  it('keeps snapshot behavior intact when script injection is unavailable', async () => {
    executeScript.mockRejectedValue(new Error('restricted page'));

    expect(
      await showCdpSnapshotVisuals(5, new Map([[1, { nodeId: 11, backendNodeId: 101 }]])),
    ).toBe(false);
    expect(sendCdp).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledTimes(2);
  });
});
