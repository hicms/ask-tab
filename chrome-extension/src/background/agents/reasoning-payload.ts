import { resolveReasoningSettings } from '@extension/shared';
import { publicModelsStorage, reasoningSelectionsStorage } from '@extension/storage';
import type { ReasoningSetting } from '@extension/shared';
import type { Api, SimpleStreamOptions } from '@mariozechner/pi-ai';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const childObject = (parent: JsonObject, key: string): JsonObject => {
  const existing = parent[key];
  if (isObject(existing)) return existing;
  const created: JsonObject = {};
  parent[key] = created;
  return created;
};

/**
 * Control paths address the provider's REST body. The OpenAI and Anthropic SDKs
 * send their params object as that body. The Google SDK rebuilds the body from
 * typed fields and would drop unknown ones, so Gemini paths go through
 * `httpOptions.extraBody`, which it deep-merges into the final body.
 */
const requestBodyOf = (api: Api, payload: JsonObject): JsonObject =>
  api === 'google-generative-ai'
    ? childObject(childObject(childObject(payload, 'config'), 'httpOptions'), 'extraBody')
    : payload;

const applyReasoningSettings = (
  api: Api,
  payload: unknown,
  settings: readonly ReasoningSetting[],
): void => {
  if (!isObject(payload) || settings.length === 0) return;
  const body = requestBodyOf(api, payload);
  for (const { path, value } of settings) {
    const keys = path.split('.');
    const leaf = keys.pop() as string;
    const parent = keys.reduce(childObject, body);
    parent[leaf] = structuredClone(value);
  }
};

/** The user's choices for one public model ID, or its defaults; empty when it has no controls. */
const loadReasoningSettings = async (modelId: string): Promise<ReasoningSetting[]> => {
  const [models, selections] = await Promise.all([
    publicModelsStorage.get(),
    reasoningSelectionsStorage.get(),
  ]);
  const model = models.find(entry => entry.id === modelId && entry.kind === 'chat');
  // A catalog cached before controls were published has no field until the next sync.
  if (!model?.reasoningControls?.length) return [];
  return resolveReasoningSettings(model.reasoningControls, selections[modelId]);
};

const withReasoningSettings = <T extends SimpleStreamOptions>(
  api: Api,
  settings: readonly ReasoningSetting[],
  options: T | undefined,
): T | undefined => {
  if (settings.length === 0) return options;
  const forward = options?.onPayload;
  return {
    ...options,
    onPayload: (payload: unknown) => {
      applyReasoningSettings(api, payload, settings);
      forward?.(payload);
    },
  } as T;
};

export { applyReasoningSettings, loadReasoningSettings, withReasoningSettings };
