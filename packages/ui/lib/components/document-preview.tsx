import { ImageEditor } from './editors/image-editor';
import { Response } from './elements/response';
import { useArtifact } from '../hooks/use-artifact';
import { cn } from '../utils';
import { getArtifactById } from '@extension/storage';
import { cjk } from '@streamdown/cjk';
import { FileIcon, ImageIcon, Loader2Icon, MaximizeIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { ArtifactKind } from '../artifact-types';
import type { ToolPartState } from '@extension/shared';
import type { DbArtifact } from '@extension/storage';

type DocumentPreviewProps = {
  result?: { id: string; title: string; kind: ArtifactKind; content?: string };
  args?: { id?: string; title: string; kind: ArtifactKind; content?: string };
  state?: ToolPartState;
  chatId?: string;
};

const previewPlugins = { cjk };

const DocumentPreview = ({ result, args, state, chatId }: DocumentPreviewProps) => {
  const { artifact, setArtifact } = useArtifact();
  const previewId = useId();
  const storedId = result?.id ?? args?.id;
  const documentId = storedId ?? previewId;
  const [loaded, setLoaded] = useState<{ id: string; document?: DbArtifact }>();

  useEffect(() => {
    if (!storedId) return;
    let cancelled = false;
    getArtifactById(storedId)
      .then(document => {
        if (!cancelled) setLoaded({ id: storedId, document });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: storedId });
      });
    return () => {
      cancelled = true;
    };
  }, [storedId, state]);

  const stored = loaded?.id === storedId ? loaded?.document : undefined;
  const title = stored?.title ?? result?.title ?? args?.title ?? 'Untitled';
  const kind = stored?.kind ?? result?.kind ?? args?.kind ?? 'text';
  const isCurrentArtifact = artifact.documentId === documentId;
  // Tool arguments contain the complete document even before its database write finishes.
  // Never fall back to the content of a different, currently-open document.
  const content =
    (isCurrentArtifact ? artifact.content : undefined) ??
    stored?.content ??
    result?.content ??
    args?.content ??
    '';
  const isStreaming =
    state === 'input-streaming' ||
    state === 'input-available' ||
    (isCurrentArtifact && artifact.status === 'streaming');
  const isLoading = !content && !!storedId && loaded?.id !== storedId;
  const hasError = state === 'output-error';
  const canOpen = !!content && !isStreaming && !hasError;

  const handleOpen = useCallback(() => {
    if (!canOpen) return;
    setArtifact({
      documentId,
      chatId: stored?.chatId ?? chatId,
      title,
      kind,
      content,
      isVisible: true,
      status: 'idle',
    });
  }, [canOpen, setArtifact, documentId, stored?.chatId, chatId, title, kind, content]);

  return (
    <div
      aria-disabled={!canOpen}
      aria-label={`Open document: ${title}`}
      className={cn('relative w-full min-w-0', canOpen && 'cursor-pointer')}
      data-testid="document-preview"
      onClick={e => {
        e.stopPropagation();
        handleOpen();
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleOpen();
        }
      }}
      role="button"
      tabIndex={0}>
      <div className="border-border dark:bg-muted flex items-center justify-between gap-2 rounded-t-xl border border-b-0 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">
            {isStreaming || isLoading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : kind === 'image' ? (
              <ImageIcon className="size-4" />
            ) : (
              <FileIcon className="size-4" />
            )}
          </span>
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <MaximizeIcon className="text-muted-foreground size-4 shrink-0" />
      </div>

      <div className="border-border bg-muted h-40 overflow-hidden rounded-b-xl border border-t-0 p-4">
        {hasError ? (
          <p className="text-muted-foreground text-sm">Document could not be created.</p>
        ) : content ? (
          <div className="pointer-events-none h-full select-none" inert>
            {kind === 'text' ? (
              <Response
                className="text-xs [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm"
                controls={false}
                mode={isStreaming ? 'streaming' : 'static'}
                plugins={previewPlugins}>
                {content}
              </Response>
            ) : kind === 'image' ? (
              <ImageEditor
                content={content}
                title={title}
                status="idle"
                isCurrentVersion
                isInline
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words text-xs">{content}</pre>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isStreaming || isLoading ? 'Loading document…' : 'No document content available.'}
          </p>
        )}
      </div>
    </div>
  );
};

export { DocumentPreview };
