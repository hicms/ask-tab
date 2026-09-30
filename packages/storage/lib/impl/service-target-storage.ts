import { createStorage, StorageEnum } from '../base/index.js';

type ServiceTarget = 'remote' | 'local';

/**
 * Which ask_service the extension talks to. Only honored for file-loaded installs
 * (see `isFileLoadedInstall`); store builds always use the built-in address.
 * Deliberately outside the full-backup key set: it describes this install, not the account.
 */
const serviceTargetStorage = createStorage<ServiceTarget>('service-target', 'remote', {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/**
 * True when the extension was loaded unpacked ("Load unpacked"), which Chrome reports
 * as `installType: 'development'`. `getSelf` needs no extra permission. Any failure
 * (API missing, unsupported browser) counts as a normal install.
 */
const isFileLoadedInstall = async (): Promise<boolean> => {
  try {
    return (await chrome.management.getSelf()).installType === 'development';
  } catch {
    return false;
  }
};

/**
 * A stored `local` choice is ignored unless the install is file-loaded and the build
 * configured a local address.
 */
const resolveServiceUrl = (
  remoteUrl: string,
  localUrl: string,
  target: ServiceTarget,
  fileLoaded: boolean,
): string => (fileLoaded && target === 'local' && localUrl ? localUrl : remoteUrl);

export type { ServiceTarget };
export { isFileLoadedInstall, resolveServiceUrl, serviceTargetStorage };
