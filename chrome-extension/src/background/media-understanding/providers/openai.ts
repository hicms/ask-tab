import { requestAuthorized, requireSession } from '../../ask-service/client';
import type { MediaProvider, TranscribeOptions } from '../types';

const transcribe = async (
  audio: ArrayBuffer,
  mimeType: string,
  options: TranscribeOptions,
): Promise<string> => {
  if (!options.model) throw new Error('Server STT model is not configured');
  const ext = mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('mp3') || mimeType.includes('mpeg')
      ? 'mp3'
      : 'webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), `audio.${ext}`);
  if (options.language) form.append('language', options.language);
  const response = await requestAuthorized(
    `/api/audio/${encodeURIComponent(options.model)}/transcriptions`,
    { method: 'POST', body: form },
    options.session,
  );
  const data = (await response.json()) as { text: string };
  if (options.session) await requireSession(options.session);
  if (typeof data.text !== 'string') throw new Error('Invalid server STT response');
  return data.text;
};

const openaiProvider: MediaProvider = { id: 'openai', transcribe };
export { openaiProvider };
