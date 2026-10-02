import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelConfig } from '../channels/types';
import type { PublicModel } from '@extension/storage';

const local = vi.hoisted(() => ({
  selected: '',
  channels: [] as ChannelConfig[],
}));

vi.mock('../channels/config', () => ({
  getChannelConfigs: vi.fn(async () => local.channels.map(config => ({ ...config }))),
  updateChannelConfig: vi.fn(async (channelId: string, updates: Partial<ChannelConfig>) => {
    local.channels = local.channels.map(config =>
      config.channelId === channelId ? { ...config, ...updates } : config,
    );
  }),
}));
vi.mock('@extension/storage', async importOriginal => ({
  ...(await importOriginal<typeof import('@extension/storage')>()),
  selectedModelStorage: {
    get: vi.fn(async () => local.selected),
    set: vi.fn(async (value: string) => {
      local.selected = value;
    }),
  },
}));

const { migrateRetiredModelReferences } = await import('./retired-models');
const { chatDb } = await import('@extension/storage');

const chat = (id: string): PublicModel => ({
  id,
  name: id,
  protocol: 'anthropic-messages',
  kind: 'chat',
  embeddingSpaceId: null,
  isDefault: false,
  supportsTools: true,
  supportsReasoning: false,
  supportsImages: true,
  contextWindow: null,
  vendor: null,
  tier: null,
  priceMultiplier: null,
  reasoningControls: [],
});

const task = (id: string, model?: string) => ({
  id,
  name: id,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  schedule: { kind: 'every', everyMs: 60_000 },
  payload: { kind: 'agentTurn', message: 'hi', ...(model ? { model } : {}) },
  state: {},
});

beforeEach(async () => {
  local.selected = '';
  local.channels = [];
  await Promise.all([chatDb.agents.clear(), chatDb.scheduledTasks.clear()]);
});

describe('migrateRetiredModelReferences', () => {
  it('points every saved Claude Sonnet 5 choice at Claude Sonnet 5.5', async () => {
    local.selected = 'ask:claude-sonnet-5';
    local.channels = [
      { channelId: 'telegram', allowedSenderIds: [], modelId: 'ask:claude-sonnet-5' },
      { channelId: 'whatsapp', allowedSenderIds: [], modelId: 'ask:grok-4-6' },
    ];
    await chatDb.agents.bulkAdd([
      {
        id: 'writer',
        name: 'Writer',
        identity: {},
        isDefault: false,
        model: {
          primary: 'ask:claude-sonnet-5',
          fallbacks: ['ask:grok-4-6', 'ask:claude-sonnet-5'],
        },
        createdAt: 1,
        updatedAt: 1,
      },
      { id: 'plain', name: 'Plain', identity: {}, isDefault: true, createdAt: 1, updatedAt: 1 },
    ]);
    await chatDb.scheduledTasks.bulkAdd([
      task('daily', 'claude-sonnet-5'),
      task('other', 'grok-4-6'),
      task('default'),
    ]);

    await migrateRetiredModelReferences([chat('claude-sonnet-5-5'), chat('grok-4-6')]);

    expect(local.selected).toBe('ask:claude-sonnet-5-5');
    expect(local.channels.map(config => config.modelId)).toEqual([
      'ask:claude-sonnet-5-5',
      'ask:grok-4-6',
    ]);
    expect((await chatDb.agents.get('writer'))?.model).toEqual({
      primary: 'ask:claude-sonnet-5-5',
      fallbacks: ['ask:grok-4-6', 'ask:claude-sonnet-5-5'],
    });
    expect((await chatDb.agents.get('plain'))?.model).toBeUndefined();
    const tasks = await chatDb.scheduledTasks.toArray();
    expect(Object.fromEntries(tasks.map(row => [row.id, row.payload.model]))).toEqual({
      daily: 'claude-sonnet-5-5',
      other: 'grok-4-6',
      default: undefined,
    });
  });

  it('leaves choices alone while the catalog still has the retired model', async () => {
    local.selected = 'ask:claude-sonnet-5';
    await migrateRetiredModelReferences([chat('claude-sonnet-5'), chat('claude-sonnet-5-5')]);
    expect(local.selected).toBe('ask:claude-sonnet-5');
  });

  it('leaves choices alone when the catalog lacks the successor', async () => {
    local.selected = 'ask:claude-sonnet-5';
    await migrateRetiredModelReferences([chat('grok-4-6')]);
    expect(local.selected).toBe('ask:claude-sonnet-5');
  });
});
