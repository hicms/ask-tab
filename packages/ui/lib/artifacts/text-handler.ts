/**
 * Text document handler.
 *
 * Ported from ai-chatbot `artifacts/text/server.ts`.
 * The `streamText()` AI SDK call has been replaced with a stub that can be
 * wired to the background worker via Chrome port messaging later.
 */

import { createDocumentHandler } from './handler';
import type { CreateDocumentCallbackProps, UpdateDocumentCallbackProps } from './handler';

/**
 * Stub for streaming text generation.
 *
 * In the ai-chatbot reference this calls the AI SDK's `streamText()`.
 * Here we provide a no-op placeholder.  To integrate with the background
 * worker, send a message over a Chrome port and pipe the returned stream
 * deltas into `dataStream.write()`.
 */
async function streamTextStub(
  _params: { prompt: string; existingContent?: string },
  dataStream: CreateDocumentCallbackProps['dataStream'],
): Promise<string> {
  // TODO: Wire to background worker via Chrome port messaging.
  // For now this is a pass-through stub that returns an empty string.
  // When integrated, iterate over streamed deltas like:
  //
  //   for await (const delta of fullStream) {
  //     if (delta.type === 'text-delta') {
  //       draftContent += delta.text;
  //       dataStream.write({ type: 'data-textDelta', data: delta.text, transient: true });
  //     }
  //   }
  //
  void dataStream;
  return '';
}

export const textDocumentHandler = createDocumentHandler<'text'>({
  kind: 'text',
  onCreateDocument: async ({ title, dataStream }: CreateDocumentCallbackProps) =>
    streamTextStub({ prompt: title }, dataStream),
  onUpdateDocument: async ({ document, description, dataStream }: UpdateDocumentCallbackProps) =>
    streamTextStub({ prompt: description, existingContent: document.content }, dataStream),
});
