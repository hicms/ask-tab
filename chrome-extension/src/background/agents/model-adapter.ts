import { ASK_SERVICE_URL } from '@extension/env';
import { getModelContextLimit } from '@extension/shared';
import type { ChatModel, ModelProvider } from '@extension/shared';
import type { Api, Model } from '@mariozechner/pi-ai';

interface ResolvedModel {
  model: Model<Api>;
}

const relayRoutes: Record<ModelProvider, { api: Api; provider: string; pathSuffix: string }> = {
  custom: { api: 'openai-completions', provider: 'openai', pathSuffix: '' },
  anthropic: { api: 'anthropic-messages', provider: 'anthropic', pathSuffix: '' },
  // pi-ai clears the Google SDK apiVersion whenever baseUrl is set, so the
  // version segment must be part of baseUrl.
  google: { api: 'google-generative-ai', provider: 'google', pathSuffix: '/v1beta' },
};

const chatModelToPiModel = (config: ChatModel): ResolvedModel => {
  if (!Object.hasOwn(relayRoutes, config.provider)) {
    throw new Error(`Unsupported remote model provider: ${config.provider}`);
  }
  const route = relayRoutes[config.provider];
  const contextWindow = config.contextWindow ?? getModelContextLimit(config.id);
  const model: Model<Api> = {
    id: config.id,
    name: config.name,
    api: route.api,
    provider: route.provider,
    baseUrl: `${ASK_SERVICE_URL}/api/llm/${encodeURIComponent(config.id)}${route.pathSuffix}`,
    reasoning: config.supportsReasoning ?? false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.floor(contextWindow * 0.25),
    ...(route.api === 'openai-completions' ? { compat: { supportsDeveloperRole: false } } : {}),
  };
  return { model };
};

export type { ResolvedModel };
export { chatModelToPiModel };
