/**
 * Artifact handler framework.
 *
 * Ported from ai-chatbot `lib/artifacts/server.ts`.
 * Adapted for client-side usage in the extension: DB calls go through
 * `@extension/storage` (IndexedDB) instead of a server-side DB, and the
 * streaming/session concepts are replaced with stubs that can be wired to
 * the background worker via Chrome port messaging later.
 */

import { saveArtifact } from '@extension/storage';
import type { ArtifactKind } from '../artifact-types';

// ── Types ────────────────────────────────────────

export type SaveDocumentProps = {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  chatId: string;
};

/**
 * Callback context passed when a new artifact document is created.
 * `dataStream` is a lightweight writer stub — in the future this will be
 * backed by a Chrome port to the background worker.
 */
export type CreateDocumentCallbackProps = {
  id: string;
  title: string;
  chatId: string;
  dataStream: ArtifactDataStreamWriter;
};

/**
 * Callback context passed when an existing artifact is updated.
 */
export type UpdateDocumentCallbackProps = {
  document: { id: string; title: string; content: string; kind: ArtifactKind };
  description: string;
  chatId: string;
  dataStream: ArtifactDataStreamWriter;
};

/**
 * Minimal stream writer interface that mirrors the shape used in the
 * ai-chatbot's `UIMessageStreamWriter`.  Handlers call `.write()` to
 * push deltas to the UI; the actual transport is pluggable.
 */
export type ArtifactDataStreamWriter = {
  write: (part: { type: string; data: unknown; transient?: boolean }) => void;
};

export type DocumentHandler<T = ArtifactKind> = {
  kind: T;
  onCreateDocument: (args: CreateDocumentCallbackProps) => Promise<void>;
  onUpdateDocument: (args: UpdateDocumentCallbackProps) => Promise<void>;
};

// ── Factory ──────────────────────────────────────

/**
 * Create a document handler that automatically persists the artifact content
 * to IndexedDB after the handler's create/update callback resolves.
 */
export function createDocumentHandler<T extends ArtifactKind>(config: {
  kind: T;
  onCreateDocument: (params: CreateDocumentCallbackProps) => Promise<string>;
  onUpdateDocument: (params: UpdateDocumentCallbackProps) => Promise<string>;
}): DocumentHandler<T> {
  return {
    kind: config.kind,
    onCreateDocument: async (args: CreateDocumentCallbackProps) => {
      const draftContent = await config.onCreateDocument({
        id: args.id,
        title: args.title,
        chatId: args.chatId,
        dataStream: args.dataStream,
      });

      await saveArtifact({
        id: args.id,
        chatId: args.chatId,
        title: args.title,
        content: draftContent,
        kind: config.kind,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    },
    onUpdateDocument: async (args: UpdateDocumentCallbackProps) => {
      const draftContent = await config.onUpdateDocument({
        document: args.document,
        description: args.description,
        chatId: args.chatId,
        dataStream: args.dataStream,
      });

      await saveArtifact({
        id: args.document.id,
        chatId: args.chatId,
        title: args.document.title,
        content: draftContent,
        kind: config.kind,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    },
  };
}

export const artifactKinds = ['text', 'code', 'sheet', 'image'] as const;
