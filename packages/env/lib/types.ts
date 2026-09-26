import type { dynamicEnvValues } from './index.js';

interface ICebEnv {
  readonly CEB_GOOGLE_CLIENT_ID: string;
  readonly CEB_ENABLE_WEBGPU_MODELS: string;
  readonly CEB_DEV_LOCALE: string;
  readonly CEB_CI: string;
  readonly CEB_ASK_SERVICE_URL_DEVELOPMENT: string;
  readonly CEB_ASK_SERVICE_URL_TEST: string;
}

interface ICebCliEnv {
  readonly CLI_CEB_DEV: string;
  readonly CLI_CEB_FIREFOX: string;
}

export type EnvType = ICebEnv & ICebCliEnv & typeof dynamicEnvValues;
