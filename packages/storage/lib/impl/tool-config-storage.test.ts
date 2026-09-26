import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolConfig } from './tool-config-storage';

let storedData: ToolConfig | undefined;
vi.mock('../base/index.js', () => ({
  createStorage: <T>(_key: string, defaultValue: T) => ({
    get: vi.fn(async () => storedData ?? defaultValue),
    set: vi.fn(async (value: T) => {
      storedData = value as ToolConfig;
    }),
    getSnapshot: vi.fn(() => storedData ?? defaultValue),
    subscribe: vi.fn(),
  }),
  StorageEnum: { Local: 'local', Session: 'session' },
}));
const { toolConfigStorage, createAgentToolConfig } = await import('./tool-config-storage');

beforeEach(() => {
  storedData = undefined;
});

describe('current tool configuration', () => {
  it('uses server search and current tool defaults on a fresh install', async () => {
    const config = await toolConfigStorage.get();
    expect(config.webSearchConfig).toEqual({ provider: 'server', browser: { engine: 'google' } });
    expect(config.enabledTools.web_search).toBe(true);
    expect(config.enabledTools.memory_search).toBe(true);
    expect(config.enabledTools.gmail_send).toBe(false);
  });

  it('stores current preferences without changing explicit switches', async () => {
    const config = { ...(await toolConfigStorage.get()), enabledTools: { web_search: false } };
    await toolConfigStorage.set(config);
    expect((await toolConfigStorage.get()).enabledTools.web_search).toBe(false);
    expect((await toolConfigStorage.get()).enabledTools.web_fetch).toBe(true);
    expect(storedData).toEqual(config);
  });

  it('rejects extra credential fields at the write boundary', async () => {
    const invalid = { ...createAgentToolConfig(), webSearchApiKey: 'tvly-secret' } as ToolConfig;
    await expect(toolConfigStorage.set(invalid)).rejects.toThrow('Invalid tool configuration');
    expect(storedData).toBeUndefined();
  });

  it('rejects an unknown search provider at the read boundary', async () => {
    storedData = {
      ...createAgentToolConfig(),
      webSearchConfig: {
        provider: 'tavily',
        browser: { engine: 'google' },
      },
    } as unknown as ToolConfig;
    await expect(toolConfigStorage.get()).rejects.toThrow('Invalid tool configuration');
  });
});
