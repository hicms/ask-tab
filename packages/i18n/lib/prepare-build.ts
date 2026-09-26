import setRelatedLocaleImports from './set-related-locale-import.js';
import { IS_DEV } from '@extension/env';
import { log as consoleLog } from 'node:console';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

(() => {
  const i18nPath = IS_DEV ? 'lib/i18n-dev.ts' : 'lib/i18n-prod.ts';
  cpSync(i18nPath, resolve('lib', 'i18n.ts'));

  const outDir = resolve(import.meta.dirname, '..', '..', '..', '..', 'dist');
  if (!existsSync(outDir)) {
    mkdirSync(outDir);
  }

  const localePath = resolve(outDir, '_locales');
  cpSync(resolve('locales'), localePath, { recursive: true });

  if (IS_DEV) {
    setRelatedLocaleImports();
  }
  consoleLog('I18n build complete');
})();
