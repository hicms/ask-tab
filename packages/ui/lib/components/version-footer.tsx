import { Button } from './ui';
import { useArtifact } from '../hooks/use-artifact';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import { motion } from 'framer-motion';
import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import type { ArtifactVersion } from '../artifact-types';

type VersionFooterProps = {
  handleVersionChange: (type: 'next' | 'prev' | 'toggle' | 'latest') => void;
  documents: ArtifactVersion[] | undefined;
  currentVersionIndex: number;
};

export const VersionFooter = ({
  handleVersionChange,
  documents,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  currentVersionIndex,
}: VersionFooterProps) => {
  const { artifact: _artifact } = useArtifact();
  const [isMutating, setIsMutating] = useState(false);

  // Simple mobile detection
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  if (!documents) {
    return null;
  }

  return (
    <motion.div
      animate={{ y: 0 }}
      className="bg-background absolute bottom-0 z-50 flex w-full flex-col justify-between gap-4 border-t p-4 lg:flex-row"
      exit={{ y: isMobile ? 200 : 77 }}
      initial={{ y: isMobile ? 200 : 77 }}
      transition={{ type: 'spring', stiffness: 140, damping: 20 }}>
      <div>
        <div>You are viewing a previous version</div>
        <div className="text-muted-foreground text-sm">Restore this version to make edits</div>
      </div>

      <div className="flex flex-row gap-4">
        <Button
          disabled={isMutating}
          onClick={async () => {
            setIsMutating(true);
            // In the extension context, restoring a version is handled locally.
            // This stub simulates version restore — integrate with IndexedDB storage as needed.
            try {
              // TODO: Implement version restore via local storage
              diagnostics.warn('Version restore not yet implemented for extension context');
            } finally {
              setIsMutating(false);
            }
          }}>
          <div>Restore this version</div>
          {isMutating && (
            <div className="animate-spin">
              <Loader2Icon className="size-4" />
            </div>
          )}
        </Button>
        <Button
          onClick={() => {
            handleVersionChange('latest');
          }}
          variant="outline">
          Back to latest version
        </Button>
      </div>
    </motion.div>
  );
};
