/**
 * Skill file parser — parses YAML frontmatter from SKILL.md files.
 *
 * Skills are workspace files matching the pattern `skills/{name}/SKILL.md`.
 * Each has YAML frontmatter with `name`, `description`, and optional flags.
 */

interface SkillMetadata {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
}

const SKILL_FILE_PATTERN = /^skills\/[a-z0-9-]+\/SKILL\.md$/i;

/**
 * Check if a workspace file name matches the skill file pattern.
 * Pattern: `skills/{kebab-case-name}/SKILL.md`
 */
const isSkillFile = (name: string): boolean => SKILL_FILE_PATTERN.test(name);

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

const parseBooleanValue = (value: string): boolean => {
  const lower = value.trim().toLowerCase();
  return lower === 'true' || lower === 'yes';
};

/**
 * Parse YAML frontmatter from a SKILL.md file.
 *
 * Expects `---` delimited block at start of content with `name` and `description` fields.
 * Returns null if frontmatter is missing, invalid, or required fields are absent.
 */
const parseSkillFrontmatter = (content: string): SkillMetadata | null => {
  if (!content) return null;

  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;

  const yamlBlock = match[1];
  const fields: Record<string, string> = {};

  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (const line of yamlBlock.split('\n')) {
    const kvMatch = line.match(/^([a-z][a-z0-9-]*)\s*:\s*(.*)/i);
    if (kvMatch) {
      // Flush previous key
      if (currentKey) {
        fields[currentKey] = currentValue.join('\n').trim();
      }
      currentKey = kvMatch[1].toLowerCase();
      currentValue = [kvMatch[2]];
    } else if (currentKey && line.match(/^\s+/)) {
      // Continuation line for multiline values
      currentValue.push(line);
    }
  }
  // Flush last key
  if (currentKey) {
    fields[currentKey] = currentValue.join('\n').trim();
  }

  const name = fields['name'];
  const description = fields['description'];

  if (!name || !description) return null;

  return {
    name,
    description,
    disableModelInvocation: fields['disable-model-invocation']
      ? parseBooleanValue(fields['disable-model-invocation'])
      : false,
    userInvocable: fields['user-invocable'] ? parseBooleanValue(fields['user-invocable']) : true,
  };
};

export type { SkillMetadata };
export { isSkillFile, parseSkillFrontmatter };
