import type { UIArtifact } from '../artifact-types';
import type { ComponentType, Dispatch, ReactNode, SetStateAction } from 'react';

export type ArtifactActionContext<M = unknown> = {
  content: string;
  handleVersionChange: (type: 'next' | 'prev' | 'toggle' | 'latest') => void;
  currentVersionIndex: number;
  isCurrentVersion: boolean;
  mode: 'edit' | 'diff';
  metadata: M;
  setMetadata: Dispatch<SetStateAction<M>>;
};

type ArtifactAction<M = unknown> = {
  icon: ReactNode;
  label?: string;
  description: string;
  onClick: (context: ArtifactActionContext<M>) => Promise<void> | void;
  isDisabled?: (context: ArtifactActionContext<M>) => boolean;
};

export type ArtifactToolbarContext = {
  sendMessage: (message: { role: string; parts: Array<{ type: string; text: string }> }) => void;
};

export type ArtifactToolbarItem = {
  description: string;
  icon: ReactNode;
  onClick: (context: ArtifactToolbarContext) => void;
};

type ArtifactContent<M = unknown> = {
  title: string;
  content: string;
  mode: 'edit' | 'diff';
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  status: 'streaming' | 'idle';
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  isInline: boolean;
  getDocumentContentById: (index: number) => string;
  isLoading: boolean;
  metadata: M;
  setMetadata: Dispatch<SetStateAction<M>>;
};

type InitializeParameters<M = unknown> = {
  documentId: string;
  setMetadata: Dispatch<SetStateAction<M>>;
};

type ArtifactConfig<T extends string, M = unknown> = {
  kind: T;
  description: string;
  content: ComponentType<ArtifactContent<M>>;
  actions: ArtifactAction[];
  toolbar: ArtifactToolbarItem[];
  initialize?: (parameters: InitializeParameters<M>) => void;
  onStreamPart?: (args: {
    setMetadata: Dispatch<SetStateAction<M>>;
    setArtifact: Dispatch<SetStateAction<UIArtifact>>;
    streamPart: unknown;
  }) => void;
};

export class Artifact<T extends string, M = unknown> {
  readonly kind: T;
  readonly description: string;
  readonly content: ComponentType<ArtifactContent<M>>;
  readonly actions: ArtifactAction[];
  readonly toolbar: ArtifactToolbarItem[];
  readonly initialize?: (parameters: InitializeParameters<M>) => void;
  readonly onStreamPart?: (args: {
    setMetadata: Dispatch<SetStateAction<M>>;
    setArtifact: Dispatch<SetStateAction<UIArtifact>>;
    streamPart: unknown;
  }) => void;

  constructor(config: ArtifactConfig<T, M>) {
    this.kind = config.kind;
    this.description = config.description;
    this.content = config.content;
    this.actions = config.actions || [];
    this.toolbar = config.toolbar || [];
    this.initialize = config.initialize || (async () => ({}));
    this.onStreamPart = config.onStreamPart;
  }
}
