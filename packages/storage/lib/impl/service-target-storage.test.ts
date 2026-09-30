import { isFileLoadedInstall, resolveServiceUrl } from './service-target-storage.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const REMOTE = 'https://ask.example.com';
const LOCAL = 'http://127.0.0.1:9000';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveServiceUrl', () => {
  it('uses the local address only for a file-loaded install that chose it', () => {
    expect(resolveServiceUrl(REMOTE, LOCAL, 'local', true)).toBe(LOCAL);
  });

  it('keeps the built-in address for the remote choice', () => {
    expect(resolveServiceUrl(REMOTE, LOCAL, 'remote', true)).toBe(REMOTE);
  });

  it('ignores a stored local choice on store installs', () => {
    expect(resolveServiceUrl(REMOTE, LOCAL, 'local', false)).toBe(REMOTE);
  });

  it('ignores the local choice when the build has no local address', () => {
    expect(resolveServiceUrl(REMOTE, '', 'local', true)).toBe(REMOTE);
  });
});

describe('isFileLoadedInstall', () => {
  const stubInstallType = (installType: string) =>
    vi.stubGlobal('chrome', { management: { getSelf: async () => ({ installType }) } });

  it('is true for unpacked installs', async () => {
    stubInstallType('development');
    expect(await isFileLoadedInstall()).toBe(true);
  });

  it.each(['normal', 'sideload', 'admin', 'other'])('is false for %s installs', async type => {
    stubInstallType(type);
    expect(await isFileLoadedInstall()).toBe(false);
  });

  it('is false when the management API is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    expect(await isFileLoadedInstall()).toBe(false);
  });

  it('is false when the lookup rejects', async () => {
    vi.stubGlobal('chrome', {
      management: {
        getSelf: async () => {
          throw new Error('denied');
        },
      },
    });
    expect(await isFileLoadedInstall()).toBe(false);
  });
});
