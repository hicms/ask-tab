import { createStorage, StorageEnum } from '../base/index.js';

interface TtsConfig {
  engine: 'off' | 'openai';
  autoMode: 'off' | 'always' | 'inbound';
  maxChars: number;
  summarize: boolean;
  summaryTimeout: number;
  chatUiAutoPlay: boolean;
  openai: {
    modelId: string;
    voice: string;
  };
}

const defaultTtsConfig: TtsConfig = {
  engine: 'off',
  autoMode: 'always',
  maxChars: 4000,
  summarize: true,
  summaryTimeout: 15000,
  chatUiAutoPlay: false,
  openai: {
    modelId: '',
    voice: 'nova',
  },
};

const ttsConfigStorage = createStorage<TtsConfig>('tts-config', defaultTtsConfig, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type { TtsConfig };
export { ttsConfigStorage, defaultTtsConfig };
