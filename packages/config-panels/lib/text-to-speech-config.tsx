import { defaultTtsConfig, publicModelsStorage, ttsConfigStorage } from '@extension/storage';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@extension/ui';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LoaderIcon,
  Trash2Icon,
  Volume2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicModel, TtsConfig as TtsConfigData } from '@extension/storage';

// ── Option Constants ─────────────────────────────

const engineOptions = [
  { value: 'off', label: 'Off' },
  { value: 'kokoro', label: 'Kokoro (Local)' },
  { value: 'openai', label: 'AskTab server' },
] as const;

const engineDescriptions: Record<string, string> = {
  off: 'Text-to-speech is disabled',
  kokoro: 'Runs Kokoro-82M locally via ONNX — no data leaves your browser',
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

const kokoroVoiceOptions = [
  { value: 'af_heart', label: 'Heart (Female)' },
  { value: 'af_alloy', label: 'Alloy (Female)' },
  { value: 'af_aoede', label: 'Aoede (Female)' },
  { value: 'af_bella', label: 'Bella (Female)' },
  { value: 'af_jessica', label: 'Jessica (Female)' },
  { value: 'af_kore', label: 'Kore (Female)' },
  { value: 'af_nicole', label: 'Nicole (Female)' },
  { value: 'af_nova', label: 'Nova (Female)' },
  { value: 'af_river', label: 'River (Female)' },
  { value: 'af_sarah', label: 'Sarah (Female)' },
  { value: 'af_sky', label: 'Sky (Female)' },
  { value: 'am_adam', label: 'Adam (Male)' },
  { value: 'am_echo', label: 'Echo (Male)' },
  { value: 'am_eric', label: 'Eric (Male)' },
  { value: 'am_liam', label: 'Liam (Male)' },
  { value: 'am_michael', label: 'Michael (Male)' },
  { value: 'am_onyx', label: 'Onyx (Male)' },
  { value: 'bf_emma', label: 'Emma (British Female)' },
  { value: 'bf_isabella', label: 'Isabella (British Female)' },
  { value: 'bm_george', label: 'George (British Male)' },
  { value: 'bm_lewis', label: 'Lewis (British Male)' },
] as const;

const openaiVoiceOptions = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'nova', label: 'Nova' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'shimmer', label: 'Shimmer' },
] as const;

const speedOptions = [
  { value: '0.5', label: '0.5x' },
  { value: '0.75', label: '0.75x' },
  { value: '1', label: '1.0x' },
  { value: '1.25', label: '1.25x' },
  { value: '1.5', label: '1.5x' },
  { value: '2', label: '2.0x' },
] as const;

// ── Cache Helpers ────────────────────────────────

const KOKORO_CACHE_NAME = 'transformers-cache';

interface CachedModel {
  model: string;
  label: string;
  sizeBytes: number;
  fileCount: number;
}

interface DownloadProgress {
  downloadId: string | null;
  status: 'idle' | 'downloading' | 'complete' | 'error';
  percent: number;
  error?: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const listCachedKokoroModels = async (): Promise<CachedModel[]> => {
  try {
    const cache = await caches.open(KOKORO_CACHE_NAME);
    const keys = await cache.keys();

    const modelSizes = new Map<string, { sizeBytes: number; fileCount: number }>();

    for (const request of keys) {
      const match = request.url.match(/Kokoro-82M/);
      if (!match) continue;

      const response = await cache.match(request);
      const size = response ? parseInt(response.headers.get('Content-Length') ?? '0', 10) : 0;

      const key = 'Kokoro-82M-v1.0-ONNX';
      const existing = modelSizes.get(key) ?? { sizeBytes: 0, fileCount: 0 };
      existing.sizeBytes += size;
      existing.fileCount += 1;
      modelSizes.set(key, existing);
    }

    const result: CachedModel[] = [];
    for (const [model, info] of modelSizes) {
      result.push({
        model,
        label: 'Kokoro 82M',
        sizeBytes: info.sizeBytes,
        fileCount: info.fileCount,
      });
    }

    return result;
  } catch {
    return [];
  }
};

const deleteCachedKokoroModel = async (): Promise<void> => {
  const cache = await caches.open(KOKORO_CACHE_NAME);
  const keys = await cache.keys();

  for (const request of keys) {
    if (request.url.includes('Kokoro-82M')) {
      await cache.delete(request);
    }
  }
};

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
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    downloadId: null,
    status: 'idle',
    percent: 0,
  });
  const [cachedModels, setCachedModels] = useState<CachedModel[]>([]);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'importing' | 'complete' | 'error'>(
    'idle',
  );
  const [uploadError, setUploadError] = useState<string | undefined>();
  const folderInputRef = useRef<HTMLInputElement>(null);

  const refreshCachedModels = useCallback(async () => {
    const models = await listCachedKokoroModels();
    setCachedModels(models);
  }, []);

  useEffect(() => {
    ttsConfigStorage
      .get()
      .then(setConfig)
      .catch(() => setConfig({ ...defaultTtsConfig }));
    refreshCachedModels();
  }, [refreshCachedModels]);

  useEffect(() => {
    if (downloadProgress.status === 'complete') {
      refreshCachedModels();
    }
  }, [downloadProgress.status, refreshCachedModels]);

  // Listen for download progress from offscreen worker
  useEffect(() => {
    const listener = (message: Record<string, unknown>) => {
      if (
        message.type === 'TTS_DOWNLOAD_PROGRESS' &&
        typeof message.downloadId === 'string' &&
        message.downloadId === downloadProgress.downloadId
      ) {
        setDownloadProgress(prev => ({
          ...prev,
          status: message.status as DownloadProgress['status'],
          percent: (message.percent as number) ?? prev.percent,
          error: message.error as string | undefined,
        }));
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [downloadProgress.downloadId]);

  // ── Handlers ──

  const handleEngineChange = useCallback((engine: TtsConfigData['engine']) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, engine };
      ttsConfigStorage.set(next);
      return next;
    });
    setDownloadProgress({ downloadId: null, status: 'idle', percent: 0 });
  }, []);

  const handleAutoModeChange = useCallback((autoMode: TtsConfigData['autoMode']) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = { ...prev, autoMode };
      ttsConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleKokoroFieldChange = useCallback(
    (field: keyof TtsConfigData['kokoro'], value: string | number | boolean) => {
      setConfig(prev => {
        if (!prev) return null;
        const next = { ...prev, kokoro: { ...prev.kokoro, [field]: value } };
        ttsConfigStorage.set(next);
        return next;
      });
    },
    [],
  );

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

  const handleDownloadModel = useCallback(async () => {
    if (!config) return;

    setDownloadProgress({ downloadId: null, status: 'downloading', percent: 0 });

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'TTS_DOWNLOAD_MODEL',
        engine: 'kokoro',
        model: config.kokoro.model,
      })) as { downloadId?: string; error?: string };

      if (response?.downloadId) {
        setDownloadProgress(prev => ({ ...prev, downloadId: response.downloadId! }));
      } else {
        setDownloadProgress({
          downloadId: null,
          status: 'error',
          percent: 0,
          error: response?.error ?? 'Failed to start download',
        });
      }
    } catch (err) {
      setDownloadProgress({
        downloadId: null,
        status: 'error',
        percent: 0,
        error: err instanceof Error ? err.message : 'Failed to start download',
      });
    }
  }, [config]);

  const handleDeleteModel = useCallback(
    async (model: string) => {
      setDeletingModel(model);
      try {
        await deleteCachedKokoroModel();
        await refreshCachedModels();
      } finally {
        setDeletingModel(null);
      }
    },
    [refreshCachedModels],
  );

  const handleImportFolder = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!config) return;
      const files = event.target.files;
      if (!files || files.length === 0) return;

      // Validate: must contain config.json and at least one .onnx file
      const fileList = Array.from(files);
      const hasConfig = fileList.some(f => f.name === 'config.json');
      const hasOnnx = fileList.some(f => f.name.endsWith('.onnx'));

      if (!hasConfig || !hasOnnx) {
        setUploadStatus('error');
        setUploadError('Folder must contain config.json and at least one .onnx file');
        // Reset so same folder can be re-selected
        if (folderInputRef.current) folderInputRef.current.value = '';
        return;
      }

      setUploadStatus('importing');
      setUploadError(undefined);

      try {
        const cache = await caches.open(KOKORO_CACHE_NAME);

        for (const file of fileList) {
          // Strip the top-level folder name from webkitRelativePath
          const parts = file.webkitRelativePath.split('/');
          const relativePath = parts.slice(1).join('/');
          if (!relativePath) continue;

          const url = `https://huggingface.co/${config.kokoro.model}/resolve/main/${relativePath}`;
          const blob = new Blob([await file.arrayBuffer()], {
            type: file.type || 'application/octet-stream',
          });
          await cache.put(
            url,
            new Response(blob, { headers: { 'Content-Length': String(file.size) } }),
          );
        }

        await refreshCachedModels();
        setUploadStatus('complete');
      } catch (err) {
        setUploadStatus('error');
        setUploadError(err instanceof Error ? err.message : 'Import failed');
      } finally {
        // Reset so same folder can be re-selected
        if (folderInputRef.current) folderInputRef.current.value = '';
      }
    },
    [config, refreshCachedModels],
  );

  if (!config) return null;

  const showKokoroFields = config.engine === 'kokoro';
  const showOpenAIFields = config.engine === 'openai';
  const isEnabled = config.engine !== 'off';
  const modelCached = cachedModels.length > 0;

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

              {/* Kokoro Settings */}
              {showKokoroFields && (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Kokoro Settings</h3>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <ExternalLinkIcon className="size-3" />
                    Source:{' '}
                    <a
                      className="hover:text-foreground underline underline-offset-2"
                      href={`https://huggingface.co/${config.kokoro.model}`}
                      rel="noopener noreferrer"
                      target="_blank">
                      huggingface.co/{config.kokoro.model}
                    </a>
                  </p>
                  <div className="grid gap-3 pl-4">
                    <div className="grid gap-2">
                      <Label htmlFor="tts-kokoro-voice">Voice</Label>
                      <Select
                        onValueChange={v => handleKokoroFieldChange('voice', v)}
                        value={config.kokoro.voice}>
                        <SelectTrigger id="tts-kokoro-voice">
                          <SelectValue placeholder="Select voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {kokoroVoiceOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tts-kokoro-speed">Speed</Label>
                      <Select
                        onValueChange={v => handleKokoroFieldChange('speed', parseFloat(v))}
                        value={String(config.kokoro.speed)}>
                        <SelectTrigger id="tts-kokoro-speed">
                          <SelectValue placeholder="Select speed" />
                        </SelectTrigger>
                        <SelectContent>
                          {speedOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Adaptive Chunking */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm" htmlFor="tts-adaptive-chunking">
                          Adaptive chunking
                        </Label>
                        <p className="text-muted-foreground text-xs">
                          Split long text into time-based chunks for faster delivery
                        </p>
                      </div>
                      <input
                        checked={config.kokoro.adaptiveChunking ?? true}
                        className="accent-primary size-4"
                        id="tts-adaptive-chunking"
                        onChange={e =>
                          handleKokoroFieldChange('adaptiveChunking', e.target.checked)
                        }
                        type="checkbox"
                      />
                    </div>

                    {/* Model download */}
                    <div className="mt-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          disabled={downloadProgress.status === 'downloading'}
                          id="tts-download-model"
                          onClick={handleDownloadModel}
                          size="sm"
                          variant="outline">
                          {downloadProgress.status === 'downloading' ? (
                            <LoaderIcon className="mr-1.5 size-4 animate-spin" />
                          ) : modelCached ? (
                            <CheckCircle2Icon className="mr-1.5 size-4" />
                          ) : (
                            <DownloadIcon className="mr-1.5 size-4" />
                          )}
                          {downloadProgress.status === 'downloading'
                            ? 'Downloading...'
                            : modelCached
                              ? 'Re-download'
                              : 'Download Model'}
                        </Button>

                        <Button
                          disabled={uploadStatus === 'importing'}
                          onClick={() => folderInputRef.current?.click()}
                          size="sm"
                          variant="outline">
                          {uploadStatus === 'importing' ? (
                            <LoaderIcon className="mr-1.5 size-4 animate-spin" />
                          ) : (
                            <FolderOpenIcon className="mr-1.5 size-4" />
                          )}
                          {uploadStatus === 'importing' ? 'Importing...' : 'Import from folder'}
                        </Button>

                        <input
                          className="hidden"
                          onChange={handleImportFolder}
                          ref={folderInputRef}
                          type="file"
                          {...({
                            webkitdirectory: '',
                          } as React.InputHTMLAttributes<HTMLInputElement>)}
                        />

                        {downloadProgress.status === 'complete' && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2Icon className="size-4" />
                            Ready
                          </span>
                        )}

                        {downloadProgress.status === 'error' && (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <AlertCircleIcon className="size-4" />
                            {downloadProgress.error || 'Download failed'}
                          </span>
                        )}

                        {uploadStatus === 'complete' && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2Icon className="size-4" />
                            Imported
                          </span>
                        )}

                        {uploadStatus === 'error' && (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <AlertCircleIcon className="size-4" />
                            {uploadError || 'Import failed'}
                          </span>
                        )}
                      </div>

                      {downloadProgress.status === 'downloading' && (
                        <Progress className="h-2" value={downloadProgress.percent} />
                      )}

                      <p className="text-muted-foreground text-xs">
                        The model downloads on first use. Pre-download to avoid waiting.
                      </p>

                      {cachedModels.length > 0 && (
                        <div className="mt-2 space-y-2">
                          <Label className="flex items-center gap-1.5">
                            <HardDriveIcon className="size-3.5" />
                            Downloaded Models
                          </Label>
                          <div className="divide-border divide-y rounded-md border">
                            {cachedModels.map(m => (
                              <div
                                className="flex items-center justify-between px-3 py-2 text-sm"
                                key={m.model}>
                                <div>
                                  <span className="font-medium">{m.label}</span>
                                  <span className="text-muted-foreground ml-2 text-xs">
                                    {formatBytes(m.sizeBytes)}
                                  </span>
                                </div>
                                <Button
                                  className="text-destructive hover:text-destructive h-7 px-2"
                                  disabled={deletingModel === m.model}
                                  onClick={() => handleDeleteModel(m.model)}
                                  size="sm"
                                  variant="ghost">
                                  {deletingModel === m.model ? (
                                    <LoaderIcon className="size-3.5 animate-spin" />
                                  ) : (
                                    <Trash2Icon className="size-3.5" />
                                  )}
                                </Button>
                              </div>
                            ))}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Total:{' '}
                            {formatBytes(cachedModels.reduce((sum, m) => sum + m.sizeBytes, 0))}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

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
