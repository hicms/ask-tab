import { createStorage, StorageEnum } from '../base/index.js';

interface SttConfig {
  engine: 'auto' | 'off' | 'openai';
  openai: { modelId: string };
  language: string;
  /** `KeyboardEvent.code` for push-to-talk dictation: hold to record, release to stop (e.g. `AltRight`). Empty disables the shortcut. */
  hotkey: string;
}

const defaultSttConfig: SttConfig = {
  engine: 'off',
  openai: { modelId: '' },
  language: 'en',
  hotkey: 'AltRight',
};

const sttConfigStorage = createStorage<SttConfig>('stt-config', defaultSttConfig, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type { SttConfig };
export { sttConfigStorage, defaultSttConfig };
