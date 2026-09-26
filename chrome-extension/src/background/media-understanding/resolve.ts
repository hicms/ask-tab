import { DEFAULT_LOCAL_MODEL } from './defaults';
import { getProvider } from './providers';
import { requireSession } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { publicModelsStorage, sttConfigStorage } from '@extension/storage';
import type { MediaEngine, TranscribeOptions } from './types';
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

const detectBestEngine = async (config: SttConfig): Promise<MediaEngine> => {
  try {
    await resolveSttModel(config);
    return 'openai';
  } catch {
    return 'transformers';
  }
};

const resolveTranscription = async (audio: ArrayBuffer, mimeType: string): Promise<string> => {
  const config = await sttConfigStorage.get();
  if (config.engine === 'off') throw new Error('Audio transcription is disabled');
  const engine: MediaEngine =
    config.engine === 'auto' ? await detectBestEngine(config) : config.engine;
  const provider = getProvider(engine);
  if (!provider) throw new Error(`Unknown media engine: ${engine}`);

  const options: TranscribeOptions = { language: config.language };
  if (engine === 'openai') {
    options.session = await requireSession();
    options.model = await resolveSttModel(config, options.session);
  } else if (engine === 'sensevoice') {
    options.model = 'sensevoice';
    if (config.language === 'en') options.language = 'auto';
  } else {
    options.model = config.localModel || DEFAULT_LOCAL_MODEL;
  }
  log.info('resolveTranscription: engine selected', { engine, bytes: audio.byteLength });
  try {
    return await provider.transcribe(audio, mimeType, options);
  } catch (error) {
    if (config.engine === 'auto' && engine === 'openai') {
      const local = getProvider('transformers');
      if (local)
        return local.transcribe(audio, mimeType, {
          language: config.language,
          model: config.localModel || DEFAULT_LOCAL_MODEL,
        });
    }
    throw error;
  }
};

export { resolveTranscription, resolveSttModel, detectBestEngine };
