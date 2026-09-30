import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@extension/env', () => ({
  ASK_SERVICE_URL: 'https://ask.example.com',
  LOCAL_ASK_SERVICE_URL: 'http://local.test:9000',
}));

const storageState = vi.hoisted(() => ({
  target: 'remote' as 'remote' | 'local',
  fileLoaded: false,
  listener: undefined as (() => void) | undefined,
}));

vi.mock('@extension/storage', async importOriginal => ({
  ...(await importOriginal<typeof import('@extension/storage')>()),
  serviceTargetStorage: {
    get: vi.fn(async () => storageState.target),
    subscribe: vi.fn((listener: () => void) => {
      storageState.listener = listener;
      return () => {};
    }),
  },
  isFileLoadedInstall: vi.fn(async () => storageState.fileLoaded),
}));

const loadEndpoint = async () => {
  vi.resetModules();
  return import('./endpoint');
};

beforeEach(() => {
  storageState.target = 'remote';
  storageState.fileLoaded = false;
  storageState.listener = undefined;
});

describe('service endpoint', () => {
  it('uses the built-in address by default', async () => {
    const { getServiceUrl, serviceUrlReady } = await loadEndpoint();
    await serviceUrlReady();
    expect(getServiceUrl()).toBe('https://ask.example.com');
  });

  it('uses the local address for a file-loaded install that chose it', async () => {
    storageState.target = 'local';
    storageState.fileLoaded = true;
    const { getServiceUrl, serviceUrlReady } = await loadEndpoint();
    await serviceUrlReady();
    expect(getServiceUrl()).toBe('http://local.test:9000');
  });

  it('ignores a stored local choice on a store install', async () => {
    storageState.target = 'local';
    const { getServiceUrl, serviceUrlReady } = await loadEndpoint();
    await serviceUrlReady();
    expect(getServiceUrl()).toBe('https://ask.example.com');
  });

  it('follows later changes to the stored target', async () => {
    storageState.fileLoaded = true;
    const { getServiceUrl, serviceUrlReady } = await loadEndpoint();
    await serviceUrlReady();
    expect(getServiceUrl()).toBe('https://ask.example.com');

    storageState.target = 'local';
    storageState.listener?.();
    await serviceUrlReady();
    expect(getServiceUrl()).toBe('http://local.test:9000');

    storageState.target = 'remote';
    storageState.listener?.();
    await serviceUrlReady();
    expect(getServiceUrl()).toBe('https://ask.example.com');
  });
});
