import { createMergingStorage } from './create-merging-storage.js';
import { createStorage, StorageEnum } from '../base/index.js';

// Keep in sync with LogLevel/LogConfig in @extension/shared/lib/logger.ts
// (cannot import from shared — would create circular dependency)
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LogConfig {
  enabled: boolean;
  level: LogLevel;
}

const defaultLogConfig: LogConfig = {
  enabled: false,
  level: 'info',
};

const rawLogConfigStorage = createStorage<LogConfig>('log-config', defaultLogConfig, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

const logConfigStorage = createMergingStorage(rawLogConfigStorage, defaultLogConfig);

export type { LogConfig };
export { logConfigStorage, defaultLogConfig };
