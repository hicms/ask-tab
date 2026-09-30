import { config } from '@dotenvx/dotenvx';
import { basename, dirname, resolve } from 'node:path';

const packageDir = dirname(import.meta.dirname);
const envPackageDir = basename(packageDir) === 'dist' ? dirname(packageDir) : packageDir;
const baseEnv =
  config({
    path: resolve(envPackageDir, '../../.env'),
  }).parsed ?? {};

const serviceTarget = process.env['CLI_CEB_TARGET'] ?? 'production';
if (serviceTarget !== 'development' && serviceTarget !== 'test' && serviceTarget !== 'production') {
  throw new Error(`Invalid CLI_CEB_TARGET: ${serviceTarget}`);
}

const serviceUrl =
  serviceTarget === 'development'
    ? baseEnv.CEB_ASK_SERVICE_URL_DEVELOPMENT
    : serviceTarget === 'test'
      ? baseEnv.CEB_ASK_SERVICE_URL_TEST
      : (process.env['CEB_ASK_SERVICE_URL_PRODUCTION'] ?? baseEnv.CEB_ASK_SERVICE_URL_PRODUCTION);
if (!serviceUrl) {
  throw new Error(`CEB_ASK_SERVICE_URL_${serviceTarget.toUpperCase()} is required`);
}

process.env['CEB_ASK_SERVICE_URL'] = serviceUrl;

const localServiceUrl = baseEnv.CEB_ASK_SERVICE_URL_LOCAL?.trim();
if (localServiceUrl) {
  let parsed: URL | undefined;
  try {
    parsed = new URL(localServiceUrl);
  } catch {
    // Reported below with the variable name.
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('CEB_ASK_SERVICE_URL_LOCAL must be an absolute http:// or https:// URL');
  }
}

const dynamicEnvValues = {
  CEB_NODE_ENV: baseEnv.CLI_CEB_DEV === 'true' ? 'development' : 'production',
  CEB_ASK_SERVICE_URL: serviceUrl,
} as const;

export { baseEnv, dynamicEnvValues };
