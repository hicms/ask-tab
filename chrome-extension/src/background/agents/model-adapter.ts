import { ASK_SERVICE_URL } from '@extension/env';
import { getModelContextLimit } from '@extension/shared';
import type { ChatModel } from '@extension/shared';
import type { Api, Model } from '@mariozechner/pi-ai';

interface ResolvedModel {
  model: Model<Api>;
}

const chatModelToPiModel = (config: ChatModel): ResolvedModel => {
  const local = config.provider === 'local';
  if (!local && config.provider !== 'custom' && config.provider !== 'anthropic') {
    throw new Error(`Unsupported remote model provider: ${config.provider}`);
  }
  const api: Api = config.provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  const contextWindow = config.contextWindow ?? (local ? 4096 : getModelContextLimit(config.id));
  const model: Model<Api> = {
    id: config.id,
    name: config.name,
    api,
    provider: local ? 'local' : config.provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: local ? '' : `${ASK_SERVICE_URL}/api/llm/${encodeURIComponent(config.id)}`,
    reasoning: config.supportsReasoning ?? false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.floor(contextWindow * 0.25),
    ...(local || config.provider === 'anthropic'
      ? {}
      : { compat: { supportsDeveloperRole: false } }),
  };
  return { model };
};

export type { ResolvedModel };
export { chatModelToPiModel };
