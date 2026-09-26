import {
  shouldSynthesize,
  maybeApplyTts,
  buildProviderOptions,
  resolveProviderOrder,
} from './resolve';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TtsConfig } from './types';

const mockSynthesize = vi.fn();
vi.mock('./providers', () => ({
  getProvider: (id: string) => (id === 'openai' ? { id, synthesize: mockSynthesize } : undefined),
}));

// Mock logger
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@extension/storage', () => ({
  publicModelsStorage: {
    get: vi.fn(async () => [{ id: 'tts-public', kind: 'tts', isDefault: true }]),
  },
}));
vi.mock('../ask-service/client', () => ({ requireSession: vi.fn(async () => ({ token: 'jwt' })) }));

const makeConfig = (overrides?: Partial<TtsConfig>): TtsConfig => ({
  engine: 'openai',
  autoMode: 'always',
  maxChars: 4000,
  summarize: false,
  summaryTimeout: 15000,
  chatUiAutoPlay: false,
  openai: {
    modelId: 'tts-public',
    voice: 'nova',
  },
  ...overrides,
});

describe('tts/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldSynthesize', () => {
    it('returns false when engine is off', () => {
      expect(
        shouldSynthesize(makeConfig({ engine: 'off' }), false, 'Hello world, this is a test.'),
      ).toBe(false);
    });

    it('returns false when autoMode is off', () => {
      expect(
        shouldSynthesize(makeConfig({ autoMode: 'off' }), false, 'Hello world, this is a test.'),
      ).toBe(false);
    });

    it('returns false when autoMode is inbound and no audio', () => {
      expect(
        shouldSynthesize(
          makeConfig({ autoMode: 'inbound' }),
          false,
          'Hello world, this is a test.',
        ),
      ).toBe(false);
    });

    it('returns true when autoMode is inbound and has audio', () => {
      expect(
        shouldSynthesize(makeConfig({ autoMode: 'inbound' }), true, 'Hello world, this is a test.'),
      ).toBe(true);
    });

    it('returns true when autoMode is always', () => {
      expect(
        shouldSynthesize(makeConfig({ autoMode: 'always' }), false, 'Hello world, this is a test.'),
      ).toBe(true);
    });

    it('returns false for short text (< 10 chars)', () => {
      expect(shouldSynthesize(makeConfig(), false, 'Hi')).toBe(false);
      expect(shouldSynthesize(makeConfig(), false, '123456789')).toBe(false);
    });

    it('returns true for text with exactly 10 chars', () => {
      expect(shouldSynthesize(makeConfig(), false, '1234567890')).toBe(true);
    });

    it('returns false for text containing MEDIA: token', () => {
      expect(shouldSynthesize(makeConfig(), false, 'Here is MEDIA:/path/to/file.png')).toBe(false);
    });

    it('returns false for empty/whitespace text', () => {
      expect(shouldSynthesize(makeConfig(), false, '')).toBe(false);
      expect(shouldSynthesize(makeConfig(), false, '   ')).toBe(false);
    });
  });

  describe('buildProviderOptions', () => {
    it('returns openai config options', () => {
      const config = makeConfig({
        openai: { modelId: 'tts-public', voice: 'alloy' },
      });
      const options = buildProviderOptions(config, 'openai', 'tts-public');
      expect(options).toEqual({
        model: 'tts-public',
        voice: 'alloy',
      });
    });
  });

  describe('resolveProviderOrder', () => {
    it('returns only the selected provider', () => {
      const order = resolveProviderOrder('openai');
      expect(order[0]).toBe('openai');
      expect(order).toEqual(['openai']);
    });
  });

  describe('maybeApplyTts', () => {
    it('returns null when shouldSynthesize is false', async () => {
      const result = await maybeApplyTts({
        text: 'Hi',
        config: makeConfig(),
        inboundHadAudio: false,
      });
      expect(result).toBeNull();
      expect(mockSynthesize).not.toHaveBeenCalled();
    });

    it('returns null when engine is off', async () => {
      const result = await maybeApplyTts({
        text: 'Hello world, this is a test.',
        config: makeConfig({ engine: 'off' }),
        inboundHadAudio: false,
      });
      expect(result).toBeNull();
    });

    it('calls provider.synthesize on valid input', async () => {
      const fakeAudio = new ArrayBuffer(100);
      mockSynthesize.mockResolvedValue({
        audio: fakeAudio,
        contentType: 'audio/wav',
        voiceCompatible: false,
      });

      const result = await maybeApplyTts({
        text: 'Hello world, this is a test sentence.',
        config: makeConfig(),
        inboundHadAudio: false,
      });

      expect(mockSynthesize).toHaveBeenCalledOnce();
      expect(result).not.toBeNull();
      expect(result!.audio).toBe(fakeAudio);
      expect(result!.provider).toBe('openai');
      expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('preprocesses markdown before synthesis', async () => {
      const fakeAudio = new ArrayBuffer(100);
      mockSynthesize.mockResolvedValue({
        audio: fakeAudio,
        contentType: 'audio/wav',
        voiceCompatible: false,
      });

      await maybeApplyTts({
        text: '### Hello **world**, this is a test.',
        config: makeConfig(),
        inboundHadAudio: false,
      });

      // The text passed to synthesize should have markdown stripped
      const callArgs = mockSynthesize.mock.calls[0];
      const synthesizedText = callArgs[0];
      expect(synthesizedText).not.toContain('###');
      expect(synthesizedText).not.toContain('**');
      expect(synthesizedText).toContain('Hello');
      expect(synthesizedText).toContain('world');
    });

    it('returns null when preprocessed text is too short', async () => {
      // Code block only — preprocessing removes it, leaving < 10 chars
      const result = await maybeApplyTts({
        text: '```\nx=1\n```',
        config: makeConfig(),
        inboundHadAudio: false,
      });
      expect(result).toBeNull();
      expect(mockSynthesize).not.toHaveBeenCalled();
    });

    it('truncates text to maxChars', async () => {
      const fakeAudio = new ArrayBuffer(100);
      mockSynthesize.mockResolvedValue({
        audio: fakeAudio,
        contentType: 'audio/wav',
        voiceCompatible: false,
      });

      const longText = 'This is a sentence. '.repeat(100);
      await maybeApplyTts({
        text: longText,
        config: makeConfig({ maxChars: 50 }),
        inboundHadAudio: false,
      });

      const synthesizedText = mockSynthesize.mock.calls[0][0];
      expect(synthesizedText.length).toBeLessThanOrEqual(53); // 50 + '...'
    });

    it('returns null on provider failure (non-fatal)', async () => {
      mockSynthesize.mockRejectedValue(new Error('Server TTS failed'));

      const result = await maybeApplyTts({
        text: 'Hello world, this is a test sentence.',
        config: makeConfig(),
        inboundHadAudio: false,
      });

      expect(result).toBeNull();
    });

    it('passes openai config to provider', async () => {
      const fakeAudio = new ArrayBuffer(100);
      mockSynthesize.mockResolvedValue({
        audio: fakeAudio,
        contentType: 'audio/wav',
        voiceCompatible: false,
      });

      await maybeApplyTts({
        text: 'Hello world, this is a test sentence.',
        config: makeConfig({
          openai: { modelId: 'tts-public', voice: 'alloy' },
        }),
        inboundHadAudio: false,
      });

      const options = mockSynthesize.mock.calls[0][1];
      expect(options.model).toBe('tts-public');
      expect(options.voice).toBe('alloy');
    });
  });
});
