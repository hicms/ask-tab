import { Button } from './ui';
import { initialArtifactData, useArtifact } from '../hooks/use-artifact';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

function PureArtifactCloseButton() {
  const { setArtifact } = useArtifact();

  return (
    <Button
      className="h-fit p-2 dark:hover:bg-zinc-700"
      data-testid="artifact-close-button"
      onClick={() => {
        setArtifact(currentArtifact =>
          currentArtifact.status === 'streaming'
            ? {
                ...currentArtifact,
                isVisible: false,
              }
            : { ...initialArtifactData, status: 'idle' },
        );
      }}
      variant="outline">
      <XIcon className="size-4" />
    </Button>
  );
}

export const ArtifactCloseButton = memo(PureArtifactCloseButton, () => true);
