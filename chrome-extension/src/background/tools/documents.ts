import { Type } from '@sinclair/typebox';
import type { ToolRegistration, ToolResult } from './tool-registration';
import type { Static } from '@sinclair/typebox';

const createDocumentSchema = Type.Object({
  title: Type.String({ description: 'Title of the document' }),
  kind: Type.Union(
    [Type.Literal('text'), Type.Literal('code'), Type.Literal('sheet'), Type.Literal('image')],
    { description: 'The kind of document to create: text, code, sheet, or image' },
  ),
  content: Type.String({ description: 'The full document content' }),
});

type CreateDocumentArgs = Static<typeof createDocumentSchema>;

/**
 * Create document returns metadata + content for storage.
 */
const executeCreateDocument = async (
  args: CreateDocumentArgs,
): Promise<{ id: string; title: string; kind: string; content: string }> => {
  const { nanoid } = await import('nanoid');
  return {
    id: nanoid(),
    title: args.title,
    kind: args.kind,
    content: args.content,
  };
};

// ── Tool registration ──

const createDocumentToolDef: ToolRegistration = {
  name: 'create_document',
  label: 'Create Document',
  description:
    'Create a document to share with the user. Include the complete content in the `content` parameter. Use this for substantial content like articles, code, analysis, or structured data. Specify the title, kind (text, code, sheet, or image), and content.',
  schema: createDocumentSchema,
  execute: args => executeCreateDocument(args as CreateDocumentArgs),
  formatResult: (raw): ToolResult => {
    const result = raw as { id: string; title: string; kind: string; content: string };
    const { content: _content, ...metadata } = result;
    return { content: [{ type: 'text', text: JSON.stringify(metadata) }], details: result };
  },
};

export { createDocumentSchema, executeCreateDocument, createDocumentToolDef };
export type { CreateDocumentArgs };
