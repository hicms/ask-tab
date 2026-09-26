import { executeWrite, executeRead, executeEdit, executeList } from './workspace';
import { chatDb } from '@storage-internal/chat-db';
import { listWorkspaceFiles, createWorkspaceFile } from '@storage-internal/chat-storage';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DbWorkspaceFile } from '@storage-internal/chat-db';

beforeEach(async () => {
  await chatDb.workspaceFiles.clear();
});

describe('write', () => {
  it('creates new agent memory file in memory/ namespace', async () => {
    const result = await executeWrite({
      path: 'memory/notes.md',
      content: 'Important note',
      mode: 'overwrite',
    });
    expect(result).toContain('Created memory/notes.md');
    expect(result).toContain('14 chars');
    const files = await listWorkspaceFiles();
    const created = files.find(f => f.name === 'memory/notes.md');
    expect(created).toBeDefined();
    expect(created!.content).toBe('Important note');
  });

  it('creates file outside memory/ namespace', async () => {
    const result = await executeWrite({
      path: 'notes/project.md',
      content: 'Project notes',
      mode: 'overwrite',
    });
    expect(result).toContain('Created notes/project.md');
    expect(result).toContain('13 chars');
    const files = await listWorkspaceFiles();
    const created = files.find(f => f.name === 'notes/project.md');
    expect(created).toBeDefined();
    expect(created!.content).toBe('Project notes');
  });

  it('appends to existing agent memory file', async () => {
    await executeWrite({
      path: 'memory/log.md',
      content: 'Line 1\n',
      mode: 'overwrite',
    });
    await executeWrite({
      path: 'memory/log.md',
      content: 'Line 2\n',
      mode: 'append',
    });
    const files = await listWorkspaceFiles();
    const file = files.find(f => f.name === 'memory/log.md');
    expect(file!.content).toBe('Line 1\nLine 2\n');
  });

  it('append adds newline separator when existing content lacks trailing newline', async () => {
    await executeWrite({
      path: 'memory/sep.md',
      content: 'Line 1',
      mode: 'overwrite',
    });
    await executeWrite({
      path: 'memory/sep.md',
      content: 'Line 2',
      mode: 'append',
    });
    const files = await listWorkspaceFiles();
    const file = files.find(f => f.name === 'memory/sep.md');
    expect(file!.content).toBe('Line 1\nLine 2');
  });

  it('overwrites existing agent memory file', async () => {
    await executeWrite({
      path: 'memory/data.md',
      content: 'Old content',
      mode: 'overwrite',
    });
    await executeWrite({
      path: 'memory/data.md',
      content: 'New content',
      mode: 'overwrite',
    });
    const files = await listWorkspaceFiles();
    const file = files.find(f => f.name === 'memory/data.md');
    expect(file!.content).toBe('New content');
  });

  it('sets owner to agent on created files', async () => {
    await executeWrite({
      path: 'memory/test.md',
      content: 'Test',
      mode: 'overwrite',
    });
    const files = await listWorkspaceFiles();
    const file = files.find(f => f.name === 'memory/test.md');
    expect(file!.owner).toBe('agent');
  });

  it('returns char count in update response', async () => {
    await executeWrite({
      path: 'memory/count.md',
      content: 'Hello',
      mode: 'overwrite',
    });
    const result = await executeWrite({
      path: 'memory/count.md',
      content: 'Hello World',
      mode: 'overwrite',
    });
    expect(result).toContain('Updated memory/count.md');
    expect(result).toContain('overwrite');
    expect(result).toContain('11 chars');
  });
});

describe('read', () => {
  it('reads existing workspace file by name', async () => {
    const now = Date.now();
    const file: DbWorkspaceFile = {
      id: 'ws-read-1',
      name: 'USER.md',
      content: 'My name is Bob',
      enabled: true,
      owner: 'user',
      predefined: true,
      createdAt: now,
      updatedAt: now,
      agentId: 'main',
    };
    await createWorkspaceFile(file);
    const result = await executeRead({ path: 'USER.md' });
    expect(result).toBe('My name is Bob');
  });

  it('returns error for non-existent file', async () => {
    const result = await executeRead({ path: 'nonexistent.md' });
    expect(result).toContain('File not found');
  });

  it('reads both user and agent files', async () => {
    const now = Date.now();
    await createWorkspaceFile({
      id: 'ws-u1',
      name: 'USER.md',
      content: 'User data',
      enabled: true,
      owner: 'user',
      predefined: true,
      createdAt: now,
      updatedAt: now,
      agentId: 'main',
    });
    await createWorkspaceFile({
      id: 'ws-a1',
      name: 'memory/agent.md',
      content: 'Agent data',
      enabled: true,
      owner: 'agent',
      predefined: false,
      createdAt: now,
      updatedAt: now,
      agentId: 'main',
    });
    expect(await executeRead({ path: 'USER.md' })).toBe('User data');
    expect(await executeRead({ path: 'memory/agent.md' })).toBe('Agent data');
  });
});

describe('edit', () => {
  it('performs successful edit with unique match', async () => {
    await executeWrite({
      path: 'memory/edit-test.md',
      content: 'Hello world, this is a test.',
      mode: 'overwrite',
    });
    const result = await executeEdit({
      path: 'memory/edit-test.md',
      oldText: 'Hello world',
      newText: 'Goodbye world',
    });
    expect(result).toContain('Edited memory/edit-test.md');
    expect(result).toContain('chars');
    const files = await listWorkspaceFiles();
    const file = files.find(f => f.name === 'memory/edit-test.md');
    expect(file!.content).toBe('Goodbye world, this is a test.');
  });

  it('rejects when oldText is empty string', async () => {
    await executeWrite({
      path: 'memory/edit-empty.md',
      content: 'Some content',
      mode: 'overwrite',
    });
    const result = await executeEdit({
      path: 'memory/edit-empty.md',
      oldText: '',
      newText: 'should not work',
    });
    expect(result).toContain('Error');
    expect(result).toContain('oldText must not be empty');
    // Verify file was not mutated
    const files = await listWorkspaceFiles();
    const file = files.find(f => f.name === 'memory/edit-empty.md');
    expect(file!.content).toBe('Some content');
  });

  it('rejects when oldText not found', async () => {
    await executeWrite({
      path: 'memory/edit-nf.md',
      content: 'Some content here.',
      mode: 'overwrite',
    });
    const result = await executeEdit({
      path: 'memory/edit-nf.md',
      oldText: 'nonexistent text',
      newText: 'replacement',
    });
    expect(result).toContain('Error');
    expect(result).toContain('Text not found');
  });

  it('rejects when multiple matches found', async () => {
    await executeWrite({
      path: 'memory/edit-dup.md',
      content: 'foo bar foo baz foo',
      mode: 'overwrite',
    });
    const result = await executeEdit({
      path: 'memory/edit-dup.md',
      oldText: 'foo',
      newText: 'qux',
    });
    expect(result).toContain('Error');
    expect(result).toContain('3 matches');
  });

  it('rejects no-op when oldText === newText', async () => {
    await executeWrite({
      path: 'memory/edit-noop.md',
      content: 'No changes needed.',
      mode: 'overwrite',
    });
    const result = await executeEdit({
      path: 'memory/edit-noop.md',
      oldText: 'No changes',
      newText: 'No changes',
    });
    expect(result).toContain('Error');
    expect(result).toContain('identical');
  });

  it('returns error for non-existent file', async () => {
    const result = await executeEdit({
      path: 'memory/ghost.md',
      oldText: 'hello',
      newText: 'world',
    });
    expect(result).toContain('Error');
    expect(result).toContain('File not found');
  });

  it('returns error for empty file', async () => {
    const now = Date.now();
    await createWorkspaceFile({
      id: 'ws-empty',
      name: 'memory/empty.md',
      content: '',
      enabled: true,
      owner: 'agent',
      predefined: false,
      createdAt: now,
      updatedAt: now,
      agentId: undefined,
    });
    const result = await executeEdit({
      path: 'memory/empty.md',
      oldText: 'hello',
      newText: 'world',
    });
    expect(result).toContain('Error');
    expect(result).toContain('empty');
  });
});

describe('list', () => {
  it('lists all workspace files with name, owner, enabled', async () => {
    const now = Date.now();
    await createWorkspaceFile({
      id: 'ws-l1',
      name: 'USER.md',
      content: 'data',
      enabled: true,
      owner: 'user',
      predefined: true,
      createdAt: now,
      updatedAt: now,
      agentId: 'main',
    });
    await createWorkspaceFile({
      id: 'ws-l2',
      name: 'memory/notes.md',
      content: 'notes',
      enabled: false,
      owner: 'agent',
      predefined: false,
      createdAt: now,
      updatedAt: now,
      agentId: 'main',
    });
    const result = await executeList();
    expect(result).toContain('USER.md');
    expect(result).toContain('owner: user');
    expect(result).toContain('enabled: true');
    expect(result).toContain('memory/notes.md');
    expect(result).toContain('owner: agent');
    expect(result).toContain('enabled: false');
  });

  it('returns message when no files exist', async () => {
    const result = await executeList();
    expect(result).toContain('No workspace files found');
  });
});
