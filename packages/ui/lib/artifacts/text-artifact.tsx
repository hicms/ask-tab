/**
 * Text artifact definition.
 *
 * Ported from ai-chatbot `artifacts/text/client.tsx`.
 * - Removed `'use client'` directive
 * - Replaced `@/` imports with `@extension/ui` and relative paths
 * - Replaced `Suggestion` DB type with a local lightweight type
 * - Replaced `getSuggestions` server action with a stub from `./actions`
 */

import { getSuggestions } from './actions';
import { Artifact } from '../components/create-artifact';
import { DiffView } from '../components/diffview';
import { DocumentSkeleton } from '../components/document-skeleton';
import { MarkdownEditor } from '../components/editors/markdown-editor';
import {
  ClockRewindIcon,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '../components/icons';
import { cn } from '../utils';
import { toast } from 'sonner';

type Suggestion = {
  id: string;
  documentId: string;
  originalText: string;
  suggestedText: string;
  description?: string;
  createdAt: number;
};

type TextArtifactMetadata = {
  suggestions: Suggestion[];
};

export const textArtifact = new Artifact<'text', TextArtifactMetadata>({
  kind: 'text',
  description: 'Useful for text content, like drafting essays and emails.',
  initialize: async ({ documentId, setMetadata }) => {
    const suggestions = await getSuggestions({ documentId });

    setMetadata({
      suggestions,
    });
  },
  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    const part = streamPart as { type: string; data: unknown };

    if (part.type === 'data-suggestion') {
      setMetadata(metadata => ({
        suggestions: [...metadata.suggestions, part.data as Suggestion],
      }));
    }

    if (part.type === 'data-textDelta') {
      setArtifact(draftArtifact => ({
        ...draftArtifact,
        content: draftArtifact.content + (part.data as string),
        isVisible:
          draftArtifact.status === 'streaming' &&
          draftArtifact.content.length > 400 &&
          draftArtifact.content.length < 450
            ? true
            : draftArtifact.isVisible,
        status: 'streaming',
      }));
    }
  },
  content: ({
    mode,
    status,
    content,
    isCurrentVersion,
    currentVersionIndex,
    getDocumentContentById,
    isLoading,
  }) => {
    if (isLoading) {
      return <DocumentSkeleton artifactKind="text" />;
    }

    if (mode === 'diff') {
      const oldContent = getDocumentContentById(currentVersionIndex - 1);
      const newContent = getDocumentContentById(currentVersionIndex);

      return <DiffView newContent={newContent} oldContent={oldContent} />;
    }

    return (
      <div
        className={cn(
          'flex flex-row px-4 py-8 md:p-20',
          !isCurrentVersion && 'pointer-events-none opacity-60',
        )}>
        <MarkdownEditor content={content} streaming={status === 'streaming'} />
      </div>
    );
  },
  actions: [
    {
      icon: <ClockRewindIcon size={18} />,
      description: 'View changes',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('toggle');
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => isCurrentVersion,
    },
    {
      icon: <CopyIcon size={18} />,
      description: 'Copy to clipboard',
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard!');
      },
    },
  ],
  toolbar: [
    {
      icon: <PenIcon />,
      description: 'Add final polish',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Please add final polish and check for grammar, add section titles for better structure, and ensure everything reads smoothly.',
            },
          ],
        });
      },
    },
    {
      icon: <MessageIcon />,
      description: 'Request suggestions',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Please add suggestions you have that could improve the writing.',
            },
          ],
        });
      },
    },
  ],
});
