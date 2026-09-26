import { getActiveAgentId, getWorkspaceFile } from './tool-utils';
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  updateWorkspaceFile,
} from '@extension/storage';
import { Type } from '@sinclair/typebox';
import { nanoid } from 'nanoid';
import type { ToolRegistration } from './tool-registration';
import type { DbWorkspaceFile } from '@extension/storage';
import type { Static } from '@sinclair/typebox';

// ── write ────────────────────────────────────────

const writeSchema = Type.Object({
  path: Type.String({ description: 'File path within the workspace' }),
  content: Type.String({ description: 'Content to write to the file' }),
  mode: Type.Union([Type.Literal('overwrite'), Type.Literal('append')], {
    description: 'Write mode: overwrite replaces content, append adds to end',
  }),
});

type WriteArgs = Static<typeof writeSchema>;

const executeWrite = async (args: WriteArgs, agentIdOverride?: string): Promise<string> => {
  const { path, content, mode } = args;

  const agentId = agentIdOverride ?? (await getActiveAgentId());

  // Check if file already exists by name (scoped to agent)
  const existing = await getWorkspaceFile(path, agentId);

  if (existing) {
    const separator =
      mode === 'append' && existing.content && !existing.content.endsWith('\n') ? '\n' : '';
    const newContent = mode === 'append' ? existing.content + separator + content : content;
    await updateWorkspaceFile(existing.id, { content: newContent });
    return `Updated ${path} (${mode}, ${newContent.length} chars)`;
  }

  // Create new file
  const now = Date.now();
  const file: DbWorkspaceFile = {
    id: nanoid(),
    name: path,
    content,
    enabled: true,
    owner: 'agent',
    predefined: false,
    createdAt: now,
    updatedAt: now,
    agentId,
  };
  await createWorkspaceFile(file);
  return `Created ${path} (${content.length} chars)`;
};

// ── read ─────────────────────────────────────────

const readSchema = Type.Object({
  path: Type.String({ description: 'File name/path to read from the workspace' }),
});

type ReadArgs = Static<typeof readSchema>;

const executeRead = async (args: ReadArgs): Promise<string> => {
  const agentId = await getActiveAgentId();
  const file = await getWorkspaceFile(args.path, agentId);

  if (!file) {
    return `File not found: ${args.path}`;
  }

  return file.content || '(empty file)';
};

// ── edit ─────────────────────────────────────────

const editSchema = Type.Object({
  path: Type.String({ description: 'File path within the workspace' }),
  oldText: Type.String({ description: 'Exact text to find (must be unique in the file)' }),
  newText: Type.String({ description: 'Text to replace oldText with' }),
});

type EditArgs = Static<typeof editSchema>;

const executeEdit = async (args: EditArgs, agentIdOverride?: string): Promise<string> => {
  const { path, oldText, newText } = args;

  if (!oldText) return `Error: oldText must not be empty.`;

  const agentId = agentIdOverride ?? (await getActiveAgentId());
  const existing = await getWorkspaceFile(path, agentId);

  if (!existing) return `Error: File not found: ${path}`;
  if (!existing.content) return `Error: File is empty: ${path}`;

  // Uniqueness check
  const occurrences = existing.content.split(oldText).length - 1;
  if (occurrences === 0) return `Error: Text not found in ${path}. The oldText must match exactly.`;
  if (occurrences > 1)
    return `Error: Found ${occurrences} matches in ${path}. Provide more context to make oldText unique.`;

  // No-op check
  if (oldText === newText) return `Error: oldText and newText are identical. No changes made.`;

  const newContent = existing.content.replace(oldText, newText);
  await updateWorkspaceFile(existing.id, { content: newContent });
  return `Edited ${path} (${newContent.length} chars)`;
};

// ── list ─────────────────────────────────────────

const listSchema = Type.Object({});

const executeList = async (): Promise<string> => {
  const agentId = await getActiveAgentId();
  const files = await listWorkspaceFiles(agentId);
  if (files.length === 0) {
    return 'No workspace files found.';
  }

  const lines = files.map(f => `- ${f.name} (owner: ${f.owner}, enabled: ${f.enabled})`);
  return lines.join('\n');
};

// ── delete ───────────────────────────────────────

const deleteSchema = Type.Object({
  path: Type.String({ description: 'File path to delete from the workspace' }),
});

type DeleteArgs = Static<typeof deleteSchema>;

const executeDelete = async (args: DeleteArgs): Promise<string> => {
  const agentId = await getActiveAgentId();
  const file = await getWorkspaceFile(args.path, agentId);

  if (!file) {
    return `Error: File not found: ${args.path}`;
  }

  try {
    await deleteWorkspaceFile(file.id);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return `Deleted ${args.path}`;
};

// ── rename ───────────────────────────────────────

const renameSchema = Type.Object({
  path: Type.String({ description: 'Current file path in the workspace' }),
  newPath: Type.String({ description: 'New file path to rename/move to' }),
});

type RenameArgs = Static<typeof renameSchema>;

const executeRename = async (args: RenameArgs): Promise<string> => {
  const { path, newPath } = args;

  const agentId = await getActiveAgentId();
  const file = await getWorkspaceFile(path, agentId);

  if (!file) {
    return `Error: File not found: ${path}`;
  }

  if (file.predefined) {
    return `Error: Cannot rename predefined system files`;
  }

  // Check if newPath already exists
  const existing = await getWorkspaceFile(newPath, agentId);
  if (existing) {
    return `Error: A file already exists at ${newPath}`;
  }

  await updateWorkspaceFile(file.id, { name: newPath });
  return `Renamed ${path} → ${newPath}`;
};

// ── Tool registration ──

const workspaceToolDefs: ToolRegistration[] = [
  {
    name: 'write',
    label: 'Write',
    description:
      'Write content to a workspace file. Use this to save notes, memories, or context for future sessions (e.g. memory/notes.md, notes/project.md).',
    schema: writeSchema,
    execute: args => executeWrite(args as Parameters<typeof executeWrite>[0]),
  },
  {
    name: 'read',
    label: 'Read',
    description:
      'Read a workspace file by name. Use this to retrieve workspace context, user preferences, or previously saved notes.',
    schema: readSchema,
    execute: args => executeRead(args as Parameters<typeof executeRead>[0]),
  },
  {
    name: 'edit',
    label: 'Edit',
    description:
      'Edit a workspace file with find-and-replace. Finds an exact unique match of oldText and replaces it with newText.',
    schema: editSchema,
    execute: args => executeEdit(args as Parameters<typeof executeEdit>[0]),
  },
  {
    name: 'list',
    label: 'List',
    description: 'List all workspace files with their names, owners, and enabled status.',
    schema: listSchema,
    execute: () => executeList(),
  },
  {
    name: 'delete',
    label: 'Delete',
    description: 'Delete a workspace file by path. Cannot delete predefined system files.',
    schema: deleteSchema,
    execute: args => executeDelete(args as Parameters<typeof executeDelete>[0]),
  },
  {
    name: 'rename',
    label: 'Rename',
    description: 'Rename/move a workspace file to a new path.',
    schema: renameSchema,
    execute: args => executeRename(args as Parameters<typeof executeRename>[0]),
  },
];

export {
  writeSchema,
  readSchema,
  editSchema,
  listSchema,
  deleteSchema,
  renameSchema,
  executeWrite,
  executeRead,
  executeEdit,
  executeList,
  executeDelete,
  executeRename,
  workspaceToolDefs,
};
