import { createContext, useCallback, useContext, useMemo } from 'react';
import type { UIArtifact } from '../artifact-types';
import type { Dispatch, SetStateAction } from 'react';

const initialArtifactData: UIArtifact = {
  documentId: 'init',
  content: '',
  kind: 'text',
  title: '',
  status: 'idle',
  isVisible: false,
};

type ArtifactContextValue = {
  artifact: UIArtifact;
  rawSetArtifact: Dispatch<SetStateAction<UIArtifact>>;
};

const ArtifactContext = createContext<ArtifactContextValue>({
  artifact: initialArtifactData,
  rawSetArtifact: () => {},
});

const useArtifact = () => {
  const { artifact, rawSetArtifact } = useContext(ArtifactContext);

  const setArtifact = useCallback(
    (updater: UIArtifact | ((prev: UIArtifact) => UIArtifact)) => {
      rawSetArtifact(prev => {
        const current = prev ?? initialArtifactData;
        return typeof updater === 'function' ? updater(current) : updater;
      });
    },
    [rawSetArtifact],
  );

  return useMemo(() => ({ artifact, setArtifact }), [artifact, setArtifact]);
};

const useArtifactSelector = <T>(selector: (state: UIArtifact) => T): T => {
  const { artifact } = useContext(ArtifactContext);
  return selector(artifact ?? initialArtifactData);
};

export { ArtifactContext, initialArtifactData, useArtifact, useArtifactSelector };
