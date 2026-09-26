import type { AskSession } from '@extension/storage';

type MediaEngine = 'auto' | 'off' | 'openai';

interface TranscribeOptions {
  model?: string;
  language?: string;
  session?: AskSession;
}

interface MediaProvider {
  id: string;
  transcribe: (audio: ArrayBuffer, mimeType: string, options: TranscribeOptions) => Promise<string>;
}

export type { MediaEngine, TranscribeOptions, MediaProvider };
export type { SttConfig } from '@extension/storage';
