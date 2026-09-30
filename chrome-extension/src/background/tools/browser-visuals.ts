import { cursorAppearance } from './browser-cursor';
import { cdpSendWithReattach } from './cdp';
import type { CursorAppearance } from './browser-cursor';
import type { RefEntry } from './browser-snapshot';

type VisualCommand = 'prepare' | 'show' | 'move' | 'click' | 'clear' | 'reset';
type VisualWorld = 'MAIN' | 'ISOLATED';

// This function is serialized by chrome.scripting.executeScript. Keep it self-contained.
const renderBrowserVisuals = async (
  command: VisualCommand,
  ref: number | null,
  appearance: CursorAppearance,
): Promise<boolean> => {
  interface VisualState {
    host: HTMLElement;
    boxes: HTMLElement;
    cursor: HTMLElement;
    render: () => void;
    pulse: () => void;
    dispose: () => void;
  }
  const scope = globalThis as typeof globalThis & {
    __askTabVisualRefs?: Map<number, Element>;
    __askTabRefs?: Map<number, Element>;
    __askTabVisualState?: VisualState;
    __askTabCursorPosition?: { x: number; y: number };
  };
  const state = scope.__askTabVisualState;
  const removeHosts = () => {
    // An extension reload can leave DOM markers whose isolated-world state is gone.
    for (const host of document.querySelectorAll('[data-asktab-visuals="true"]')) host.remove();
  };

  if (command === 'clear' || command === 'reset') {
    state?.dispose();
    removeHosts();
    delete scope.__askTabVisualState;
    scope.__askTabVisualRefs?.clear();
    if (command === 'reset') {
      scope.__askTabRefs?.clear();
      delete scope.__askTabCursorPosition;
    }
    return true;
  }
  if (command === 'prepare') {
    state?.dispose();
    removeHosts();
    delete scope.__askTabVisualState;
    scope.__askTabVisualRefs = new Map();
    return true;
  }

  const targets = scope.__askTabVisualRefs?.size ? scope.__askTabVisualRefs : scope.__askTabRefs;
  if (!document.documentElement || typeof document.createElement !== 'function') return false;
  if (command === 'show' && window !== window.top && !targets?.size) return false;

  const ensureState = (): VisualState => {
    if (scope.__askTabVisualState?.host.isConnected) return scope.__askTabVisualState;
    scope.__askTabVisualState?.dispose();
    removeHosts();

    const host = document.createElement('div');
    host.setAttribute('data-asktab-visuals', 'true');
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;contain:layout style;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host, * { pointer-events: none !important; box-sizing: border-box; }
      .boxes { position: absolute; inset: 0; }
      .box { position: fixed; border: 2px solid color-mix(in srgb, var(--color) 50%, transparent); background: color-mix(in srgb, var(--color) 10%, transparent); }
      .label { position: fixed; min-width: 17px; padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, var(--color) 50%, transparent); color: #fff; font: 700 11px/16px system-ui, sans-serif; text-align: center; box-shadow: 0 1px 4px #0006; }
      ${appearance.style}
    `;
    const boxes = document.createElement('div');
    boxes.className = 'boxes';
    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.innerHTML = appearance.markup;
    cursor.style.visibility = window === window.top ? 'visible' : 'hidden';
    const position = scope.__askTabCursorPosition ?? { x: innerWidth / 2, y: innerHeight / 2 };
    position.x = Math.max(0, Math.min(innerWidth - 20, position.x));
    position.y = Math.max(0, Math.min(innerHeight - 20, position.y));
    cursor.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    scope.__askTabCursorPosition = position;
    shadow.append(style, boxes, cursor);
    document.documentElement.appendChild(host);

    const colors = [
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFA500',
      '#800080',
      '#008080',
      '#FF69B4',
      '#4B0082',
      '#FF4500',
      '#2E8B57',
      '#DC143C',
      '#4682B4',
    ];
    const isVisible = (element: Element): boolean => {
      if (getComputedStyle(element).visibility !== 'visible') return false;
      for (let ancestor: Element | null = element; ancestor; ) {
        if (
          ancestor.matches('[hidden], [inert], [aria-hidden="true"]') ||
          Number(getComputedStyle(ancestor).opacity) === 0
        )
          return false;
        const root = ancestor.getRootNode();
        ancestor = ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
      }
      return true;
    };
    const isUncovered = (element: Element, rect: DOMRect): boolean => {
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return false;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      let root = element.getRootNode();
      const pointRoot = root instanceof ShadowRoot ? root : element.ownerDocument;
      let hit = pointRoot.elementFromPoint(x, y);
      if (!hit || (hit !== element && !element.contains(hit))) return false;
      // A shadow-root hit alone cannot prove that a panel outside that root is absent.
      while (root instanceof ShadowRoot) {
        const host = root.host;
        root = host.getRootNode();
        const outerRoot = root instanceof ShadowRoot ? root : element.ownerDocument;
        hit = outerRoot.elementFromPoint(x, y);
        if (!hit || (hit !== host && !host.contains(hit))) return false;
      }
      return true;
    };
    let scheduled = false;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      boxes.replaceChildren();
      const visibleTargets = scope.__askTabVisualRefs?.size
        ? scope.__askTabVisualRefs
        : scope.__askTabRefs;
      for (const [index, element] of visibleTargets ?? []) {
        if (!element.isConnected || !isVisible(element)) continue;
        const color = colors[index % colors.length];
        const rects = [...element.getClientRects()].filter(
          rect => rect.width > 0 && rect.height > 0 && isUncovered(element, rect),
        );
        for (const rect of rects) {
          const box = document.createElement('div');
          box.className = 'box';
          box.style.setProperty('--color', color);
          box.style.cssText += `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
          boxes.appendChild(box);
        }
        if (!rects.length) continue;
        const rect = rects[0];
        const label = document.createElement('div');
        label.className = 'label';
        label.style.setProperty('--color', color);
        label.textContent = String(index);
        const labelWidth = Math.max(20, String(index).length * 7 + 8);
        const top = rect.width < labelWidth + 4 || rect.height < 20 ? rect.top - 20 : rect.top + 2;
        label.style.left = `${Math.max(0, Math.min(innerWidth - labelWidth, rect.right - labelWidth - 2))}px`;
        label.style.top = `${Math.max(0, Math.min(innerHeight - 18, top))}px`;
        boxes.appendChild(label);
      }
    };
    const schedule = () => {
      if (!host.isConnected) {
        dispose();
        if (scope.__askTabVisualState?.host === host) delete scope.__askTabVisualState;
        return;
      }
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        render();
      });
    };
    const pulse = () => {
      cursor.classList.remove('clicking');
      void cursor.offsetWidth;
      cursor.classList.add('clicking');
    };
    const layoutEvents = ['scroll', 'transitionend', 'animationend'];
    for (const type of layoutEvents) window.addEventListener(type, schedule, true);
    window.addEventListener('resize', schedule);
    // Page updates after a click can move or remove targets without scrolling, which would
    // otherwise leave boxes and numbers at stale coordinates.
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const dispose = () => {
      disposed = true;
      observer.disconnect();
      for (const type of layoutEvents) window.removeEventListener(type, schedule, true);
      window.removeEventListener('resize', schedule);
      host.remove();
    };
    const created = { host, boxes, cursor, render, pulse, dispose };
    scope.__askTabVisualState = created;
    return created;
  };

  if (command === 'show') {
    ensureState().render();
    return true;
  }
  const target = targets?.get(ref ?? -1);
  if (!target?.isConnected) {
    if (command === 'move' && state) state.cursor.style.visibility = 'hidden';
    return false;
  }
  const current = ensureState();
  if (command === 'move') {
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    current.render();
    const rect = target.getBoundingClientRect();
    const position = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    scope.__askTabCursorPosition = position;
    current.cursor.classList.toggle(
      'pointing',
      target.closest(
        'a[href], button, summary, input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], [role="button"], [role="link"]',
      ) !== null || getComputedStyle(target).cursor === 'pointer',
    );
    current.cursor.style.visibility = 'visible';
    current.cursor.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    await new Promise(resolve => setTimeout(resolve, 330));
    return true;
  }
  if (command === 'click') {
    current.pulse();
    await new Promise(resolve => setTimeout(resolve, 120));
    return true;
  }
  return false;
};

const sendVisualCommand = async (
  tabId: number,
  world: VisualWorld,
  command: VisualCommand,
  ref?: number,
): Promise<boolean> => {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world,
      func: renderBrowserVisuals,
      args: [command, ref ?? null, cursorAppearance],
    });
    return result.some(frame => frame.result === true);
  } catch (allFramesError) {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func: renderBrowserVisuals,
        args: [command, ref ?? null, cursorAppearance],
      });
      return result.some(frame => frame.result === true);
    } catch (topFrameError) {
      // Keep this helper independent of storage initialization in the extension logger.
      // eslint-disable-next-line no-console
      console.warn('[browser visuals] unavailable', { command, allFramesError, topFrameError });
      return false;
    }
  }
};

const clearSnapshotVisuals = async (
  tabId: number,
  backend: 'cdp' | 'scripting' | undefined,
): Promise<void> => {
  // The backend is unknown after a service worker restart, but page markers survive it.
  const worlds: VisualWorld[] = backend
    ? [backend === 'cdp' ? 'MAIN' : 'ISOLATED']
    : ['MAIN', 'ISOLATED'];
  await Promise.all(worlds.map(world => sendVisualCommand(tabId, world, 'clear')));
};

const showCdpSnapshotVisuals = async (
  tabId: number,
  refMap: Map<number, RefEntry>,
): Promise<boolean> => {
  if (!(await sendVisualCommand(tabId, 'MAIN', 'prepare'))) return false;

  const entries = [...refMap];
  let next = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(12, entries.length) }, async () => {
    while (next < entries.length) {
      const [ref, entry] = entries[next++];
      try {
        const { object } = await cdpSendWithReattach<{ object: { objectId: string } }>(
          tabId,
          'DOM.resolveNode',
          { backendNodeId: entry.backendNodeId },
        );
        const response = await cdpSendWithReattach<{ exceptionDetails?: unknown }>(
          tabId,
          'Runtime.callFunctionOn',
          {
            objectId: object.objectId,
            functionDeclaration:
              'function(ref) { (globalThis.__askTabVisualRefs ??= new Map()).set(ref, this); }',
            arguments: [{ value: ref }],
          },
        );
        if (response.exceptionDetails) failed++;
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  if (failed) {
    // eslint-disable-next-line no-console
    console.warn(`[browser visuals] Could not draw ${failed} of ${entries.length} refs`);
  }
  return sendVisualCommand(tabId, 'MAIN', 'show');
};

export { clearSnapshotVisuals, renderBrowserVisuals, sendVisualCommand, showCdpSnapshotVisuals };
export type { VisualCommand, VisualWorld };
