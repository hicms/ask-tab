import { requestAuthorized, requireSession } from '../../ask-service/client';
import { OPENAI_TTS_DEFAULT_VOICE } from '../defaults';
import type { TtsProviderImpl, TtsSynthesizeOptions, TtsSynthesizeResult } from '../types';

const synthesize = async (
  text: string,
  options: TtsSynthesizeOptions,
): Promise<TtsSynthesizeResult> => {
  if (!options.model) throw new Error('Server TTS model is not configured');
  const response = await requestAuthorized(
    `/api/audio/${encodeURIComponent(options.model)}/speech`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, voice: options.voice || OPENAI_TTS_DEFAULT_VOICE }),
    },
    options.session,
  );
  const audio = await response.arrayBuffer();
  if (options.session) await requireSession(options.session);
  return {
    audio,
    contentType: response.headers.get('Content-Type') || 'audio/ogg',
    voiceCompatible: true,
    sampleRate: 24000,
  };
};

const openaiTtsProvider: TtsProviderImpl = { id: 'openai', synthesize };
export { openaiTtsProvider };
