import type { DbWorkspaceFile } from '@extension/storage';

export type SkillWithMeta = {
  file: DbWorkspaceFile;
  displayName: string;
  description: string;
};

export const SKILL_TEMPLATE = `---
name: Untitled
description: Describe what this skill does
---

# Skill Instructions

Write your instructions for the LLM here.
`;

export const getSkillDisplayName = (name: string): string => {
  const match = name.match(/^skills\/([^/]+)\/SKILL\.md$/i);
  return match ? match[1] : name;
};
