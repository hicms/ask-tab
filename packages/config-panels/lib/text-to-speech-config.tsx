import { defaultTtsConfig, publicModelsStorage, ttsConfigStorage } from '@extension/storage';
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
  Separator,
} from '@extension/ui';
import { Volume2Icon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicModel, TtsConfig as TtsConfigData } from '@extension/storage';

// ── Option Constants ─────────────────────────────

const engineOptions = [
  { value: 'off', label: 'Off' },
  { value: 'openai', label: 'AskTab server' },
] as const;

const engineDescriptions: Record<string, string> = {
  off: 'Text-to-speech is disabled',
  openai: 'Uses a TTS model configured on the AskTab server',
};

const autoModeOptions = [
  { value: 'off', label: 'Off' },
  { value: 'always', label: 'Always' },
  { value: 'inbound', label: 'Inbound Audio' },
] as const;

const autoModeDescriptions: Record<string, string> = {
  off: 'Never auto-generate voice replies',
  always: 'Generate voice for every AI reply',
  inbound: 'Only when the inbound message had audio',
};

const openaiVoiceOptions = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'nova', label: 'Nova' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'shimmer', label: 'Shimmer' },
] as const;

// ── Component ────────────────────────────────────

const TextToSpeechConfig = () => {
  const [config, setConfig] = useState<TtsConfigData | null>(null);
  const [ttsModels, setTtsModels] = useState<PublicModel[]>([]);
  useEffect(() => {
    const refresh = () => {
      void publicModelsStorage
        .get()
        .then(models => setTtsModels(models.filter(model => model.kind === 'tts')));
    };
    refresh();
    return publicModelsStorage.subscribe(refresh);
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ttsConfigStorage
      .get()
      .then(setConfig)
      .catch(() => setConfig({ ...defaultTtsConfig }));
  }, []);

  // ── Handlers ──

  const handleEngineChange = useCallback((engine: TtsConfigData['engine']) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, engine };
      ttsConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleAutoModeChange = useCallback((autoMode: TtsConfigData['autoMode']) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, autoMode };
      ttsConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleOpenAISelectChange = useCallback((field: 'modelId' | 'voice', value: string) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, openai: { ...prev.openai, [field]: value } };
      ttsConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleMaxCharsChange = useCallback((value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, maxChars: num };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        ttsConfigStorage.set(next);
      }, 500);
      return next;
    });
  }, []);

  const handleChatUiAutoPlayToggle = useCallback((checked: boolean) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, chatUiAutoPlay: checked };
      ttsConfigStorage.set(next);
      return next;
    });
  }, []);

  if (!config) return null;

  const showOpenAIFields = config.engine === 'openai';
  const isEnabled = config.engine !== 'off';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2Icon className="size-5" />
          Text-to-Speech
        </CardTitle>
        <CardDescription>Configure voice synthesis for AI replies</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {/* Engine */}
          <div className="grid gap-2">
            <Label htmlFor="tts-engine">Engine</Label>
            <Select
              onValueChange={v => handleEngineChange(v as TtsConfigData['engine'])}
              value={config.engine}>
              <SelectTrigger id="tts-engine">
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

          {isEnabled && (
            <>
              <Separator />

              {/* Auto Mode */}
              <div className="grid gap-2">
                <Label htmlFor="tts-auto-mode">Auto Voice Reply</Label>
                <Select
                  onValueChange={v => handleAutoModeChange(v as TtsConfigData['autoMode'])}
                  value={config.autoMode}>
                  <SelectTrigger id="tts-auto-mode">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {autoModeOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {autoModeDescriptions[config.autoMode]}
                </p>
              </div>

              {/* Chat UI Auto-Play */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm" htmlFor="tts-chat-ui-auto-play">
                    Auto-play in chat UI
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Play AI responses as audio in the browser side panel
                  </p>
                </div>
                <input
                  checked={config.chatUiAutoPlay}
                  className="accent-primary size-4"
                  id="tts-chat-ui-auto-play"
                  onChange={e => handleChatUiAutoPlayToggle(e.target.checked)}
                  type="checkbox"
                />
              </div>

              <Separator />

              {/* Server TTS settings */}
              {showOpenAIFields && (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Server TTS</h3>
                  <div className="grid gap-3 pl-4">
                    <div className="grid gap-2">
                      <Label htmlFor="tts-openai-model">Server TTS model</Label>
                      {ttsModels.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          Server TTS is not configured.
                        </p>
                      ) : (
                        <Select
                          onValueChange={v => handleOpenAISelectChange('modelId', v)}
                          value={
                            config.openai.modelId ||
                            ttsModels.find(model => model.isDefault)?.id ||
                            ttsModels[0].id
                          }>
                          <SelectTrigger id="tts-openai-model">
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {ttsModels.map(model => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="tts-openai-voice">Voice</Label>
                      <Select
                        onValueChange={v => handleOpenAISelectChange('voice', v)}
                        value={config.openai.voice}>
                        <SelectTrigger id="tts-openai-voice">
                          <SelectValue placeholder="Select voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {openaiVoiceOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* Advanced Settings */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Advanced</h3>
                <div className="grid gap-3 pl-4">
                  <div className="grid gap-2">
                    <Label htmlFor="tts-max-chars">Max Characters</Label>
                    <Input
                      id="tts-max-chars"
                      max={10000}
                      min={100}
                      onChange={e => handleMaxCharsChange(e.target.value)}
                      type="number"
                      value={config.maxChars}
                    />
                    <p className="text-muted-foreground text-xs">
                      Text longer than this will be truncated before synthesis
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export { TextToSpeechConfig };
