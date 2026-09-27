import type { ChatModel } from './chat-types.js';

type ModelInput = 'text' | 'image';
type ModelCapability = ModelInput | 'reasoning';

/** Models cached before the catalog published supportsImages keep image input until the next sync. */
const modelInputs = (model: Pick<ChatModel, 'supportsImages'>): ModelInput[] =>
  model.supportsImages === false ? ['text'] : ['text', 'image'];

const modelCapabilities = (
  model: Pick<ChatModel, 'supportsImages' | 'supportsReasoning'>,
): ModelCapability[] =>
  model.supportsReasoning ? [...modelInputs(model), 'reasoning'] : modelInputs(model);

export type { ModelCapability, ModelInput };
export { modelCapabilities, modelInputs };
