import { DEFAULT_SUMMARY_TIMEOUT_MS } from './defaults';
import { completeText } from '../agents/stream-bridge';
import type { ChatModel } from '@extension/shared';

const TTS_SUMMARY_PROMPT =
  'Summarize the following text concisely while keeping the most important information. ' +
  'Maintain the original tone and style. ' +
  'Reply only with the summary, without additional explanations.';

/**
 * Summarize text for TTS using the LLM.
 * Falls back to truncation if no model is available or the call fails.
 * Non-fatal: callers should catch and fall back to truncation.
 */
const summarizeForTts = async (
  text: string,
  maxChars: number,
  modelConfig?: ChatModel,
  timeoutMs: number = DEFAULT_SUMMARY_TIMEOUT_MS,
): Promise<string> => {
  if (!modelConfig) {
    // No model available — truncate
    return text.slice(0, maxChars - 3) + '...';
  }

  const summary = await Promise.race([
    completeText(modelConfig, TTS_SUMMARY_PROMPT, text, {
      maxTokens: Math.ceil(maxChars / 3),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TTS summary timeout')), timeoutMs),
    ),
  ]);

  const trimmed = summary.trim();
  if (!trimmed) {
    return text.slice(0, maxChars - 3) + '...';
  }

  // Hard cap to maxChars
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars - 3) + '...' : trimmed;
};

export { summarizeForTts, TTS_SUMMARY_PROMPT };
