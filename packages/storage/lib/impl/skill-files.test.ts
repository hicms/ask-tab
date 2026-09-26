import { chatDb } from './chat-db';
import {
  createWorkspaceFile,
  seedPredefinedWorkspaceFiles,
  listSkillFiles,
  listToolScriptFiles,
  getEnabledSkills,
} from './chat-storage';
import { parseSkillFrontmatter } from '@extension/skills';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DbWorkspaceFile } from './chat-db';

beforeEach(async () => {
  await chatDb.workspaceFiles.clear();
});

const makeWorkspaceFile = (overrides: Partial<DbWorkspaceFile> = {}): DbWorkspaceFile => ({
  id: 'ws-1',
  name: 'test-file.md',
  content: 'Test content',
  enabled: true,
  owner: 'user',
  predefined: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const VALID_SKILL_CONTENT = `---
name: Test Skill
description: A test skill for unit testing
---

# Test Skill

Instructions here.
`;

const INVALID_SKILL_CONTENT = `# Just a markdown file

No frontmatter here.
`;

describe('listSkillFiles', () => {
  it('returns only files matching skills/*/SKILL.md', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-1',
        name: 'skills/test-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({ id: 'ws-1', name: 'AGENTS.md', content: 'Agent config' }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({ id: 'ws-2', name: 'memory/notes.md', content: 'Notes', owner: 'agent' }),
    );

    const skills = await listSkillFiles();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('skills/test-skill/SKILL.md');
  });

  it('returns empty array when no skill files exist', async () => {
    await createWorkspaceFile(makeWorkspaceFile({ id: 'ws-1', name: 'AGENTS.md' }));
    const skills = await listSkillFiles();
    expect(skills).toHaveLength(0);
  });

  it('excludes regular workspace and memory files', async () => {
    await createWorkspaceFile(makeWorkspaceFile({ id: 'ws-1', name: 'SOUL.md' }));
    await createWorkspaceFile(
      makeWorkspaceFile({ id: 'ws-2', name: 'memory/log.md', owner: 'agent' }),
    );
    await createWorkspaceFile(makeWorkspaceFile({ id: 'ws-3', name: 'skills.md' }));

    const skills = await listSkillFiles();
    expect(skills).toHaveLength(0);
  });
});

describe('getEnabledSkills', () => {
  it('returns enabled skills with parsed metadata', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-1',
        name: 'skills/test-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: true,
      }),
    );

    const skills = await getEnabledSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.metadata.name).toBe('Test Skill');
    expect(skills[0]!.metadata.description).toBe('A test skill for unit testing');
    expect(skills[0]!.file.name).toBe('skills/test-skill/SKILL.md');
  });

  it('excludes disabled skill files', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-1',
        name: 'skills/test-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: false,
      }),
    );

    const skills = await getEnabledSkills();
    expect(skills).toHaveLength(0);
  });

  it('excludes skill files with invalid frontmatter', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-1',
        name: 'skills/bad-skill/SKILL.md',
        content: INVALID_SKILL_CONTENT,
        enabled: true,
      }),
    );

    const skills = await getEnabledSkills();
    expect(skills).toHaveLength(0);
  });

  it('returns empty array when no skills exist', async () => {
    const skills = await getEnabledSkills();
    expect(skills).toHaveLength(0);
  });

  it('includes global skills in agent-scoped query', async () => {
    // Global skill (no agentId)
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-global',
        name: 'skills/global/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: true,
      }),
    );
    // Agent-scoped skill
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-agent',
        name: 'skills/agent/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: true,
        agentId: 'agent-1',
      }),
    );

    const skills = await getEnabledSkills('agent-1');
    expect(skills).toHaveLength(2);
    const names = skills.map(s => s.file.name).sort();
    expect(names).toEqual(['skills/agent/SKILL.md', 'skills/global/SKILL.md']);
  });

  it('agent-scoped override shadows global in getEnabledSkills', async () => {
    // Global skill — enabled
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-global',
        name: 'skills/shared/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: true,
      }),
    );
    // Agent override — disabled
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-override',
        name: 'skills/shared/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: false,
        agentId: 'agent-1',
      }),
    );

    const skills = await getEnabledSkills('agent-1');
    expect(skills).toHaveLength(0);
  });

  it('excludes skills with disableModelInvocation: true', async () => {
    const disabledContent = `---
name: Hidden Skill
description: Should not appear in system prompt
disable-model-invocation: true
---

Hidden skill content.
`;
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-hidden',
        name: 'skills/hidden/SKILL.md',
        content: disabledContent,
        enabled: true,
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-visible',
        name: 'skills/visible/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: true,
      }),
    );

    const skills = await getEnabledSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.metadata.name).toBe('Test Skill');
  });
});

describe('Bundled skill seeding', () => {
  it('seedPredefinedWorkspaceFiles creates bundled skills', async () => {
    await seedPredefinedWorkspaceFiles();
    // Seeded files are scoped to 'main', so query with agentId
    const skills = await listSkillFiles('main');
    expect(skills.length).toBeGreaterThanOrEqual(1);

    const names = skills.map(s => s.name);
    expect(names).toContain('skills/daily-journal/SKILL.md');
  });

  it('bundled skills have valid frontmatter', async () => {
    await seedPredefinedWorkspaceFiles();
    const skills = await listSkillFiles('main');

    // Should have at least the 1 bundled skill
    expect(skills.length).toBeGreaterThanOrEqual(1);

    for (const skill of skills) {
      const meta = parseSkillFrontmatter(skill.content);
      expect(meta).not.toBeNull();
      expect(meta!.name).toBeTruthy();
      expect(meta!.description).toBeTruthy();
    }
  });

  it('seeding is idempotent for skill files', async () => {
    await seedPredefinedWorkspaceFiles();
    const first = await listSkillFiles('main');
    await seedPredefinedWorkspaceFiles();
    const second = await listSkillFiles('main');
    expect(second.length).toBe(first.length);
  });
});

describe('listSkillFiles with agentId', () => {
  it('returns only skills for the specified agent', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-agent1',
        name: 'skills/greeting/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-1',
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-agent2',
        name: 'skills/farewell/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-2',
      }),
    );

    const agent1Skills = await listSkillFiles('agent-1');
    expect(agent1Skills).toHaveLength(1);
    expect(agent1Skills[0]!.name).toBe('skills/greeting/SKILL.md');

    const agent2Skills = await listSkillFiles('agent-2');
    expect(agent2Skills).toHaveLength(1);
    expect(agent2Skills[0]!.name).toBe('skills/farewell/SKILL.md');
  });

  it('returns only global (unscoped) skills when no agentId provided', async () => {
    // Global skill (no agentId)
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-global',
        name: 'skills/shared/SKILL.md',
        content: VALID_SKILL_CONTENT,
      }),
    );
    // Agent-scoped skills should NOT appear
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-a1',
        name: 'skills/greeting/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-1',
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-a2',
        name: 'skills/farewell/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-2',
      }),
    );

    const allSkills = await listSkillFiles();
    expect(allSkills).toHaveLength(1);
    expect(allSkills[0]!.name).toBe('skills/shared/SKILL.md');
  });

  it('includes global skills (no agentId) in agent-scoped queries', async () => {
    // Global skill (no agentId)
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-global',
        name: 'skills/global-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
      }),
    );
    // Agent-scoped skill
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-agent1',
        name: 'skills/agent-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-1',
      }),
    );

    const agent1Skills = await listSkillFiles('agent-1');
    expect(agent1Skills).toHaveLength(2);
    const names = agent1Skills.map(s => s.name).sort();
    expect(names).toEqual(['skills/agent-skill/SKILL.md', 'skills/global-skill/SKILL.md']);
  });

  it('returns global skills for agent with no scoped skills', async () => {
    // Only global skill exists (no agentId)
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-global',
        name: 'skills/shared/SKILL.md',
        content: VALID_SKILL_CONTENT,
      }),
    );
    // Agent-1 has a scoped skill, agent-2 does not
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-other',
        name: 'skills/test/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-1',
      }),
    );

    const agent2Skills = await listSkillFiles('agent-2');
    expect(agent2Skills).toHaveLength(1);
    expect(agent2Skills[0]!.name).toBe('skills/shared/SKILL.md');
  });

  it('returns empty when agent has no skills and no globals exist', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-other',
        name: 'skills/test/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: 'agent-1',
      }),
    );

    const skills = await listSkillFiles('agent-2');
    expect(skills).toHaveLength(0);
  });

  it('agent-scoped override shadows global skill with same name', async () => {
    // Global skill
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-global',
        name: 'skills/my-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: true,
      }),
    );
    // Agent-scoped override with same name
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-agent',
        name: 'skills/my-skill/SKILL.md',
        content: VALID_SKILL_CONTENT,
        enabled: false,
        agentId: 'agent-1',
      }),
    );

    const skills = await listSkillFiles('agent-1');
    expect(skills).toHaveLength(1);
    // Should return the agent-scoped version, not the global
    expect(skills[0]!.id).toBe('sk-agent');
    expect(skills[0]!.enabled).toBe(false);
  });

  it('treats agentId empty string as global', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'sk-empty',
        name: 'skills/empty-agent/SKILL.md',
        content: VALID_SKILL_CONTENT,
        agentId: '',
      }),
    );

    // Should appear as global skill for any agent query
    const skills = await listSkillFiles('agent-1');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('skills/empty-agent/SKILL.md');
  });
});

describe('listToolScriptFiles', () => {
  it('returns workspace files matching given tool paths', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'tool-1',
        name: 'tools/search.js',
        content: '// search tool',
        agentId: 'agent-1',
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'tool-2',
        name: 'tools/fetch.js',
        content: '// fetch tool',
        agentId: 'agent-1',
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'other',
        name: 'AGENTS.md',
        content: 'agent config',
        agentId: 'agent-1',
      }),
    );

    const result = await listToolScriptFiles('agent-1', ['tools/search.js', 'tools/fetch.js']);
    expect(result).toHaveLength(2);
    const names = result.map(f => f.name).sort();
    expect(names).toEqual(['tools/fetch.js', 'tools/search.js']);
  });

  it('returns empty array when paths is empty', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'tool-1',
        name: 'tools/search.js',
        content: '// search tool',
        agentId: 'agent-1',
      }),
    );

    const result = await listToolScriptFiles('agent-1', []);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no files match', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'tool-1',
        name: 'tools/search.js',
        content: '// search tool',
        agentId: 'agent-1',
      }),
    );

    const result = await listToolScriptFiles('agent-1', ['tools/nonexistent.js']);
    expect(result).toHaveLength(0);
  });

  it('only returns files for the specified agent', async () => {
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'tool-a1',
        name: 'tools/search.js',
        content: '// search tool',
        agentId: 'agent-1',
      }),
    );
    await createWorkspaceFile(
      makeWorkspaceFile({
        id: 'tool-a2',
        name: 'tools/search.js',
        content: '// search tool v2',
        agentId: 'agent-2',
      }),
    );

    const result = await listToolScriptFiles('agent-1', ['tools/search.js']);
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe('agent-1');
  });
});
