// Artifact system — barrel exports
//
// Register artifact definitions here. Each definition is an instance of the
// Artifact class from `../components/create-artifact` that describes a kind
// of artifact (text, code, image, sheet, etc.) along with its editor
// component, toolbar items, and actions.

// ── Client-side artifact UI definitions ──────────

import { codeArtifact } from './code-artifact';
// ── Handler imports (for the registry) ───────────
import { codeDocumentHandler } from './code-handler';
import { imageArtifact } from './image-artifact';
import { sheetArtifact } from './sheet-artifact';
import { sheetDocumentHandler } from './sheet-handler';
import { textArtifact } from './text-artifact';
import { textDocumentHandler } from './text-handler';
import type { DocumentHandler } from './handler';

/** The global registry of artifact kind definitions (UI). */
export const artifactDefinitions = [textArtifact, codeArtifact, sheetArtifact, imageArtifact];

/**
 * Global registry of document handlers keyed by artifact kind.
 * Each handler knows how to create/update an artifact of a given kind
 * and persist it to IndexedDB.
 */
export const documentHandlersByArtifactKind: DocumentHandler[] = [
  textDocumentHandler,
  codeDocumentHandler,
  sheetDocumentHandler,
];

// ── Re-exports ───────────────────────────────────
export { textArtifact } from './text-artifact';
export { codeArtifact } from './code-artifact';
export { sheetArtifact } from './sheet-artifact';
export { imageArtifact } from './image-artifact';

// Handler framework
export { createDocumentHandler, artifactKinds } from './handler';
export type {
  SaveDocumentProps,
  CreateDocumentCallbackProps,
  UpdateDocumentCallbackProps,
  ArtifactDataStreamWriter,
  DocumentHandler,
} from './handler';

// Individual handlers
export { textDocumentHandler } from './text-handler';
export { codeDocumentHandler } from './code-handler';
export { sheetDocumentHandler } from './sheet-handler';

// Actions
export { getSuggestions } from './actions';
