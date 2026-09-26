// Interaction behavior adapted from Alibaba Page Agent (MIT). See THIRD_PARTY_LICENSES.
import { sendVisualCommand } from './browser-visuals';
import { cdpSendWithReattach } from './cdp';
import type { BrowserArgs } from './browser-schema';
import type { RefEntry } from './browser-snapshot';

type PageAction = Pick<
  BrowserArgs,
  'action' | 'ref' | 'text' | 'value' | 'direction' | 'pixels' | 'pages'
>;

// Serialized in both execution worlds; all DOM behavior must remain self-contained.
const performPageAction = async function (
  this: Element | void,
  request: PageAction,
  useThis = false,
): Promise<string> {
  const scope = globalThis as typeof globalThis & {
    __askTabRefs?: Map<number, Element>;
    __askTabVisualState?: { pulse: () => void };
  };
  const element = useThis ? this : scope.__askTabRefs?.get(request.ref ?? -1);
  if (request.ref != null && !element?.isConnected) {
    return `Error: Ref [${request.ref}] is stale. Run "snapshot" to refresh refs.`;
  }
  const parent = (el: Element): Element | null =>
    el.parentElement ??
    (el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null);

  if (request.action === 'scroll') {
    const direction = request.direction ?? 'down';
    const horizontal = direction === 'left' || direction === 'right';
    const documentScroller = document.scrollingElement;
    let scroller: Element | null = element || documentScroller;
    if (element) {
      while (scroller && scroller !== documentScroller) {
        const style = getComputedStyle(scroller);
        const overflow = horizontal ? style.overflowX : style.overflowY;
        const range = horizontal
          ? scroller.scrollWidth - scroller.clientWidth
          : scroller.scrollHeight - scroller.clientHeight;
        if (/(auto|scroll|overlay)/.test(overflow) && range > 0) break;
        scroller = parent(scroller);
      }
    }
    if (!scroller) return 'Error: No scrollable ancestor found for this ref.';
    const size = horizontal ? scroller.clientWidth : scroller.clientHeight;
    const amount =
      (request.pixels ?? (request.pages ?? 1) * size) *
      (direction === 'up' || direction === 'left' ? -1 : 1);
    const before = horizontal ? scroller.scrollLeft : scroller.scrollTop;
    scroller.scrollBy({
      left: horizontal ? amount : 0,
      top: horizontal ? 0 : amount,
      behavior: 'instant',
    });
    const after = horizontal ? scroller.scrollLeft : scroller.scrollTop;
    return `Scrolled ${direction} by ${Math.abs(after - before)}px${element ? ` in the scrollable ancestor of [${request.ref}]` : ' on the page'}.${after === before ? ' Already at the boundary.' : ''}`;
  }

  if (!(element instanceof HTMLElement)) return 'Error: Target is not an HTML element.';
  for (let current: Element | null = element; current; current = parent(current)) {
    if (current.hasAttribute('inert')) return 'Error: Target is inert.';
  }
  if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true')
    return 'Error: Target is disabled.';
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(element).visibility === 'hidden')
    return 'Error: Target is hidden.';

  if (request.action === 'select') {
    if (!(element instanceof HTMLSelectElement))
      return 'Error: Ref is not a native <select>. Use snapshot and click for custom dropdowns.';
    const options = [...element.options].filter(option =>
      request.value !== undefined
        ? option.value === request.value
        : option.label.trim() === request.text?.trim(),
    );
    if (options.length === 0) return 'Error: No matching dropdown option.';
    if (options.length > 1)
      return 'Error: Multiple options match. Specify a unique label or value.';
    const option = options[0];
    if (option.disabled || option.parentElement?.matches('optgroup:disabled'))
      return 'Error: Dropdown option is disabled.';
    element.focus();
    element.selectedIndex = option.index;
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    scope.__askTabVisualState?.pulse();
    return `Selected "${option.label}" (value="${option.value}") in element [${request.ref}].`;
  }

  if (request.action === 'type') {
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
    if (!input && !element.isContentEditable) return 'Error: Target is not editable.';
    if (input && element.readOnly) return 'Error: Target is read-only.';
    if (
      element instanceof HTMLInputElement &&
      /^(file|button|submit|reset|checkbox|radio|image|hidden)$/.test(element.type)
    )
      return 'Error: This input type does not accept text.';
    element.focus();
    const text = request.text!;
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      composed: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    });
    if (!element.dispatchEvent(event)) return 'Error: The page cancelled text input.';
    if (input) {
      // Bypass an instance value setter (e.g. React's tracker) so input reaches the framework.
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, text);
    } else {
      element.textContent = text;
    }
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }),
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
    scope.__askTabVisualState?.pulse();
    return `Typed "${text.length > 50 ? text.slice(0, 50) + '...' : text}" into element [${request.ref}].`;
  }

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const root = element.getRootNode() as Document | ShadowRoot;
  const hit = root.elementFromPoint(x, y);
  if (!hit || !(element === hit || element.contains(hit)))
    return `Error: Ref [${request.ref}] is hidden or blocked. Run "snapshot" to refresh refs.`;
  const target = hit instanceof HTMLElement ? hit : element;
  const mouse = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
  };
  target.dispatchEvent(
    new PointerEvent('pointerover', {
      ...mouse,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }),
  );
  target.dispatchEvent(
    new PointerEvent('pointerenter', {
      ...mouse,
      bubbles: false,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }),
  );
  target.dispatchEvent(new MouseEvent('mouseover', mouse));
  target.dispatchEvent(new MouseEvent('mouseenter', { ...mouse, bubbles: false }));
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      ...mouse,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }),
  );
  target.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }));
  element.focus();
  scope.__askTabVisualState?.pulse();
  if (scope.__askTabVisualState) await new Promise(resolve => setTimeout(resolve, 120));
  target.dispatchEvent(
    new PointerEvent('pointerup', {
      ...mouse,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }),
  );
  target.dispatchEvent(new MouseEvent('mouseup', mouse));
  target.click();
  return `Clicked element [${request.ref}] <${element.tagName.toLowerCase()}>.`;
};

const executePageAction = async (
  args: BrowserArgs,
  backend: 'cdp' | 'scripting',
  entry?: RefEntry,
): Promise<string> => {
  if (args.tabId == null) return `Error: "tabId" is required for the "${args.action}" action.`;
  if (args.action !== 'scroll' && args.ref == null)
    return `Error: "ref" is required for the "${args.action}" action.`;
  if (args.action === 'type' && args.text === undefined)
    return 'Error: "text" is required for the "type" action.';
  if (args.action === 'select' && args.text === undefined && args.value === undefined)
    return 'Error: "text" (option label) or "value" is required for "select".';
  if (backend === 'cdp' && args.ref != null && !entry)
    return `Error: Ref [${args.ref}] not found. Run "snapshot" to refresh refs.`;
  const { action, ref, text, value, direction, pixels, pages } = args;
  const request = { action, ref, text, value, direction, pixels, pages };
  await chrome.tabs.update(args.tabId, { active: true });
  if (args.action !== 'scroll')
    await sendVisualCommand(args.tabId, backend === 'cdp' ? 'MAIN' : 'ISOLATED', 'move', args.ref);
  if (backend === 'cdp' && entry) {
    const { object } = await cdpSendWithReattach<{ object: { objectId: string } }>(
      args.tabId,
      'DOM.resolveNode',
      { backendNodeId: entry.backendNodeId },
    );
    const result = await cdpSendWithReattach<{
      result?: { value?: string };
      exceptionDetails?: { text: string };
    }>(args.tabId, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: performPageAction.toString(),
      arguments: [{ value: request }, { value: true }],
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) return `Error: ${result.exceptionDetails.text}`;
    return result.result?.value ?? 'Error: Page action returned no result.';
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: args.tabId },
    func: performPageAction,
    args: [request, false],
  });
  return results?.[0]?.result ?? 'Error: Page action returned no result.';
};

export { executePageAction, performPageAction };
