import { useDataStream } from './data-stream-provider';
import { artifactDefinitions } from '../artifacts';
import { initialArtifactData, useArtifact } from '../hooks/use-artifact';
import { useEffect } from 'react';

type DataStreamHandlerProps = {
  /**
   * Optional callback invoked when the stream includes a `data-chat-title`
   * delta.  The parent can use this to refresh sidebar history or update
   * the current chat title in local state.
   */
  onChatTitleUpdate?: (title: string) => void;
};

export function DataStreamHandler({ onChatTitleUpdate }: DataStreamHandlerProps = {}) {
  const { dataStream, setDataStream } = useDataStream();
  const { artifact, setArtifact } = useArtifact();

  useEffect(() => {
    if (!dataStream?.length) {
      return;
    }

    const newDeltas = dataStream.slice();
    setDataStream([]);

    for (const delta of newDeltas) {
      // Handle chat title updates — fire callback instead of SWR mutate
      if (delta.type === 'data-chat-title') {
        onChatTitleUpdate?.(delta.data as string);
        continue;
      }

      // Delegate to artifact-specific stream part handler if present
      const artifactDefinition = artifactDefinitions.find(
        currentArtifactDefinition => currentArtifactDefinition.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata: () => {}, // metadata setter — wire up when needed
        });
      }

      // Handle artifact-level stream protocol deltas
      setArtifact(draftArtifact => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: 'streaming' };
        }

        switch (delta.type) {
          case 'data-id':
            return {
              ...draftArtifact,
              documentId: delta.data as string,
              status: 'streaming',
            };

          case 'data-title':
            return {
              ...draftArtifact,
              title: delta.data as string,
              status: 'streaming',
            };

          case 'data-kind':
            return {
              ...draftArtifact,
              kind: delta.data as typeof draftArtifact.kind,
              status: 'streaming',
            };

          case 'data-clear':
            return {
              ...draftArtifact,
              content: '',
              status: 'streaming',
            };

          case 'data-finish':
            return {
              ...draftArtifact,
              status: 'idle',
            };

          default:
            return draftArtifact;
        }
      });
    }
  }, [dataStream, setArtifact, artifact, setDataStream, onChatTitleUpdate]);

  return null;
}
