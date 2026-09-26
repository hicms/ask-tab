/**
 * Sheet (spreadsheet / CSV) document handler.
 *
 * Ported from ai-chatbot `artifacts/sheet/server.ts`.
 * The `streamObject()` AI SDK call has been replaced with a stub that can
 * be wired to the background worker via Chrome port messaging later.
 */

import { createDocumentHandler } from './handler';
import type { CreateDocumentCallbackProps, UpdateDocumentCallbackProps } from './handler';

/**
 * Stub for streaming CSV/sheet generation.
 *
 * In the ai-chatbot reference this calls the AI SDK's `streamObject()`.
 * Here we provide a no-op placeholder.  To integrate with the background
 * worker, send a message over a Chrome port and pipe the returned stream
 * deltas into `dataStream.write()`.
 */
async function streamSheetStub(
  _params: { prompt: string; existingContent?: string },
  dataStream: CreateDocumentCallbackProps['dataStream'],
): Promise<string> {
  // TODO: Wire to background worker via Chrome port messaging.
  // When integrated, iterate over streamed deltas like:
  //
  //   for await (const delta of fullStream) {
  //     if (delta.type === 'object') {
  //       const { csv } = delta.object;
  //       if (csv) {
  //         dataStream.write({ type: 'data-sheetDelta', data: csv, transient: true });
  //         draftContent = csv;
  //       }
  //     }
  //   }
  //
  void dataStream;
  return '';
}

export const sheetDocumentHandler = createDocumentHandler<'sheet'>({
  kind: 'sheet',
  onCreateDocument: async ({ title, dataStream }: CreateDocumentCallbackProps) =>
    streamSheetStub({ prompt: title }, dataStream),
  onUpdateDocument: async ({ document, description, dataStream }: UpdateDocumentCallbackProps) =>
    streamSheetStub({ prompt: description, existingContent: document.content }, dataStream),
});
