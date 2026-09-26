import { formatKeyCode } from './format-key-code.js';
import { useT } from '@extension/i18n';
import { defaultSttConfig, publicModelsStorage, sttConfigStorage } from '@extension/storage';
import {
  Button,
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
import { KeyboardIcon, MicIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicModel, SttConfig } from '@extension/storage';

const engineOptions = [
  { value: 'off', label: 'Off' },
  { value: 'openai', label: 'AskTab server' },
] as const;

const engineDescriptions: Record<string, string> = {
  off: 'Audio transcription is disabled',
  openai: 'Uses an STT model configured on the AskTab server',
};

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'tr', label: 'Turkish' },
  { value: 'pl', label: 'Polish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'th', label: 'Thai' },
  { value: 'id', label: 'Indonesian' },
  { value: 'uk', label: 'Ukrainian' },
] as const;

const SpeechToTextConfig = () => {
  const t = useT();
  const [config, setConfig] = useState<SttConfig | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [capturingHotkey, setCapturingHotkey] = useState(false);

  const [sttModels, setSttModels] = useState<PublicModel[]>([]);
  useEffect(() => {
    const refresh = () => {
      void publicModelsStorage
        .get()
        .then(models => setSttModels(models.filter(model => model.kind === 'stt')));
    };
    refresh();
    return publicModelsStorage.subscribe(refresh);
  }, []);

  useEffect(() => {
    sttConfigStorage
      .get()
      .then(setConfig)
      .catch(() => setConfig({ ...defaultSttConfig }));
  }, []);

  const handleEngineChange = useCallback((engine: SttConfig['engine']) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, engine };
      sttConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleOpenAIFieldChange = useCallback((field: keyof SttConfig['openai'], value: string) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, openai: { ...prev.openai, [field]: value } };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        sttConfigStorage.set(next);
      }, 500);
      return next;
    });
  }, []);

  const handleLanguageChange = useCallback((value: string) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, language: value };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        sttConfigStorage.set(next);
      }, 500);
      return next;
    });
  }, []);

  // Capture a single keypress and persist it as the record hotkey immediately.
  // Escape cancels without changing the shortcut. Modifier keys are valid
  // shortcuts here (Right Alt is the default), so we do not skip them.
  const handleHotkeyKeyDown = useCallback((event: React.KeyboardEvent) => {
    event.preventDefault();
    if (event.key === 'Escape') {
      setCapturingHotkey(false);
      return;
    }
    const code = event.code;
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, hotkey: code };
      sttConfigStorage.set(next);
      return next;
    });
    setCapturingHotkey(false);
  }, []);

  if (!config) return null;

  const isEnabled = config.engine !== 'off';
  const showOpenAIFields = config.engine === 'openai';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MicIcon className="size-5" />
          Speech-to-Text
        </CardTitle>
        <CardDescription>Configure speech-to-text and media processing</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="stt-engine">Engine</Label>
            <Select
              onValueChange={v => handleEngineChange(v as SttConfig['engine'])}
              value={config.engine}>
              <SelectTrigger id="stt-engine">
                <SelectValue placeholder="Select engine" />
              </SelectTrigger>
              <SelectContent>
                {engineOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{engineDescriptions[config.engine]}</p>
          </div>

          {isEnabled && <h3 className="text-sm font-medium">Audio Transcription</h3>}

          {showOpenAIFields && (
            <div className="grid gap-2 pl-8">
              <Label htmlFor="stt-model">Server STT model</Label>
              {sttModels.length === 0 ? (
                <p className="text-muted-foreground text-sm">Server STT is not configured.</p>
              ) : (
                <Select
                  onValueChange={value => handleOpenAIFieldChange('modelId', value)}
                  value={
                    config.openai.modelId ||
                    sttModels.find(model => model.isDefault)?.id ||
                    sttModels[0].id
                  }>
                  <SelectTrigger id="stt-model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {sttModels.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {isEnabled && (
            <div className="grid gap-2">
              <Label htmlFor="stt-language">Language</Label>
              <Input
                id="stt-language"
                list="stt-language-options"
                onChange={e => handleLanguageChange(e.target.value)}
                placeholder="en"
                value={config.language}
              />
              <datalist id="stt-language-options">
                {languageOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </datalist>
              <p className="text-muted-foreground text-xs">
                ISO 639-1 code. Pick from the list or type a language code.
              </p>
            </div>
          )}

          {isEnabled && (
            <div className="grid gap-2">
              <Label htmlFor="stt-hotkey">{t('stt_hotkey_label')}</Label>
              <Button
                className="w-fit gap-2"
                data-testid="stt-hotkey-capture"
                id="stt-hotkey"
                onBlur={() => setCapturingHotkey(false)}
                onClick={() => setCapturingHotkey(true)}
                onKeyDown={capturingHotkey ? handleHotkeyKeyDown : undefined}
                size="sm"
                type="button"
                variant="outline">
                <KeyboardIcon className="size-4" />
                {capturingHotkey
                  ? t('stt_hotkey_prompt')
                  : formatKeyCode(config.hotkey) || t('stt_hotkey_unset')}
              </Button>
              <p className="text-muted-foreground text-xs">{t('stt_hotkey_hint')}</p>
            </div>
          )}

          {/* Future: <Separator /> + Image Understanding section */}
          {/* Future: <Separator /> + Video Understanding section */}
        </div>
      </CardContent>
    </Card>
  );
};

export { SpeechToTextConfig };
