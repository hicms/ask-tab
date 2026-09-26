import { openaiTtsProvider } from './openai-tts';
import type { TtsProviderImpl } from '../types';

const PROVIDERS: TtsProviderImpl[] = [openaiTtsProvider];

const registry = new Map<string, TtsProviderImpl>();
for (const p of PROVIDERS) registry.set(p.id, p);

const getProvider = (id: string): TtsProviderImpl | undefined => registry.get(id);

export { getProvider, PROVIDERS };
