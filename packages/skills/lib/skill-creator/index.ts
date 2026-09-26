const SKILL_CREATOR_SKILL = `---
name: Skill Creator
description: Create or update AskTab skills. Use when the user wants to design,
  build, edit, or improve a skill, or when asked to make a reusable prompt template
  for a specific task or domain.
---

# Skill Creator

Guide for creating effective AskTab skills.

## What Skills Are

Skills are single SKILL.md files stored in the workspace that extend the assistant with
specialized instructions for specific tasks. They encode procedural knowledge, workflows,
and conventions that no model inherently possesses.

### How Skills Work (3-level loading)

1. **Metadata** (always in context) — \`name\` and \`description\` from frontmatter appear in
   the system prompt. This is the ONLY thing visible before triggering.
2. **Full SKILL.md** (on trigger) — When a request matches the description, the assistant
   reads the full file via \`read\`. Instructions are followed from this point.
3. **Workspace references** (on demand) — The body can instruct the assistant to read
   additional workspace files for large or conditional content.

### Skill File Format

Path pattern: \`skills/{kebab-case-name}/SKILL.md\`

\`\`\`
---
name: Display Name
description: What this skill does and WHEN to use it
disable-model-invocation: false   # optional, default false
user-invocable: true              # optional, default true
---

# Skill Title

Instructions for the assistant here.
\`\`\`

Required frontmatter:
- **name** — Display name shown in skill list and system prompt
- **description** — Primary trigger mechanism. Must describe WHAT the skill does AND WHEN to
  use it. This is the only text visible before the skill is loaded.

Optional frontmatter:
- **disable-model-invocation** — If true, skill is hidden from the system prompt
- **user-invocable** — If false, users cannot invoke the skill from the UI

## Core Principles

### Conciseness

The context window is shared with conversation history, other skills, and the user's request.
The assistant is already smart — only include information it does not already have.

- Challenge each paragraph: "Does this justify its token cost?"
- Prefer concise examples over verbose explanations
- Keep SKILL.md under 300 lines

### Description Is Everything

The \`description\` is the SOLE trigger mechanism. The body is only loaded AFTER matching.
Include both what the skill does AND specific triggers:

Bad: \`description: Helps with documents\`
Good: \`description: Create, edit, and format reports. Use when the user asks to write a report, draft a summary, or format structured text.\`

### Degrees of Freedom

Match specificity to the task:
- **High freedom** (text guidance) — many valid approaches
- **Medium freedom** (examples/pseudocode) — preferred pattern exists
- **Low freedom** (exact steps) — consistency critical, operations fragile

## Creation Process

### Step 1: Understand

Ask the user:
- What should this skill do? Give example requests.
- What triggers should activate it?
- Any specific conventions or constraints?

Skip only when the purpose is already clear. Keep questions minimal.

### Step 2: Plan

Analyze examples to identify:
- Instructions the assistant needs that it would not already know
- Whether additional workspace reference files are needed for large content
- The appropriate degree of freedom for each workflow step

### Step 3: Create

Write the SKILL.md using the \`write\` tool:

\`\`\`
write({ path: "skills/{name}/SKILL.md", content: "...", mode: "overwrite" })
\`\`\`

#### Naming

- Lowercase letters, digits, and hyphens only
- Under 64 characters
- Prefer short, verb-led phrases: \`create-report\`, \`analyze-data\`, \`format-email\`
- Normalize user titles to kebab-case: "Plan Mode" → \`plan-mode\`

#### Frontmatter

Write \`name\` and \`description\`. Put ALL "when to use" info in \`description\` — not in the body.

#### Body

Use imperative form. Include:
- Core workflow steps
- Non-obvious conventions or constraints
- Concise examples where helpful

#### Splitting Large Content

If extensive reference material is needed, keep SKILL.md lean and store details separately:

\`\`\`
write({ path: "skills/{name}/references/schema.md", content: "...", mode: "overwrite" })
\`\`\`

Reference from the body: "For schema details, read \`skills/{name}/references/schema.md\`."

Note: Only files matching \`skills/{name}/SKILL.md\` are recognized as skills. Reference files
are plain workspace files the skill instructs the assistant to read on demand.

### Step 4: Iterate

After the user tests the skill:
1. Identify what worked and what did not
2. Use \`write\` (mode: overwrite) to update the SKILL.md
3. Test again

## What NOT to Include

- README, CHANGELOG, or auxiliary documentation
- Setup or installation instructions
- Information the assistant already knows (general coding, common formats)
- "When to Use" sections in the body — put this in \`description\`
`;

export { SKILL_CREATOR_SKILL };
