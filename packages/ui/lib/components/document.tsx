import { useArtifact } from '../hooks/use-artifact';
import { FileIcon, Loader2Icon, MessageSquareIcon, PencilIcon } from 'lucide-react';
import { memo } from 'react';
import { toast } from 'sonner';
import type { ArtifactKind } from '../artifact-types';

const getActionText = (
  type: 'create' | 'update' | 'request-suggestions',
  tense: 'present' | 'past',
) => {
  switch (type) {
    case 'create':
      return tense === 'present' ? 'Creating' : 'Created';
    case 'update':
      return tense === 'present' ? 'Updating' : 'Updated';
    case 'request-suggestions':
      return tense === 'present' ? 'Adding suggestions' : 'Added suggestions to';
    default:
      return null;
  }
};

type DocumentToolResultProps = {
  type: 'create' | 'update' | 'request-suggestions';
  result: { id: string; title: string; kind: ArtifactKind };
  isReadonly: boolean;
};

function PureDocumentToolResult({ type, result, isReadonly }: DocumentToolResultProps) {
  const { setArtifact } = useArtifact();

  return (
    <button
      className="bg-background flex w-fit cursor-pointer flex-row items-start gap-3 rounded-xl border px-3 py-2"
      onClick={() => {
        if (isReadonly) {
          toast.error('Viewing files in shared chats is currently not supported.');
          return;
        }

        setArtifact(currentArtifact => ({
          documentId: result.id,
          kind: result.kind,
          content: currentArtifact.content,
          title: result.title,
          isVisible: true,
          status: 'idle',
        }));
      }}
      type="button">
      <div className="text-muted-foreground mt-1">
        {type === 'create' ? (
          <FileIcon className="size-4" />
        ) : type === 'update' ? (
          <PencilIcon className="size-4" />
        ) : type === 'request-suggestions' ? (
          <MessageSquareIcon className="size-4" />
        ) : null}
      </div>
      <div className="text-left">{`${getActionText(type, 'past')} "${result.title}"`}</div>
    </button>
  );
}

export const DocumentToolResult = memo(PureDocumentToolResult, () => true);

type DocumentToolCallProps = {
  type: 'create' | 'update' | 'request-suggestions';
  args:
    | { title: string; kind: ArtifactKind } // for create
    | { id: string; description: string } // for update
    | { documentId: string }; // for request-suggestions
  isReadonly: boolean;
};

function PureDocumentToolCall({ type, args, isReadonly }: DocumentToolCallProps) {
  const { setArtifact } = useArtifact();

  return (
    <button
      className="flex w-fit cursor-pointer flex-row items-start justify-between gap-3 rounded-xl border px-3 py-2"
      onClick={() => {
        if (isReadonly) {
          toast.error('Viewing files in shared chats is currently not supported.');
          return;
        }

        setArtifact(currentArtifact => ({
          ...currentArtifact,
          isVisible: true,
        }));
      }}
      type="button">
      <div className="flex flex-row items-start gap-3">
        <div className="mt-1 text-zinc-500">
          {type === 'create' ? (
            <FileIcon className="size-4" />
          ) : type === 'update' ? (
            <PencilIcon className="size-4" />
          ) : type === 'request-suggestions' ? (
            <MessageSquareIcon className="size-4" />
          ) : null}
        </div>

        <div className="text-left">
          {`${getActionText(type, 'present')} ${
            type === 'create' && 'title' in args && args.title
              ? `"${args.title}"`
              : type === 'update' && 'description' in args
                ? `"${(args as { id: string; description: string }).description}"`
                : type === 'request-suggestions'
                  ? 'for document'
                  : ''
          }`}
        </div>
      </div>

      <div className="mt-1 animate-spin">
        <Loader2Icon className="size-4" />
      </div>
    </button>
  );
}

export const DocumentToolCall = memo(PureDocumentToolCall, () => true);
