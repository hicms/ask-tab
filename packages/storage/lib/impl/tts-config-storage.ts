import { createStorage, StorageEnum } from '../base/index.js';

interface TtsConfig {
  engine: 'off' | 'kokoro' | 'openai';
  autoMode: 'off' | 'always' | 'inbound';
  maxChars: number;
  summarize: boolean;
  summaryTimeout: number;
  chatUiAutoPlay: boolean;
  kokoro: {
    model: string;
    voice: string;
    speed: number;
    adaptiveChunking: boolean;
  };
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
  kokoro: {
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    voice: 'af_heart',
    speed: 1.0,
    adaptiveChunking: true,
  },
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
