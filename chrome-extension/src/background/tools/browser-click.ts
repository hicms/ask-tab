import { sendVisualCommand } from './browser-visuals';
import { cdpSendWithReattach } from './cdp';

interface ClickTarget {
  backendNodeId: number;
}

const getBoxCenter = async (
  tabId: number,
  backendNodeId: number,
): Promise<{ x: number; y: number }> => {
  const { model } = await cdpSendWithReattach<{ model: { content: number[] } }>(
    tabId,
    'DOM.getBoxModel',
    { backendNodeId },
  );
  if (!model?.content || model.content.length < 8) throw new Error('Box model unavailable');
  const [x1, y1, x2, y2, x3, y3, x4, y4] = model.content;
  return {
    x: Math.round((x1 + x2 + x3 + x4) / 4),
    y: Math.round((y1 + y2 + y3 + y4) / 4),
  };
};

const isClickableAtCenter = async (tabId: number, objectId: string): Promise<boolean> => {
  const { result } = await cdpSendWithReattach<{ result?: { value?: boolean } }>(
    tabId,
    'Runtime.callFunctionOn',
    {
      objectId,
      functionDeclaration: `function() {
        if (!this.isConnected || this.disabled || this.inert) return false;
        const style = this.ownerDocument.defaultView.getComputedStyle(this);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = this.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const root = this.getRootNode();
        const pointRoot = root instanceof ShadowRoot ? root : this.ownerDocument;
        const hit = pointRoot.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !!hit && (hit === this || this.contains(hit));
      }`,
      returnByValue: true,
    },
  );
  return result?.value === true;
};

const clickByRef = async (tabId: number, ref: number, entry: ClickTarget): Promise<string> => {
  let objectId: string;
  try {
    const { object } = await cdpSendWithReattach<{ object: { objectId: string } }>(
      tabId,
      'DOM.resolveNode',
      { backendNodeId: entry.backendNodeId },
    );
    objectId = object.objectId;
    await cdpSendWithReattach(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function() { this.scrollIntoView({ block: "center", behavior: "instant" }); }',
      awaitPromise: false,
    });
    if (!(await isClickableAtCenter(tabId, objectId))) {
      return `Error: Ref [${ref}] is hidden, stale, or blocked. Run "snapshot" to refresh refs.`;
    }
    await chrome.tabs.update(tabId, { active: true });
  } catch (err: unknown) {
    return `Error: Ref [${ref}] is stale or cannot be validated (${String(err)}). Run "snapshot" to refresh refs.`;
  }

  await sendVisualCommand(tabId, 'MAIN', 'move', ref);

  let center: { x: number; y: number };
  try {
    center = await getBoxCenter(tabId, entry.backendNodeId);
  } catch (boxError: unknown) {
    try {
      await sendVisualCommand(tabId, 'MAIN', 'click', ref);
      await cdpSendWithReattach(tabId, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function() { this.click(); }',
        awaitPromise: false,
      });
      return `Clicked element [${ref}] with DOM click fallback (coordinates unavailable; the page may ignore it).`;
    } catch (fallbackError: unknown) {
      return `Error clicking element [${ref}]: box model unavailable (${String(boxError)}); DOM fallback failed (${String(fallbackError)}).`;
    }
  }

  try {
    await cdpSendWithReattach(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: center.x,
      y: center.y,
      button: 'none',
      buttons: 0,
    });
    await cdpSendWithReattach(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: center.x,
      y: center.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await sendVisualCommand(tabId, 'MAIN', 'click', ref);
    await cdpSendWithReattach(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: center.x,
      y: center.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    return `Clicked element [${ref}] at (${center.x}, ${center.y}).`;
  } catch (err: unknown) {
    return `Error clicking element [${ref}] at (${center.x}, ${center.y}): ${String(err)}`;
  }
};

export { clickByRef, getBoxCenter };
