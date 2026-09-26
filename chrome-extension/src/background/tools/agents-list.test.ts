import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@extension/storage', () => ({
  listAgents: vi.fn(async () => [
    {
      id: 'main',
      name: 'Main',
      isDefault: true,
      identity: { emoji: '\u{1F916}' },
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'research',
      name: 'Research',
      isDefault: false,
      identity: { emoji: '\u{1F52C}' },
      createdAt: 2000,
      updatedAt: 2000,
    },
  ]),
  activeAgentStorage: { get: vi.fn(async () => 'main') },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agents_list tool — executeAgentsList', () => {
  let executeAgentsList: typeof import('./agents-list').executeAgentsList;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./agents-list');
    executeAgentsList = mod.executeAgentsList;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns agents with active indicator', async () => {
    const result = JSON.parse(await executeAgentsList());

    expect(result.count).toBe(2);
    expect(result.activeAgentId).toBe('main');
    expect(result.agents).toHaveLength(2);
    expect(result.agents[0]).toEqual({
      id: 'main',
      name: 'Main',
      emoji: '\u{1F916}',
      isDefault: true,
      active: true,
    });
    expect(result.agents[1]).toEqual({
      id: 'research',
      name: 'Research',
      emoji: '\u{1F52C}',
      isDefault: false,
      active: false,
    });
  });

  it('marks correct agent as active', async () => {
    const { activeAgentStorage } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('research');

    const result = JSON.parse(await executeAgentsList());

    expect(result.activeAgentId).toBe('research');
    expect(result.agents[0].active).toBe(false);
    expect(result.agents[1].active).toBe(true);
  });

  it('handles empty agents list', async () => {
    const { listAgents } = await import('@extension/storage');
    vi.mocked(listAgents).mockResolvedValueOnce([]);

    const result = JSON.parse(await executeAgentsList());

    expect(result.count).toBe(0);
    expect(result.agents).toHaveLength(0);
  });
});
