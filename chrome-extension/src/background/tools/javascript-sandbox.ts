import { cdpAttach, cdpSend } from './cdp';

let preparing: Promise<chrome.debugger.Debuggee> | null = null;
let legacyTabsCleaned = false;

const findSandbox = async (url: string) =>
  (await chrome.debugger.getTargets()).find(target => target.url === url && target.tabId == null);

const prepareSandbox = async (): Promise<chrome.debugger.Debuggee> => {
  const url = chrome.runtime.getURL('sandbox.html');
  let target = await findSandbox(url);
  if (!target) {
    // A hidden document preserves DOM APIs and window.__modules without a tab.
    // Never fall back to tabs.create: failures must not interrupt the user's browser.
    await chrome.offscreen.createDocument({
      url: 'sandbox.html',
      reasons: ['DOM_PARSER', 'BLOBS'] as chrome.offscreen.Reason[],
      justification:
        'Run JavaScript tools that parse HTML and generate Blob data without opening browser tabs.',
    });
    target = await findSandbox(url);
    if (!target) throw new Error('JavaScript sandbox debugging target is unavailable.');
  }

  const debuggee = { targetId: target.id };
  const error = await cdpAttach(debuggee);
  if (error) throw new Error(error);
  await cdpSend(debuggee, 'Runtime.enable');

  // Migrate tabs left by older versions only after the hidden runtime is ready.
  if (!legacyTabsCleaned) {
    const tabs = await chrome.tabs.query({ url });
    await Promise.all(
      tabs.map(async tab => {
        if (tab.id == null) return;
        try {
          const current = await chrome.tabs.get(tab.id);
          if (current.url === url && !current.pendingUrl) await chrome.tabs.remove(tab.id);
        } catch {
          // The user may have closed the old tab in the meantime.
        }
      }),
    );
    legacyTabsCleaned = true;
  }
  return debuggee;
};

/** Rediscover the document after worker restarts and serialize concurrent creation. */
const ensureJavascriptSandbox = (): Promise<chrome.debugger.Debuggee> => {
  if (!preparing) {
    preparing = prepareSandbox().finally(() => {
      preparing = null;
    });
  }
  return preparing;
};

/** Reset worker-local state for tests; the document itself remains alive. */
const resetJavascriptSandbox = () => {
  preparing = null;
  legacyTabsCleaned = false;
};

export { ensureJavascriptSandbox, resetJavascriptSandbox };
