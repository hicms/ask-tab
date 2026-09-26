// ── Agents List tool ─────────────────────────────
// TypeBox-schema tool for listing available agents (read-only)

import { listAgents, activeAgentStorage } from '@extension/storage';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration } from './tool-registration';

const agentsListSchema = Type.Object({});

const executeAgentsList = async (): Promise<string> => {
  const agents = await listAgents();
  const activeId = await activeAgentStorage.get();
  return JSON.stringify({
    count: agents.length,
    activeAgentId: activeId,
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      emoji: a.identity?.emoji,
      isDefault: a.isDefault,
      active: a.id === activeId,
    })),
  });
};

// ── Tool registration ──

const agentsListToolDef: ToolRegistration = {
  name: 'agents_list',
  label: 'List Agents',
  description: 'List available agents with their IDs, names, and active status.',
  schema: agentsListSchema,
  excludeInHeadless: true,
  execute: () => executeAgentsList(),
};

export { agentsListSchema, executeAgentsList, agentsListToolDef };
