import { modelCapabilities, modelInputs } from './model-capabilities';
import { describe, expect, it } from 'vitest';

describe('modelInputs', () => {
  it('accepts images unless the catalog marks the model text-only', () => {
    expect(modelInputs({ supportsImages: true })).toEqual(['text', 'image']);
    expect(modelInputs({ supportsImages: false })).toEqual(['text']);
    expect(modelInputs({})).toEqual(['text', 'image']);
  });
});

describe('modelCapabilities', () => {
  it('lists text first, then images and thinking when supported', () => {
    expect(modelCapabilities({ supportsImages: true, supportsReasoning: true })).toEqual([
      'text',
      'image',
      'reasoning',
    ]);
    expect(modelCapabilities({ supportsImages: false, supportsReasoning: true })).toEqual([
      'text',
      'reasoning',
    ]);
    expect(modelCapabilities({ supportsImages: false, supportsReasoning: false })).toEqual([
      'text',
    ]);
    expect(modelCapabilities({})).toEqual(['text', 'image']);
  });
});
