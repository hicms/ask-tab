const DAILY_JOURNAL_SKILL = `---
name: Daily Journal
description: Maintain structured daily journal entries in agent memory
---

# Daily Journal

When asked to create or update a journal entry:

1. **Check existing entries** — use read to check if \`memory/YYYY-MM-DD.md\` exists for today
2. **Structure the entry** with these sections:
   - **Summary**: 1-2 sentence overview of the day's key events
   - **Decisions**: any decisions made during conversations
   - **Learnings**: new information or insights gained
   - **Action Items**: tasks identified but not yet completed
   - **Notes**: anything else worth remembering

3. **Write the entry** — use write to save to \`memory/YYYY-MM-DD.md\`
   - If appending to an existing entry, use mode: 'append'
   - If creating a new entry, use mode: 'overwrite'

## Guidelines

- Keep entries factual and concise
- Reference specific conversations or topics by name
- Update throughout the day rather than writing everything at once
- Link related entries when patterns emerge across days
`;

export { DAILY_JOURNAL_SKILL };
