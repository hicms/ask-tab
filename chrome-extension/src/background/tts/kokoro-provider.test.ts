import { kokoroTtsProvider } from './providers/kokoro';
import { requestSynthesis, requestStreamingSynthesis } from './providers/kokoro-bridge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the kokoro-bridge before importing the module
vi.mock('./providers/kokoro-bridge', () => ({
  requestSynthesis: vi.fn(),
  requestStreamingSynthesis: vi.fn(),
}));

const mockRequestSynthesis = vi.mocked(requestSynthesis);
const mockRequestStreamingSynthesis = vi.mocked(requestStreamingSynthesis);

const makeBridgeResult = (overrides?: Partial<Awaited<ReturnType<typeof requestSynthesis>>>) => ({
  audio: new ArrayBuffer(100),
  sampleRate: 24000,
  contentType: 'audio/wav',
  voiceCompatible: false,
  ...overrides,
});

describe('tts/providers/kokoro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has id "kokoro"', () => {
    expect(kokoroTtsProvider.id).toBe('kokoro');
  });

  it('synthesize delegates to requestSynthesis with correct args', async () => {
    mockRequestSynthesis.mockResolvedValue(makeBridgeResult());

    await kokoroTtsProvider.synthesize('Hello world', {
      model: 'my-model',
      voice: 'af_nova',
      speed: 1.5,
    });

    expect(mockRequestSynthesis).toHaveBeenCalledWith(
      'Hello world',
      'my-model',
      'af_nova',
      1.5,
      expect.any(Number),
    );
  });

  it('synthesize uses defaults when options are omitted', async () => {
    mockRequestSynthesis.mockResolvedValue(makeBridgeResult());

    await kokoroTtsProvider.synthesize('test', {});

    expect(mockRequestSynthesis).toHaveBeenCalledWith(
      'test',
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      'af_heart',
      1.0,
      expect.any(Number),
    );
  });

  it('synthesize returns WAV result when bridge reports WAV', async () => {
    const fakeAudio = new ArrayBuffer(100);
    mockRequestSynthesis.mockResolvedValue(
      makeBridgeResult({
        audio: fakeAudio,
        contentType: 'audio/wav',
        voiceCompatible: false,
      }),
    );

    const result = await kokoroTtsProvider.synthesize('Hello', {});

    expect(result.audio).toBe(fakeAudio);
    expect(result.contentType).toBe('audio/wav');
    expect(result.sampleRate).toBe(24000);
    expect(result.voiceCompatible).toBe(false);
  });

  it('synthesize returns OGG Opus result when bridge reports Opus', async () => {
    const fakeAudio = new ArrayBuffer(200);
    mockRequestSynthesis.mockResolvedValue(
      makeBridgeResult({
        audio: fakeAudio,
        contentType: 'audio/ogg',
        voiceCompatible: true,
      }),
    );

    const result = await kokoroTtsProvider.synthesize('Hello', {});

    expect(result.audio).toBe(fakeAudio);
    expect(result.contentType).toBe('audio/ogg');
    expect(result.voiceCompatible).toBe(true);
  });

  it('synthesize propagates errors from bridge', async () => {
    mockRequestSynthesis.mockRejectedValue(new Error('Bridge error'));

    await expect(kokoroTtsProvider.synthesize('Hello', {})).rejects.toThrow('Bridge error');
  });

  it('has synthesizeStream method', () => {
    expect(kokoroTtsProvider.synthesizeStream).toBeDefined();
  });

  it('synthesizeStream delegates to requestStreamingSynthesis', async () => {
    mockRequestStreamingSynthesis.mockImplementation(
      async (_text, _model, _voice, _speed, onChunk) => {
        onChunk({
          chunkIndex: 0,
          text: 'Hello.',
          audio: new ArrayBuffer(50),
          contentType: 'audio/ogg',
          sampleRate: 24000,
          voiceCompatible: true,
        });
      },
    );

    const chunks: { chunkIndex: number; text: string }[] = [];
    await kokoroTtsProvider.synthesizeStream!(
      'Hello.',
      { model: 'my-model', voice: 'af_nova', speed: 1.5 },
      chunk => {
        chunks.push({ chunkIndex: chunk.chunkIndex, text: chunk.text });
      },
    );

    expect(mockRequestStreamingSynthesis).toHaveBeenCalledWith(
      'Hello.',
      'my-model',
      'af_nova',
      1.5,
      expect.any(Function),
      expect.any(Number),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].text).toBe('Hello.');
  });

  it('synthesizeStream uses defaults when options are omitted', async () => {
    mockRequestStreamingSynthesis.mockResolvedValue(undefined);

    await kokoroTtsProvider.synthesizeStream!('test', {}, vi.fn());

    expect(mockRequestStreamingSynthesis).toHaveBeenCalledWith(
      'test',
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      'af_heart',
      1.0,
      expect.any(Function),
      expect.any(Number),
    );
  });

  it('synthesizeStream propagates errors from bridge', async () => {
    mockRequestStreamingSynthesis.mockRejectedValue(new Error('Stream bridge error'));

    await expect(kokoroTtsProvider.synthesizeStream!('Hello', {}, vi.fn())).rejects.toThrow(
      'Stream bridge error',
    );
  });
});
