import { parseSkillFrontmatter, isSkillFile } from './skill-parser.js';
import { describe, expect, it } from 'vitest';

describe('parseSkillFrontmatter', () => {
  it('parses valid frontmatter with all fields', () => {
    const content = `---
name: Web Research
description: Multi-step web research skill
disable-model-invocation: true
user-invocable: false
---

# Web Research Skill

Do stuff here.`;

    const result = parseSkillFrontmatter(content);
    expect(result).toEqual({
      name: 'Web Research',
      description: 'Multi-step web research skill',
      disableModelInvocation: true,
      userInvocable: false,
    });
  });

  it('returns defaults for missing optional fields', () => {
    const content = `---
name: Summarize
description: Summarize content
---

Body text.`;

    const result = parseSkillFrontmatter(content);
    expect(result).toEqual({
      name: 'Summarize',
      description: 'Summarize content',
      disableModelInvocation: false,
      userInvocable: true,
    });
  });

  it('returns null for content without frontmatter', () => {
    const content = `# Just a markdown file

No frontmatter here.`;

    expect(parseSkillFrontmatter(content)).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseSkillFrontmatter('')).toBeNull();
  });

  it('returns null when name is missing', () => {
    const content = `---
description: Some description
---

Body.`;

    expect(parseSkillFrontmatter(content)).toBeNull();
  });

  it('returns null when description is missing', () => {
    const content = `---
name: Test Skill
---

Body.`;

    expect(parseSkillFrontmatter(content)).toBeNull();
  });

  it('parses boolean values correctly (true/false/yes/no)', () => {
    const testCases = [
      { value: 'true', expected: true },
      { value: 'false', expected: false },
      { value: 'yes', expected: true },
      { value: 'no', expected: false },
      { value: 'True', expected: true },
      { value: 'Yes', expected: true },
    ];

    for (const tc of testCases) {
      const content = `---
name: Test
description: Test desc
disable-model-invocation: ${tc.value}
---`;

      const result = parseSkillFrontmatter(content);
      expect(result?.disableModelInvocation, `value "${tc.value}" should be ${tc.expected}`).toBe(
        tc.expected,
      );
    }
  });

  it('ignores unknown frontmatter fields', () => {
    const content = `---
name: My Skill
description: Does things
unknown-field: whatever
another: value
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).toEqual({
      name: 'My Skill',
      description: 'Does things',
      disableModelInvocation: false,
      userInvocable: true,
    });
  });

  it('handles multiline descriptions', () => {
    const content = `---
name: Complex Skill
description: This is a
  multiline description
  that spans several lines
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Complex Skill');
    expect(result!.description).toContain('multiline description');
  });
});

describe('isSkillFile', () => {
  it('returns true for skills/my-skill/SKILL.md', () => {
    expect(isSkillFile('skills/my-skill/SKILL.md')).toBe(true);
  });

  it('returns false for AGENTS.md', () => {
    expect(isSkillFile('AGENTS.md')).toBe(false);
  });

  it('returns false for memory/notes.md', () => {
    expect(isSkillFile('memory/notes.md')).toBe(false);
  });

  it('returns false for skills.md (no subdirectory)', () => {
    expect(isSkillFile('skills.md')).toBe(false);
  });

  it('returns false for skills/SKILL.md (no skill name)', () => {
    expect(isSkillFile('skills/SKILL.md')).toBe(false);
  });

  it('case-insensitive matching', () => {
    expect(isSkillFile('Skills/My-Skill/SKILL.md')).toBe(true);
    expect(isSkillFile('SKILLS/MY-SKILL/SKILL.MD')).toBe(true);
    expect(isSkillFile('skills/web-research/skill.md')).toBe(true);
  });
});
