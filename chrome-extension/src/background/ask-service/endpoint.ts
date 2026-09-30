import { ASK_SERVICE_URL, LOCAL_ASK_SERVICE_URL } from '@extension/env';
import { isFileLoadedInstall, resolveServiceUrl, serviceTargetStorage } from '@extension/storage';

/**
 * Model base URLs are built synchronously, so the resolved address is cached here.
 * Entry points that build one first `await serviceUrlReady()`: a freshly woken service
 * worker has not read the stored target yet.
 */
let serviceUrl = ASK_SERVICE_URL;

const refresh = async (): Promise<void> => {
  try {
    const [target, fileLoaded] = await Promise.all([
      serviceTargetStorage.get(),
      isFileLoadedInstall(),
    ]);
    serviceUrl = resolveServiceUrl(ASK_SERVICE_URL, LOCAL_ASK_SERVICE_URL, target, fileLoaded);
  } catch {
    serviceUrl = ASK_SERVICE_URL;
  }
};

let ready = refresh();
serviceTargetStorage.subscribe(() => {
  ready = refresh();
});

const serviceUrlReady = (): Promise<void> => ready;

const getServiceUrl = (): string => serviceUrl;

export { getServiceUrl, serviceUrlReady };
