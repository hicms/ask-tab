import {
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { sttConfigStorage, defaultSttConfig, publicModelsStorage } from '@extension/storage';
import { ChevronLeftIcon, Loader2Icon, MicIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from '@extension/i18n';
import type { SttConfig } from '@extension/storage';

/* ---------- Step6SpeechSetup ---------- */

const SPEECH_ENGINE_OPTIONS: { value: SttConfig['engine']; label: string; description: string }[] =
  [
    { value: 'off', label: 'Off', description: 'Audio transcription is disabled' },
    {
      value: 'openai',
      label: 'AskTab server',
      description: 'Uses an STT model configured on the AskTab server.',
    },
  ];

const Step6SpeechSetup = ({
  onComplete,
  onBack,
  t,
}: {
  onComplete: () => void;
  onBack: () => void;
  t: TFunction;
}) => {
  const [engine, setEngine] = useState<SttConfig['engine']>(defaultSttConfig.engine);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [serverSttAvailable, setServerSttAvailable] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void publicModelsStorage
        .get()
        .then(models => setServerSttAvailable(models.some(model => model.kind === 'stt')));
    };
    refresh();
    return publicModelsStorage.subscribe(refresh);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const config = await sttConfigStorage.get();
        setEngine(config.engine);
      } catch {
        // keep default
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleGetStarted = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const config = await sttConfigStorage.get();
      await sttConfigStorage.set({ ...config, engine });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('firstRun_saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [engine, onComplete, t]);

  const selected = SPEECH_ENGINE_OPTIONS.find(o => o.value === engine);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t('firstRun_speechTitle')}</CardTitle>
        <CardDescription>{t('firstRun_speechDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <MicIcon className="text-muted-foreground size-3.5" />
            {t('firstRun_stepSpeech')}
          </Label>
          <Select
            disabled={loading}
            onValueChange={value => setEngine(value as SttConfig['engine'])}
            value={engine}>
            <SelectTrigger data-testid="setup-speech-engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEECH_ENGINE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <p className="text-muted-foreground text-xs leading-snug">
              {engine === 'openai' && !serverSttAvailable
                ? 'Server STT is not configured.'
                : selected.description}
            </p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between">
          <Button data-testid="setup-back-button" onClick={onBack} variant="link">
            <ChevronLeftIcon className="mr-1 size-4" />
            {t('firstRun_back')}
          </Button>
          <Button
            data-testid="setup-get-started-button"
            disabled={saving || loading}
            onClick={handleGetStarted}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {t('firstRun_getStarted')}
          </Button>
        </div>
      </CardContent>
    </div>
  );
};

export { Step6SpeechSetup };
