import { chatModelFromStored } from './chat-model-from-stored';
import { describe, expect, it } from 'vitest';

describe('chatModelFromStored', () => {
  it('keeps the storage ID for selection and sends the provider model ID', () => {
    expect(
      chatModelFromStored({
        id: 'ask:grok-4-7-fast',
        modelId: 'grok-4-7-fast',
        name: 'Grok 4.7 Fast',
        provider: 'custom',
        supportsTools: true,
        supportsReasoning: true,
        supportsImages: true,
        contextWindow: 2000000,
        vendor: 'xai',
        tier: 'flagship',
        priceMultiplier: 3.5,
      }),
    ).toEqual({
      id: 'grok-4-7-fast',
      dbId: 'ask:grok-4-7-fast',
      name: 'Grok 4.7 Fast',
      provider: 'custom',
      supportsTools: true,
      supportsReasoning: true,
      supportsImages: true,
      contextWindow: 2000000,
      vendor: 'xai',
      tier: 'flagship',
      priceMultiplier: 3.5,
    });
  });

  it('falls back to the storage ID when no provider model ID is stored', () => {
    const model = chatModelFromStored({
      id: 'legacy',
      modelId: '',
      name: 'Legacy',
      provider: 'google',
    });
    expect(model).toMatchObject({ id: 'legacy', dbId: 'legacy', provider: 'google' });
    expect(model.tier).toBeUndefined();
  });
});
