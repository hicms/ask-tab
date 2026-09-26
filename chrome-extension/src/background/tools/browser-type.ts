import { sendVisualCommand } from './browser-visuals';
import { cdpSendWithReattach } from './cdp';
import type { RefEntry } from './browser-snapshot';

const typeByRef = async (
  tabId: number,
  ref: number,
  entry: RefEntry,
  text: string,
): Promise<string> => {
  try {
    const { object } = await cdpSendWithReattach<{ object: { objectId: string } }>(
      tabId,
      'DOM.resolveNode',
      { backendNodeId: entry.backendNodeId },
    );

    await chrome.tabs.update(tabId, { active: true });
    await sendVisualCommand(tabId, 'MAIN', 'move', ref);
    const focusResult = await cdpSendWithReattach<{ result?: { value?: boolean | string } }>(
      tabId,
      'Runtime.callFunctionOn',
      {
        objectId: object.objectId,
        functionDeclaration: `function() {
        if (!this.isConnected) return 'Error: Target is stale. Run snapshot again.';
        if (this.matches(':disabled') || this.closest('[inert]')) return 'Error: Target is disabled or inert.';
        const input = this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement;
        if (!input && !this.isContentEditable) return 'Error: Target is not editable.';
        if (input && this.readOnly) return 'Error: Target is read-only.';
        if (this instanceof HTMLInputElement && /^(file|button|submit|reset|checkbox|radio|image|hidden)$/.test(this.type)) return 'Error: This input type does not accept text.';
        this.focus();
        if (input) {
          const prototype = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(this, '');
          this.dispatchEvent(new Event('input', { bubbles: true }));
          return false;
        }
        return this.isContentEditable;
      }`,
        returnByValue: true,
      },
    );
    if (typeof focusResult.result?.value === 'string') return focusResult.result.value;
    await sendVisualCommand(tabId, 'MAIN', 'click', ref);

    if (focusResult.result?.value === true) {
      const { os } = await chrome.runtime.getPlatformInfo();
      const modifiers = os === 'mac' ? 4 : 2;
      await cdpSendWithReattach(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers,
      });
      await cdpSendWithReattach(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers,
      });
      await cdpSendWithReattach(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
      await cdpSendWithReattach(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
    }

    await cdpSendWithReattach(tabId, 'Input.insertText', { text });
    return `Typed "${text.length > 50 ? text.slice(0, 50) + '...' : text}" into element [${ref}].`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error typing into element [${ref}]: ${msg}`;
  }
};

export { typeByRef };
