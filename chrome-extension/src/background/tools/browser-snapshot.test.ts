import { walkNode } from './browser-snapshot';
import { describe, expect, it } from 'vitest';
import type { CDPNode, SnapshotContext } from './browser-snapshot';

let nextId = 0;
const element = (name: string, children: CDPNode[] = [], attributes: string[] = []): CDPNode => {
  const id = ++nextId;
  return { nodeId: id, backendNodeId: id, nodeType: 1, nodeName: name, children, attributes };
};
const text = (value: string): CDPNode => {
  const id = ++nextId;
  return { nodeId: id, backendNodeId: id, nodeType: 3, nodeName: '#text', nodeValue: value };
};
const snapshot = (root: CDPNode) => {
  const ctx: SnapshotContext = {
    refCounter: 0,
    nodeCount: 0,
    refMap: new Map(),
    lines: [],
  };
  walkNode(root, 0, ctx);
  return ctx;
};

describe('browser snapshot targets', () => {
  it('names buttons using nested text', () => {
    const ctx = snapshot(element('BUTTON', [element('SPAN', [text('Submit order')])]));
    expect(ctx.lines).toEqual(['[1] button "Submit order"']);
  });

  it('excludes hidden or disabled subtrees and includes keyboard/cursor controls', () => {
    const ctx = snapshot(
      element('DIV', [
        element('DIV', [element('BUTTON', [text('Hidden')])], ['style', 'display: none']),
        element('BUTTON', [text('Disabled')], ['disabled', '']),
        element('DIV', [text('Keyboard')], ['tabindex', '0']),
        element('DIV', [text('Pointer')], ['style', 'cursor: pointer']),
      ]),
    );
    expect(ctx.lines.join('\n')).toContain('[1] div "Keyboard"');
    expect(ctx.lines.join('\n')).toContain('[2] div "Pointer"');
    expect(ctx.lines.join('\n')).not.toContain('Hidden');
    expect(ctx.lines.join('\n')).not.toContain('Disabled');
    expect([...ctx.refMap.keys()]).toEqual([1, 2]);
  });

  it('walks open shadow roots', () => {
    const host = element('CUSTOM-WIDGET');
    host.shadowRoots = [
      {
        nodeId: ++nextId,
        backendNodeId: nextId,
        nodeType: 11,
        nodeName: '#document-fragment',
        children: [element('BUTTON', [text('Inside shadow')])],
      },
    ];
    expect(snapshot(host).lines).toContain('[1] button "Inside shadow"');
  });
});
