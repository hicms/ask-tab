import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SttConfig } from '@extension/storage';

const state = vi.hoisted(() => ({
  config: null as SttConfig | null,
  catalog: [] as Array<{ id: string; kind: string; isDefault: boolean }>,
  transcribe: vi.fn(async () => 'transcript'),
  session: vi.fn(async () => ({ token: 'jwt' })),
}));
vi.mock('@extension/storage', () => ({
  sttConfigStorage: { get: async () => state.config },
  publicModelsStorage: { get: async () => state.catalog },
}));
vi.mock('../ask-service/client', () => ({ requireSession: state.session }));
vi.mock('./providers', () => ({
  getProvider: (id: string) => ({ id, transcribe: state.transcribe }),
}));
vi.mock('../logging/logger-buffer', () => ({ createLogger: () => ({ info: vi.fn() }) }));
const { resolveTranscription, resolveSttModel } = await import('./resolve');

const config: SttConfig = {
  engine: 'openai',
  openai: { modelId: '' },
  language: 'zh',
  hotkey: '',
};
const audio = new ArrayBuffer(3);
beforeEach(() => {
  state.config = { ...config, openai: { ...config.openai } };
  state.catalog = [{ id: 'server-stt', kind: 'stt', isDefault: true }];
  state.transcribe.mockClear();
  state.session.mockClear();
});

describe('STT resolution', () => {
  it('selects a published server model and sends only public preferences', async () => {
    expect(await resolveTranscription(audio, 'audio/webm')).toBe('transcript');
    expect(state.transcribe).toHaveBeenCalledWith(audio, 'audio/webm', {
      language: 'zh',
      model: 'server-stt',
      session: { token: 'jwt' },
    });
    expect(state.session).toHaveBeenCalledTimes(2);
  });
  it('rejects a configured public ID absent from the current catalog', async () => {
    state.config!.openai.modelId = 'removed';
    await expect(resolveTranscription(audio, 'audio/webm')).rejects.toThrow(
      'Server STT is not configured',
    );
    expect(state.transcribe).not.toHaveBeenCalled();
  });
  it('resolves auto to server STT', async () => {
    state.config!.engine = 'auto';
    await resolveTranscription(audio, 'audio/webm');
    expect(state.transcribe).toHaveBeenCalledWith(audio, 'audio/webm', {
      language: 'zh',
      model: 'server-stt',
      session: { token: 'jwt' },
    });
  });
  it('fails auto when no server STT is published', async () => {
    state.config!.engine = 'auto';
    state.catalog = [];
    await expect(resolveTranscription(audio, 'audio/webm')).rejects.toThrow(
      'Server STT is not configured',
    );
    expect(state.transcribe).not.toHaveBeenCalled();
  });
  it('rejects when transcription is off', async () => {
    state.config!.engine = 'off';
    await expect(resolveTranscription(audio, 'audio/webm')).rejects.toThrow(
      'Audio transcription is disabled',
    );
  });
  it('never selects an unrelated chat model', async () => {
    state.catalog = [{ id: 'chat', kind: 'chat', isDefault: true }];
    await expect(resolveSttModel(state.config!)).rejects.toThrow('Server STT is not configured');
  });
});
