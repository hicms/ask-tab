/**
 * Side panel / sidebar utilities — browser-agnostic via capability detection.
 *
 * Chrome uses `chrome.sidePanel`, Firefox uses `browser.sidebarAction`.
 * No IS_FIREFOX import — pure feature detection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Open the side panel / sidebar.
 * Chrome: `chrome.sidePanel.open({})`
 * Firefox: `browser.sidebarAction.open()`
 */
const openSidePanel = async (): Promise<void> => {
  if (typeof (chrome as any).sidePanel?.open === 'function') {
    await (chrome as any).sidePanel.open({});
    return;
  }
  // Firefox: browser.sidebarAction.open()
  const browser = (globalThis as any).browser;
  if (typeof browser?.sidebarAction?.open === 'function') {
    await browser.sidebarAction.open();
    return;
  }
  // Neither API available — silently ignore
};

/**
 * Set side panel behavior (e.g. open on action click).
 * Chrome: `chrome.sidePanel.setPanelBehavior()`
 * Firefox: no-op (sidebar_action behavior is defined in manifest)
 */
const initSidePanelBehavior = (): void => {
  (chrome as any).sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    ?.catch?.(() => {});
};

export { openSidePanel, initSidePanelBehavior };
