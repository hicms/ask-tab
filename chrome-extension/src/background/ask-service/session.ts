import {
  AskServiceError,
  clearSession,
  replaceSession,
  requestAnonymous,
  requestAuthorized,
  requireSession,
  withAccountMutation,
} from './client';
import { migrateRetiredModelReferences } from './retired-models';
import { isAllowedReasoningValue } from '@extension/shared';
import {
  askSessionStorage,
  modelTiers,
  publicModelsStorage,
  serverModelsStorage,
  selectedModelStorage,
} from '@extension/storage';
import type { ModelProvider } from '@extension/shared';
import type {
  DbChatModel,
  ModelTier,
  PublicModel,
  ReasoningControl,
  ReasoningValue,
} from '@extension/storage';

interface SessionResponse {
  token: string;
  expiresAt: number;
  user: { id: string; email: string };
}

/** The relay never converts between chat protocols, so each one selects its own SDK. */
const chatProviders: Record<string, ModelProvider> = {
  'openai-completions': 'custom',
  'anthropic-messages': 'anthropic',
  'gemini-generate-content': 'google',
};

const protocolKinds: Record<string, PublicModel['kind']> = {
  ...Object.fromEntries(Object.keys(chatProviders).map(protocol => [protocol, 'chat' as const])),
  'openai-transcriptions': 'stt',
  'azure-transcriptions': 'stt',
  'openai-speech': 'tts',
  'openai-embeddings': 'embedding',
};

const MAX_REASONING_VALUE_DEPTH = 8;
const reasoningPathSegment = /^[A-Za-z0-9_-]+$/;
// Control paths are written into request objects, so prototype keys must never reach them.
const forbiddenPathSegments = new Set(['__proto__', 'constructor', 'prototype']);

const isReasoningValue = (value: unknown, depth = 0): value is ReasoningValue => {
  if (depth > MAX_REASONING_VALUE_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isReasoningValue(item, depth + 1));
  return (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(item => isReasoningValue(item, depth + 1))
  );
};

const isReasoningPath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path
    .split('.')
    .every(segment => reasoningPathSegment.test(segment) && !forbiddenPathSegments.has(segment));

/** Returns null for anything outside the published shape. */
const toReasoningControls = (value: unknown): ReasoningControl[] | null => {
  if (!Array.isArray(value)) return null;
  const controls: ReasoningControl[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { path, values, default: fallback } = item as Record<string, unknown>;
    if (
      !isReasoningPath(path) ||
      controls.some(control => control.path === path) ||
      !Array.isArray(values) ||
      values.length === 0 ||
      !values.every(entry => isReasoningValue(entry)) ||
      !isReasoningValue(fallback)
    ) {
      return null;
    }
    const control: ReasoningControl = { path, values, default: fallback };
    if (!isAllowedReasoningValue(control, fallback)) return null;
    controls.push(control);
  }
  return controls;
};

/** Copy the published contract only; extra server fields cannot enter extension storage. */
const toPublicModel = (value: unknown): PublicModel => {
  if (!value || typeof value !== 'object') throw new Error('Invalid server model catalog');
  const model = value as Record<string, unknown>;
  const kind = typeof model.protocol === 'string' ? protocolKinds[model.protocol] : undefined;
  const reasoningControls = toReasoningControls(model.reasoningControls);
  if (
    !reasoningControls ||
    typeof model.id !== 'string' ||
    !model.id ||
    typeof model.name !== 'string' ||
    !model.name ||
    !kind ||
    model.kind !== kind ||
    typeof model.isDefault !== 'boolean' ||
    typeof model.supportsTools !== 'boolean' ||
    typeof model.supportsReasoning !== 'boolean' ||
    typeof model.supportsImages !== 'boolean' ||
    (model.contextWindow !== null &&
      (typeof model.contextWindow !== 'number' ||
        !Number.isSafeInteger(model.contextWindow) ||
        model.contextWindow <= 0)) ||
    (kind === 'embedding'
      ? typeof model.embeddingSpaceId !== 'string' || !model.embeddingSpaceId
      : model.embeddingSpaceId !== null) ||
    (model.vendor !== null && (typeof model.vendor !== 'string' || !model.vendor)) ||
    (model.tier !== null && !modelTiers.includes(model.tier as ModelTier)) ||
    (model.priceMultiplier !== null &&
      (typeof model.priceMultiplier !== 'number' ||
        !Number.isFinite(model.priceMultiplier) ||
        model.priceMultiplier <= 0))
  ) {
    throw new Error('Invalid server model catalog');
  }
  return {
    id: model.id,
    name: model.name,
    protocol: model.protocol as string,
    kind,
    embeddingSpaceId: model.embeddingSpaceId as string | null,
    isDefault: model.isDefault,
    supportsTools: model.supportsTools,
    supportsReasoning: model.supportsReasoning,
    supportsImages: model.supportsImages,
    contextWindow: model.contextWindow as number | null,
    vendor: model.vendor as string | null,
    tier: model.tier as ModelTier | null,
    priceMultiplier: model.priceMultiplier as number | null,
    reasoningControls,
  };
};

/** Persist only the public catalog entry. The JWT belongs exclusively to AskSession. */
const toChatModel = (model: PublicModel): DbChatModel => ({
  id: `ask:${model.id}`,
  modelId: model.id,
  name: model.name,
  provider: chatProviders[model.protocol],
  supportsTools: model.supportsTools,
  supportsReasoning: model.supportsReasoning,
  supportsImages: model.supportsImages,
  ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
  ...(model.vendor ? { vendor: model.vendor } : {}),
  ...(model.tier ? { tier: model.tier } : {}),
  ...(model.priceMultiplier ? { priceMultiplier: model.priceMultiplier } : {}),
});

const syncServerModels = async (): Promise<number> => {
  const session = await requireSession();
  const response = await requestAuthorized('/api/models', {}, session);
  const received: unknown = await response.json();
  if (!Array.isArray(received)) throw new Error('Invalid server model catalog');
  const published = received.map(toPublicModel);
  const chatEntries = published.filter(model => model.kind === 'chat');
  const models = chatEntries.map(toChatModel);
  await withAccountMutation(async () => {
    const current = await askSessionStorage.get();
    if (
      current?.token !== session.token ||
      current.userId !== session.userId ||
      current.expiresAt <= Date.now()
    ) {
      throw new AskServiceError('Account changed during model sync', 409);
    }
    await publicModelsStorage.set(published);
    await serverModelsStorage.set(models);
    await migrateRetiredModelReferences(published);
    const selected = await selectedModelStorage.get();
    if (!models.some(model => model.id === selected)) {
      const fallback = chatEntries.find(model => model.isDefault) ?? chatEntries[0];
      await selectedModelStorage.set(fallback ? `ask:${fallback.id}` : '');
    }
  });
  return models.length;
};

interface Credentials {
  email: string;
  password: string;
  /** Registration only; the server consumes each code once. */
  inviteCode?: string;
}

const signIn = async (mode: 'login' | 'register', credentials: Credentials) => {
  const response = await requestAnonymous(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const session = (await response.json()) as SessionResponse;
  await replaceSession({
    token: session.token,
    userId: session.user.id,
    email: session.user.email,
    expiresAt: session.expiresAt,
  });
  const models = await syncServerModels();
  return { email: session.user.email, models };
};

const signOut = async (): Promise<void> => {
  const session = await askSessionStorage.get();
  try {
    await requestAuthorized('/api/auth/logout', { method: 'POST' }, session ?? undefined);
  } catch {
    // The local session ends even when the server cannot be told.
  }
  if (session) await clearSession(session);
};

/**
 * Refresh the model list on service-worker start; offline keeps the cached models.
 * Signed out, any stored models predate server accounts and are removed so the
 * first-run login shows.
 */
const refreshSessionOnStartup = async (): Promise<void> => {
  if (!(await askSessionStorage.get())) {
    await withAccountMutation(async () => {
      if (!(await askSessionStorage.get())) {
        await Promise.all([serverModelsStorage.set([]), publicModelsStorage.set([])]);
      }
    });
    return;
  }
  try {
    await syncServerModels();
  } catch (error) {
    if (!(error instanceof AskServiceError)) throw error;
  }
};

const handleAskMessage = async (
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  switch (request.type) {
    case 'ASK_LOGIN':
    case 'ASK_REGISTER': {
      const credentials: Credentials = {
        email: String(request.email ?? ''),
        password: String(request.password ?? ''),
      };
      if (request.type === 'ASK_REGISTER')
        credentials.inviteCode = String(request.inviteCode ?? '');
      try {
        return await signIn(request.type === 'ASK_LOGIN' ? 'login' : 'register', credentials);
      } catch (error) {
        if (error instanceof AskServiceError) return { error: error.message, status: error.status };
        throw error;
      }
    }
    case 'ASK_LOGOUT':
      await signOut();
      return { success: true };
    case 'ASK_SYNC_MODELS':
      return { models: await syncServerModels() };
    default:
      throw new Error('Unknown account command');
  }
};

export { handleAskMessage, refreshSessionOnStartup, syncServerModels, toChatModel };
export type { PublicModel };
