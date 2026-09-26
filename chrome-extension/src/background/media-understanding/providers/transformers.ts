import { DEFAULT_LOCAL_MODEL } from '../defaults';
import { requestTranscription } from '../offscreen-bridge';
import type { MediaProvider, TranscribeOptions } from '../types';

const transcribe = async (
  audio: ArrayBuffer,
  mimeType: string,
  options: TranscribeOptions,
): Promise<string> =>
  requestTranscription(audio, mimeType, options.model || DEFAULT_LOCAL_MODEL, options.language);

const transformersProvider: MediaProvider = { id: 'transformers', transcribe };

export { transformersProvider };
