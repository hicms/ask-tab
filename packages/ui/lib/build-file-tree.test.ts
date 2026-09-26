import { buildFileTree } from './build-file-tree';
import { describe, it, expect } from 'vitest';
import type { FileTreeNode } from './build-file-tree';
import type { DbWorkspaceFile } from '@extension/storage';

const makeFile = (name: string, overrides: Partial<DbWorkspaceFile> = {}): DbWorkspaceFile => ({
  id: `id-${name}`,
  name,
  content: `content of ${name}`,
  enabled: true,
  owner: 'user',
  predefined: false,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('buildFileTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('returns file nodes sorted alphabetically for flat files', () => {
    const files = [makeFile('TOOLS.md'), makeFile('AGENTS.md'), makeFile('MEMORY.md')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(3);
    expect(tree.every(n => n.type === 'file')).toBe(true);
    expect(tree.map(n => n.name)).toEqual(['AGENTS.md', 'MEMORY.md', 'TOOLS.md']);
  });

  it('creates folder chain for single nested file', () => {
    const files = [makeFile('skills/web-research/SKILL.md')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    const skills = tree[0] as Extract<FileTreeNode, { type: 'folder' }>;
    expect(skills.type).toBe('folder');
    expect(skills.name).toBe('skills');
    expect(skills.path).toBe('skills');

    expect(skills.children).toHaveLength(1);
    const webResearch = skills.children[0] as Extract<FileTreeNode, { type: 'folder' }>;
    expect(webResearch.type).toBe('folder');
    expect(webResearch.name).toBe('web-research');
    expect(webResearch.path).toBe('skills/web-research');

    expect(webResearch.children).toHaveLength(1);
    const file = webResearch.children[0] as Extract<FileTreeNode, { type: 'file' }>;
    expect(file.type).toBe('file');
    expect(file.name).toBe('SKILL.md');
    expect(file.path).toBe('skills/web-research/SKILL.md');
  });

  it('sorts folders first then files at each level', () => {
    const files = [
      makeFile('AGENTS.md'),
      makeFile('skills/summarize/SKILL.md'),
      makeFile('TOOLS.md'),
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(3);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('skills');
    expect(tree[1].type).toBe('file');
    expect(tree[1].name).toBe('AGENTS.md');
    expect(tree[2].type).toBe('file');
    expect(tree[2].name).toBe('TOOLS.md');
  });

  it('groups multiple files in same folder under one folder node', () => {
    const files = [
      makeFile('skills/web-research/SKILL.md'),
      makeFile('skills/summarize/SKILL.md'),
      makeFile('skills/journal/SKILL.md'),
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    const skills = tree[0] as Extract<FileTreeNode, { type: 'folder' }>;
    expect(skills.type).toBe('folder');
    expect(skills.children).toHaveLength(3);
    // Sub-folders sorted alphabetically
    expect(skills.children.map(n => n.name)).toEqual(['journal', 'summarize', 'web-research']);
  });

  it('handles deep nesting (a/b/c/d.md) with 3 folder levels', () => {
    const files = [makeFile('a/b/c/d.md')];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(1);
    const a = tree[0] as Extract<FileTreeNode, { type: 'folder' }>;
    expect(a.name).toBe('a');

    const b = a.children[0] as Extract<FileTreeNode, { type: 'folder' }>;
    expect(b.name).toBe('b');

    const c = b.children[0] as Extract<FileTreeNode, { type: 'folder' }>;
    expect(c.name).toBe('c');

    const d = c.children[0] as Extract<FileTreeNode, { type: 'file' }>;
    expect(d.type).toBe('file');
    expect(d.name).toBe('d.md');
  });

  it('skips files with undefined name without crashing', () => {
    const files = [
      makeFile('AGENTS.md'),
      {
        id: 'bad',
        content: '',
        enabled: true,
        owner: 'user',
        predefined: false,
        createdAt: 0,
        updatedAt: 0,
      } as DbWorkspaceFile,
      makeFile('TOOLS.md'),
    ];
    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    expect(tree.map(n => n.name)).toEqual(['AGENTS.md', 'TOOLS.md']);
  });

  it('preserves DbWorkspaceFile reference on leaf nodes', () => {
    const original = makeFile('notes.md', { id: 'my-special-id', enabled: false });
    const tree = buildFileTree([original]);

    const node = tree[0] as Extract<FileTreeNode, { type: 'file' }>;
    expect(node.file).toBe(original);
    expect(node.file.id).toBe('my-special-id');
    expect(node.file.enabled).toBe(false);
  });
});
