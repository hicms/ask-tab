import { getProvider } from './providers';
import { requireSession } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { publicModelsStorage, sttConfigStorage } from '@extension/storage';
import type { MediaEngine } from './types';
import type { SttConfig, AskSession } from '@extension/storage';

const log = createLogger('media');

const resolveSttModel = async (config: SttConfig, session?: AskSession): Promise<string> => {
  const catalog = await publicModelsStorage.get();
  const choices = catalog.filter(model => model.kind === 'stt');
  const selected = config.openai.modelId
    ? choices.find(model => model.id === config.openai.modelId)
    : (choices.find(model => model.isDefault) ?? choices[0]);
  if (!selected) throw new Error('Server STT is not configured');
  await requireSession(session);
  return selected.id;
};

const resolveTranscription = async (audio: ArrayBuffer, mimeType: string): Promise<string> => {
  const config = await sttConfigStorage.get();
  if (config.engine === 'off') throw new Error('Audio transcription is disabled');
  const engine: MediaEngine = 'openai';
  const provider = getProvider(engine);
  if (!provider) throw new Error(`Unknown media engine: ${engine}`);

  const session = await requireSession();
  const model = await resolveSttModel(config, session);
  log.info('resolveTranscription: engine selected', { engine, bytes: audio.byteLength });
  return provider.transcribe(audio, mimeType, { language: config.language, session, model });
};

export { resolveTranscription, resolveSttModel };
