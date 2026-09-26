/**
 * Artifact actions — client-side stubs.
 *
 * Ported from ai-chatbot `artifacts/actions.ts`.
 * The original used a Next.js server action to query a Postgres DB.
 * This version queries IndexedDB via `@extension/storage` instead.
 */

import { getArtifactById } from '@extension/storage';

type Suggestion = {
  id: string;
  documentId: string;
  originalText: string;
  suggestedText: string;
  description?: string;
  createdAt: number;
};

/**
 * Retrieve suggestions for a given document/artifact.
 *
 * In the ai-chatbot reference this was a server action querying
 * `getSuggestionsByDocumentId()`.  Since the extension does not yet persist
 * suggestions, this returns an empty array.  When suggestion storage is
 * implemented, query IndexedDB here.
 */
export async function getSuggestions({
  documentId,
}: {
  documentId: string;
}): Promise<Suggestion[]> {
  // Verify the artifact exists (side-effect: warms the cache).
  const _artifact = await getArtifactById(documentId);
  void _artifact;

  // TODO: Implement suggestion storage in IndexedDB and query here.
  return [];
}
