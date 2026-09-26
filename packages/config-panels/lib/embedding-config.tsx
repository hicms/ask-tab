import {
  defaultEmbeddingConfig,
  embeddingConfigStorage,
  publicModelsStorage,
} from '@extension/storage';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@extension/ui';
import { BrainCircuitIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmbeddingConfig, EmbeddingProviderType, PublicModel } from '@extension/storage';

const providerOptions: { value: EmbeddingProviderType; label: string; disabled?: boolean }[] = [
  { value: 'none', label: 'None (BM25 only)' },
  { value: 'openai-compatible', label: 'AskTab server' },
  { value: 'local', label: 'Local (Coming Soon)', disabled: true },
];

const providerDescriptions: Record<EmbeddingProviderType, string> = {
  none: 'Memory search uses keyword matching only (BM25)',
  'openai-compatible': 'Hybrid search: vector similarity (70%) + keyword matching (30%)',
  local: 'Run embedding models locally in the browser (not yet available)',
};

const EmbeddingConfigPanel = () => {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null);
  const [embeddingModels, setEmbeddingModels] = useState<PublicModel[]>([]);
  useEffect(() => {
    const refresh = () => {
      void publicModelsStorage
        .get()
        .then(models => setEmbeddingModels(models.filter(model => model.kind === 'embedding')));
    };
    refresh();
    return publicModelsStorage.subscribe(refresh);
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    embeddingConfigStorage
      .get()
      .then(setConfig)
      .catch(() => setConfig({ ...defaultEmbeddingConfig }));
  }, []);

  const saveDebounced = useCallback((next: EmbeddingConfig) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      embeddingConfigStorage.set(next);
    }, 500);
  }, []);

  const handleProviderChange = useCallback((value: string) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, provider: value as EmbeddingProviderType };
      embeddingConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleOpenAIFieldChange = useCallback(
    (field: keyof EmbeddingConfig['openaiCompatible'], value: string) => {
      setConfig(prev => {
        if (!prev) return null;
        const next = { ...prev, openaiCompatible: { ...prev.openaiCompatible, [field]: value } };
        saveDebounced(next);
        return next;
      });
    },
    [saveDebounced],
  );

  const handleSearchWeightChange = useCallback(
    (field: 'vectorWeight' | 'bm25Weight', value: string) => {
      setConfig(prev => {
        if (!prev) return null;
        const numVal = Math.max(0, Math.min(1, parseFloat(value) || 0));
        const next = { ...prev, search: { ...prev.search, [field]: numVal } };
        saveDebounced(next);
        return next;
      });
    },
    [saveDebounced],
  );

  if (!config) return null;

  const showOpenAIFields = config.provider === 'openai-compatible';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuitIcon className="size-5" />
          Embedding Search
        </CardTitle>
        <CardDescription>Configure vector embeddings for semantic memory search</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="embedding-provider">Provider</Label>
            <Select onValueChange={handleProviderChange} value={config.provider}>
              <SelectTrigger id="embedding-provider">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{providerDescriptions[config.provider]}</p>
          </div>

          {showOpenAIFields && (
            <>
              <h3 className="text-sm font-medium">Server embedding model</h3>
              <div className="grid gap-2 pl-8">
                {embeddingModels.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Server embedding is not configured.
                  </p>
                ) : (
                  <Select
                    onValueChange={value => handleOpenAIFieldChange('modelId', value)}
                    value={
                      config.openaiCompatible.modelId ||
                      embeddingModels.find(model => model.isDefault)?.id ||
                      embeddingModels[0].id
                    }>
                    <SelectTrigger id="embedding-model">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {embeddingModels.map(model => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <h3 className="text-sm font-medium">Search Weights</h3>
              <div className="grid gap-3 pl-8">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-vector-weight">Vector Weight</Label>
                    <Input
                      id="embedding-vector-weight"
                      max={1}
                      min={0}
                      onChange={e => handleSearchWeightChange('vectorWeight', e.target.value)}
                      step={0.1}
                      type="number"
                      value={config.search.vectorWeight}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="embedding-bm25-weight">BM25 Weight</Label>
                    <Input
                      id="embedding-bm25-weight"
                      max={1}
                      min={0}
                      onChange={e => handleSearchWeightChange('bm25Weight', e.target.value)}
                      step={0.1}
                      type="number"
                      value={config.search.bm25Weight}
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  How much to weight semantic similarity vs keyword matching (default: 0.7 / 0.3)
                </p>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export { EmbeddingConfigPanel };
