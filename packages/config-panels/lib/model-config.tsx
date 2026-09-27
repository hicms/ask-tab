import { useT } from '@extension/i18n';
import { serverModelsStorage } from '@extension/storage';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ModelCapabilityIcons,
} from '@extension/ui';
import { BrainCircuitIcon, Loader2Icon, RefreshCwIcon, WrenchIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { DbChatModel } from '@extension/storage';

/** Models come from the AskTab server; this page only lists them and re-syncs on demand. */
const ModelConfig = () => {
  const t = useT();
  const [models, setModels] = useState<DbChatModel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    serverModelsStorage.get().then(setModels);
    return serverModelsStorage.subscribe(() => {
      serverModelsStorage.get().then(setModels);
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const response = (await chrome.runtime.sendMessage({ type: 'ASK_SYNC_MODELS' })) as {
        error?: string;
      };
      if (response.error) setError(response.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuitIcon className="size-5" />
          {t('model_title')}
        </CardTitle>
        <CardDescription>{t('model_serverDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('model_serverModels')}</h3>
          <Button disabled={refreshing} onClick={handleRefresh} size="sm" variant="outline">
            {refreshing ? (
              <Loader2Icon className="mr-1 size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="mr-1 size-4" />
            )}
            {t('model_refresh')}
          </Button>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {models.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {t('model_noServerModels')}
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {models.map(model => (
              <div className="flex items-center gap-3 px-3 py-2.5" key={model.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{model.name}</span>
                    <ModelCapabilityIcons model={model} />
                    {model.supportsTools && (
                      <WrenchIcon
                        className="text-muted-foreground size-3"
                        aria-label={t('model_supportsTools')}
                      />
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">{model.modelId}</p>
                </div>
                {model.contextWindow && (
                  <Badge className="shrink-0" variant="outline">
                    {Math.round(model.contextWindow / 1000)}K
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { ModelConfig };
