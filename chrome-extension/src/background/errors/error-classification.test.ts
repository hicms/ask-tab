import {
  isContextOverflowError,
  isLikelyContextOverflowError,
  isCompactionFailureError,
  isRateLimitError,
  isTransientHttpError,
  isAuthError,
  classifyError,
  parseProviderTokenLimit,
} from './error-classification';
import { describe, it, expect } from 'vitest';

describe('error-classification', () => {
  describe('isContextOverflowError', () => {
    it('detects OpenAI context_length_exceeded', () => {
      expect(
        isContextOverflowError(
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens.",
        ),
      ).toBe(true);
    });

    it('detects Anthropic prompt too long', () => {
      expect(isContextOverflowError('prompt is too long: 200000 tokens > 100000 maximum')).toBe(
        true,
      );
    });

    it('detects Google too many tokens', () => {
      expect(
        isContextOverflowError('Request payload size exceeds the limit: too many tokens'),
      ).toBe(true);
    });

    it('detects generic token limit', () => {
      expect(isContextOverflowError('You have exceeded the token limit for this model')).toBe(true);
    });

    it('detects content_too_large', () => {
      expect(isContextOverflowError('content_too_large: the request is too large')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isContextOverflowError('Internal server error')).toBe(false);
    });

    it('returns false for rate limit errors', () => {
      expect(isContextOverflowError('Rate limit exceeded. Please retry after 60s')).toBe(false);
    });
  });

  describe('isLikelyContextOverflowError', () => {
    it('matches broad context overflow patterns', () => {
      expect(isLikelyContextOverflowError('The context length exceeds the limit')).toBe(true);
    });

    it('matches prompt too long variant', () => {
      expect(isLikelyContextOverflowError('Your prompt is too long for this model')).toBe(true);
    });

    it('matches input too long', () => {
      expect(isLikelyContextOverflowError('The input is too long')).toBe(true);
    });

    it('excludes rate limit messages from context overflow', () => {
      expect(isLikelyContextOverflowError('429 Too Many Requests')).toBe(false);
    });

    it('excludes pure rate limit messages', () => {
      expect(isLikelyContextOverflowError('Rate limit exceeded')).toBe(false);
    });
  });

  describe('isCompactionFailureError', () => {
    it('detects compaction failure', () => {
      expect(isCompactionFailureError('compaction failed: context too small')).toBe(true);
    });

    it('detects context too small', () => {
      expect(isCompactionFailureError('context is too small for this operation')).toBe(true);
    });

    it('detects summary overflow', () => {
      expect(isCompactionFailureError('summary is too long to fit')).toBe(true);
    });

    it('returns false for generic overflow', () => {
      expect(isCompactionFailureError('maximum context length exceeded')).toBe(false);
    });
  });

  describe('isRateLimitError', () => {
    it('detects 429 status', () => {
      expect(isRateLimitError('Error 429: Too Many Requests')).toBe(true);
    });

    it('detects rate limit text', () => {
      expect(isRateLimitError('You are being rate limited')).toBe(true);
    });

    it('detects quota exceeded', () => {
      expect(isRateLimitError('Quota exceeded for this API key')).toBe(true);
    });

    it('returns false for context overflow', () => {
      expect(isRateLimitError('maximum context length exceeded')).toBe(false);
    });
  });

  describe('isTransientHttpError', () => {
    it('detects 500 errors', () => {
      expect(isTransientHttpError('HTTP 500 Internal Server Error')).toBe(true);
    });

    it('detects 502 errors', () => {
      expect(isTransientHttpError('502 Bad Gateway')).toBe(true);
    });

    it('detects ECONNRESET', () => {
      expect(isTransientHttpError('read ECONNRESET')).toBe(true);
    });

    it('detects socket hang up', () => {
      expect(isTransientHttpError('socket hang up')).toBe(true);
    });

    it('returns false for auth errors', () => {
      expect(isTransientHttpError('401 Unauthorized')).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('detects 401', () => {
      expect(isAuthError('HTTP 401 Unauthorized')).toBe(true);
    });

    it('detects 403', () => {
      expect(isAuthError('HTTP 403 Forbidden')).toBe(true);
    });

    it('detects invalid API key', () => {
      expect(isAuthError('Invalid API key provided')).toBe(true);
    });

    it('returns false for server errors', () => {
      expect(isAuthError('Internal server error')).toBe(false);
    });
  });

  describe('classifyError', () => {
    it('classifies context overflow', () => {
      expect(classifyError("This model's maximum context length is 128000 tokens")).toBe(
        'context-overflow',
      );
    });

    it('classifies compaction failure (takes priority over context overflow)', () => {
      expect(classifyError('compaction failed: context too small')).toBe('compaction-failure');
    });

    it('classifies auth errors', () => {
      expect(classifyError('401 Unauthorized')).toBe('auth');
    });

    it('classifies rate limit errors', () => {
      expect(classifyError('429 Too Many Requests')).toBe('rate-limit');
    });

    it('classifies transient errors', () => {
      expect(classifyError('502 Bad Gateway')).toBe('transient');
    });

    it('classifies unknown errors', () => {
      expect(classifyError('Something went wrong')).toBe('unknown');
    });
  });

  describe('parseProviderTokenLimit', () => {
    it('extracts limit from OpenAI "maximum context length is X" message', () => {
      expect(
        parseProviderTokenLimit(
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens.",
        ),
      ).toBe(128000);
    });

    it('extracts limit from "exceeds the limit of X" message', () => {
      expect(parseProviderTokenLimit('Input token count exceeds the limit of 32768')).toBe(32768);
    });

    it('extracts limit from "model maximum of X" message', () => {
      expect(
        parseProviderTokenLimit('Input token count 180000 exceeds the model maximum of 128000'),
      ).toBe(128000);
    });

    it('extracts limit from "max_tokens: X" message', () => {
      expect(parseProviderTokenLimit('max_tokens: 4096')).toBe(4096);
    });

    it('returns undefined for messages without a limit number', () => {
      expect(parseProviderTokenLimit('Something went wrong')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(parseProviderTokenLimit('')).toBeUndefined();
    });

    it('returns undefined for rate limit errors (no token limit)', () => {
      expect(parseProviderTokenLimit('429 Too Many Requests')).toBeUndefined();
    });
  });
});
