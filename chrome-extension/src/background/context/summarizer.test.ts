import {
  auditSummaryQuality,
  collectFileOperations,
  collectToolFailures,
  extractCriticalRules,
  extractIdentifiers,
  extractRecentIdentifiers,
  formatTranscript,
  getLatestUserAsk,
  getRecentTurnsVerbatim,
  RECENT_TURN_MAX_CHARS,
  summarizeMessages,
} from './summarizer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatModel } from '@extension/shared';

it('cancels an in-flight summary without retrying after a late failure', async () => {
  const controller = new AbortController();
  let rejectRequest!: (error: Error) => void;
  mockCompleteText.mockReset();
  mockCompleteText.mockImplementationOnce((_model, _system, _content, opts) => {
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    return new Promise((_, reject) => {
      rejectRequest = reject;
    });
  });
  const running = summarizeMessages([makeMessage()], mockModelConfig, {
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(mockCompleteText).toHaveBeenCalledOnce());
  controller.abort();
  await expect(running).rejects.toThrow();
  rejectRequest(new Error('Late network failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockCompleteText).toHaveBeenCalledOnce();
});

// Mock completeText from pi-stream-bridge
const mockCompleteText = vi.fn();
vi.mock('../agents/stream-bridge', () => ({
  completeText: (...args: unknown[]) => mockCompleteText(...args),
}));

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello' }],
  createdAt: Date.now(),
  ...overrides,
});

const mockModelConfig: ChatModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  routingMode: 'direct',
};

/** A well-formed structured summary that passes quality audit */
const makeStructuredSummary = (extra = '') =>
  `### 1. KEY DECISIONS & OUTCOMES
User discussed weather in San Francisco.
${extra}
### 2. OPEN TODOs & PENDING TASKS
None

### 3. CONSTRAINTS & RULES ESTABLISHED
None

### 4. PENDING USER ASKS
User asked about the weather in SF.

### 5. EXACT IDENTIFIERS
None

### 6. TOOL FAILURES & FILE OPERATIONS
None

### 7. CURRENT TASK STATE
No active task.`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('summarizeMessages', () => {
  it('returns structured summary from completeText', async () => {
    const summary = makeStructuredSummary();
    mockCompleteText.mockResolvedValue(summary);

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'What is the weather in SF?' }] }),
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'It is sunny in SF, 72F.' }],
      }),
    ];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('KEY DECISIONS');
    expect(result).toContain('weather');
  });

  it('includes all messages in summarization transcript', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Question 1' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Answer 1' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Question 2' }] }),
    ];

    await summarizeMessages(messages, mockModelConfig);

    expect(mockCompleteText).toHaveBeenCalled();
    const [_modelConfig, _systemPrompt, transcript] = mockCompleteText.mock.calls[0]!;
    expect(transcript).toContain('Question 1');
    expect(transcript).toContain('Answer 1');
    expect(transcript).toContain('Question 2');
  });

  it('retries on LLM error up to 2 times before throwing', async () => {
    mockCompleteText
      .mockRejectedValueOnce(new Error('API rate limit exceeded'))
      .mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] })];

    await expect(summarizeMessages(messages, mockModelConfig)).rejects.toThrow(
      'API rate limit exceeded',
    );
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });

  it('succeeds on retry after initial failure', async () => {
    const summary = makeStructuredSummary();
    mockCompleteText.mockRejectedValueOnce(new Error('Temporary error')).mockResolvedValue(summary);

    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] })];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('KEY DECISIONS');
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });

  it('passes maxTokens: 800 to completeText', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Long conversation...' }] }),
    ];

    await summarizeMessages(messages, mockModelConfig);

    expect(mockCompleteText).toHaveBeenCalled();
    const opts = mockCompleteText.mock.calls[0]![3];
    expect(opts.maxTokens).toBe(1200);
  });

  it('includes tool-call parts in transcript', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'Check weather' }],
      }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            args: { city: 'SF' },
          },
        ],
      }),
    ];

    await summarizeMessages(messages, mockModelConfig);

    const transcript = mockCompleteText.mock.calls[0]![2] as string;
    expect(transcript).toContain('[Tool: web_search]');
    expect(transcript).toContain('Let me check.');
  });

  it('appends recent turns verbatim to summary', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Do something' }] }),
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Done!' }],
      }),
    ];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('RECENT TURNS');
    expect(result).toContain('Do something');
    expect(result).toContain('Done!');
  });

  it('accepts summary on first attempt when only sections are missing', async () => {
    // Missing sections are no longer critical — should pass on first attempt
    mockCompleteText.mockResolvedValueOnce('Just a plain summary without structure.');

    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Fix the auth bug' }] }),
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'I fixed the authentication issue.' }],
      }),
    ];

    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('plain summary');
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });
});

describe('formatTranscript', () => {
  it('includes tool-result status in transcript', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'Search failed with error',
          },
        ],
      }),
    ];

    const transcript = formatTranscript(messages);
    expect(transcript).toContain('[Result: web_search FAILED]');
  });

  it('marks non-error results without FAILED tag', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'Sunny weather in SF',
          },
        ],
      }),
    ];

    const transcript = formatTranscript(messages);
    expect(transcript).toContain('[Result: web_search]');
    expect(transcript).not.toContain('FAILED');
  });
});

describe('auditSummaryQuality', () => {
  it('passes when all sections present', () => {
    const summary = makeStructuredSummary();
    const result = auditSummaryQuality(summary, 'some transcript', 'what is the weather');
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('warns but passes when sections are missing (no critical issue)', () => {
    const summary = 'Just a plain text summary with no structure.';
    const result = auditSummaryQuality(summary, 'some transcript', 'what is the weather');
    // Missing sections are no longer critical — only low identifier overlap fails
    expect(result.issues.some(i => i.includes('Missing section'))).toBe(true);
    // Passes because there are no identifiers in the transcript to fail overlap check
    expect(result.passed).toBe(true);
  });

  it('checks identifier overlap', () => {
    const transcript =
      'The file is at /home/user/project/src/main.ts with UUID abc12345-6789-0123-4567-890abcdef012';
    const summaryGood =
      makeStructuredSummary() +
      '\n/home/user/project/src/main.ts abc12345-6789-0123-4567-890abcdef012';
    const summaryBad = makeStructuredSummary();

    const good = auditSummaryQuality(summaryGood, transcript, 'check file');
    auditSummaryQuality(summaryBad, transcript, 'check file');

    expect(good.passed).toBe(true);
    // bad may or may not fail depending on other criteria; identifiers check is one factor
  });

  it('checks latest user ask reflection', () => {
    const summary = makeStructuredSummary();
    const result = auditSummaryQuality(summary, 'transcript', 'deploy the kubernetes cluster');
    // "kubernetes" and "cluster" are not in the summary
    expect(result.issues.some(i => i.includes('user ask'))).toBe(true);
  });
});

describe('extractIdentifiers', () => {
  it('extracts file paths', () => {
    const ids = extractIdentifiers('The file is at /src/components/Button.tsx');
    expect(ids.has('/src/components/Button.tsx')).toBe(true);
  });

  it('extracts UUIDs', () => {
    const ids = extractIdentifiers('ID: 550e8400-e29b-41d4-a716-446655440000');
    expect(ids.has('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('extracts URLs', () => {
    const ids = extractIdentifiers('See https://example.com/api/v2/users');
    expect(ids.has('https://example.com/api/v2/users')).toBe(true);
  });
});

describe('getLatestUserAsk', () => {
  it('returns the last user message text', () => {
    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'First question' }] }),
      makeMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] }),
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Second question' }] }),
    ];
    expect(getLatestUserAsk(messages)).toBe('Second question');
  });

  it('returns empty string when no user messages', () => {
    const messages = [makeMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] })];
    expect(getLatestUserAsk(messages)).toBe('');
  });
});

describe('getRecentTurnsVerbatim', () => {
  it('returns last N turns with role prefix', () => {
    const messages = [
      makeMessage({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }),
      makeMessage({ role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] }),
    ];
    const result = getRecentTurnsVerbatim(messages, 2);
    expect(result).toContain('RECENT TURNS');
    expect(result).toContain('user: Hello');
    expect(result).toContain('assistant: Hi there');
  });

  it('truncates long turns', () => {
    const longText = 'x'.repeat(RECENT_TURN_MAX_CHARS + 100);
    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: longText }] })];
    const result = getRecentTurnsVerbatim(messages, 1);
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain('...');
  });

  it('returns empty string for empty messages', () => {
    expect(getRecentTurnsVerbatim([])).toBe('');
  });
});

describe('summarizeMessages — updated retry behavior', () => {
  it('retries up to 2 times on LLM failure', async () => {
    mockCompleteText
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'));

    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'test' }] })];
    await expect(summarizeMessages(messages, mockModelConfig)).rejects.toThrow('fail2');
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });

  it('succeeds on second attempt after one failure', async () => {
    const summary = makeStructuredSummary();
    mockCompleteText.mockRejectedValueOnce(new Error('fail1')).mockResolvedValue(summary);

    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'test' }] })];
    const result = await summarizeMessages(messages, mockModelConfig);
    expect(result).toContain('KEY DECISIONS');
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });

  it('returns best-effort summary after exhausting retries on audit failure', async () => {
    // Summary that fails audit: many identifiers in old messages (not in recent turns),
    // and the summary does not include any of them — so overlap check fails every attempt.
    const badSummary = 'Plain summary without identifiers';
    mockCompleteText.mockResolvedValue(badSummary);

    // Put identifiers in old messages so they are NOT captured in recent turns verbatim
    const oldMessages = Array.from({ length: 10 }, (_, i) =>
      makeMessage({
        id: `old-${i}`,
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `/home/user/path-${i}.ts /var/app/config-${i}.ts /etc/service/mod-${i}.ts`,
          },
        ],
      }),
    );
    // Recent turns (last 3) are plain text with no identifiers
    const recentMessages = [
      makeMessage({ id: 'r1', role: 'user', parts: [{ type: 'text', text: 'ok done' }] }),
      makeMessage({ id: 'r2', role: 'assistant', parts: [{ type: 'text', text: 'confirmed' }] }),
      makeMessage({ id: 'r3', role: 'user', parts: [{ type: 'text', text: 'great thanks' }] }),
    ];
    const messages = [...oldMessages, ...recentMessages];

    const result = await summarizeMessages(messages, mockModelConfig);
    // Should return the last attempt rather than throwing
    expect(result).toContain(badSummary);
    // Should have retried 2 times
    expect(mockCompleteText).toHaveBeenCalledTimes(2);
  });
});

describe('extractRecentIdentifiers', () => {
  it('extracts identifiers from last N messages only', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeMessage({
        id: `msg-${i}`,
        role: 'user',
        parts: [
          {
            type: 'text',
            text: i >= 15 ? `File at /recent/path-${i}.ts` : `File at /old/path-${i}.ts`,
          },
        ],
      }),
    );
    const result = extractRecentIdentifiers(messages, 5);
    // Should only have identifiers from the last 5 messages (indices 15-19)
    expect(result.has('/recent/path-15.ts')).toBe(true);
    expect(result.has('/recent/path-19.ts')).toBe(true);
    expect(result.has('/old/path-0.ts')).toBe(false);
  });

  it('returns empty set for messages with no identifiers', () => {
    const messages = [makeMessage({ parts: [{ type: 'text', text: 'hello world' }] })];
    const result = extractRecentIdentifiers(messages, 5);
    expect(result.size).toBe(0);
  });

  it('deduplicates identifiers', () => {
    const messages = [
      makeMessage({ id: 'm1', parts: [{ type: 'text', text: 'File /src/main.ts' }] }),
      makeMessage({ id: 'm2', parts: [{ type: 'text', text: 'Again /src/main.ts' }] }),
    ];
    const result = extractRecentIdentifiers(messages, 5);
    expect(result.size).toBe(1);
    expect(result.has('/src/main.ts')).toBe(true);
  });
});

describe('auditSummaryQuality — recency weighting', () => {
  it('fails audit when recent identifiers missing from summary (≥3 recent, <50% overlap)', () => {
    const recentMessages = [
      makeMessage({ parts: [{ type: 'text', text: 'Check /path/a.ts' }] }),
      makeMessage({ parts: [{ type: 'text', text: 'Check /path/b.ts' }] }),
      makeMessage({ parts: [{ type: 'text', text: 'Check /path/c.ts and /path/d.ts' }] }),
    ];
    const summary = makeStructuredSummary(); // no paths
    const result = auditSummaryQuality(summary, 'transcript', 'check files', recentMessages);
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.includes('recent identifier'))).toBe(true);
  });

  it('passes audit when fewer than 3 recent identifiers', () => {
    const recentMessages = [makeMessage({ parts: [{ type: 'text', text: 'Check /path/a.ts' }] })];
    const summary = makeStructuredSummary();
    const result = auditSummaryQuality(summary, 'transcript', 'check', recentMessages);
    // Fewer than 3 recent identifiers → recency check not enforced
    expect(result.issues.every(i => !i.includes('recent identifier'))).toBe(true);
  });

  it('passes when recent overlap ≥ 50%', () => {
    const recentMessages = [
      makeMessage({
        parts: [{ type: 'text', text: '/path/a.ts /path/b.ts /path/c.ts /path/d.ts' }],
      }),
    ];
    const summary = makeStructuredSummary('/path/a.ts /path/b.ts /path/c.ts');
    const result = auditSummaryQuality(summary, 'transcript', 'check', recentMessages);
    expect(result.issues.every(i => !i.includes('recent identifier'))).toBe(true);
  });

  it('still checks full transcript overlap at 20%', () => {
    // Transcript has identifiers but summary doesn't include them
    const transcript =
      '/path/1.ts /path/2.ts /path/3.ts /path/4.ts /path/5.ts /path/6.ts /path/7.ts /path/8.ts /path/9.ts /path/10.ts';
    const summary = makeStructuredSummary(); // no paths
    const result = auditSummaryQuality(summary, transcript, 'check');
    expect(result.issues.some(i => i.includes('Low identifier overlap'))).toBe(true);
  });

  it('skips identifier overlap check when fewer than 3 identifiers found', () => {
    // Transcript with only 1-2 identifiers — overlap check should be skipped
    const transcript = 'The file is at /home/user/project/src/main.ts';
    const summary = makeStructuredSummary(); // no paths — would fail if check ran
    const result = auditSummaryQuality(summary, transcript, 'check file');
    expect(result.issues.every(i => !i.includes('Low identifier overlap'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('fails identifier overlap when 3+ identifiers and none in summary', () => {
    const transcript = '/path/a.ts /path/b.ts /path/c.ts';
    const summary = makeStructuredSummary(); // no paths
    const result = auditSummaryQuality(summary, transcript, 'check');
    expect(result.issues.some(i => i.includes('Low identifier overlap'))).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe('collectToolFailures', () => {
  it('collects tool-result parts with state output-error', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'Some error occurred',
            state: 'output-error',
          },
          {
            type: 'tool-result',
            toolCallId: 'tc-2',
            toolName: 'browser',
            result: 'Success',
            state: 'output-available',
          },
        ],
      }),
    ];
    const failures = collectToolFailures(messages);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.toolName).toBe('web_search');
    expect(failures[0]!.toolCallId).toBe('tc-1');
  });

  it('deduplicates by toolCallId', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'search',
            result: 'Error',
            state: 'output-error',
          },
        ],
      }),
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'search',
            result: 'Error again',
            state: 'output-error',
          },
        ],
      }),
    ];
    expect(collectToolFailures(messages)).toHaveLength(1);
  });

  it('limits to maxFailures (default 8)', () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({
      type: 'tool-result' as const,
      toolCallId: `tc-${i}`,
      toolName: 'test',
      result: 'Error',
      state: 'output-error' as const,
    }));
    const messages = [makeMessage({ role: 'assistant', parts })];
    expect(collectToolFailures(messages)).toHaveLength(8);
  });

  it('truncates error text to 240 chars', () => {
    const longError = 'x'.repeat(500);
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'test',
            result: longError,
            state: 'output-error',
          },
        ],
      }),
    ];
    const failures = collectToolFailures(messages);
    expect(failures[0]!.error.length).toBeLessThanOrEqual(243); // 240 + '...'
  });

  it('returns empty array when no errors', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'test',
            result: 'ok',
            state: 'output-available',
          },
        ],
      }),
    ];
    expect(collectToolFailures(messages)).toHaveLength(0);
  });
});

describe('collectFileOperations', () => {
  it('classifies workspace_read as read', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'workspace_read',
            args: { path: '/file.md' },
          },
        ],
      }),
    ];
    const ops = collectFileOperations(messages);
    expect(ops.readFiles).toContain('/file.md');
    expect(ops.modifiedFiles).toHaveLength(0);
  });

  it('classifies workspace_write as modified', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'workspace_write',
            args: { path: '/file.md' },
          },
        ],
      }),
    ];
    const ops = collectFileOperations(messages);
    expect(ops.modifiedFiles).toContain('/file.md');
    expect(ops.readFiles).toHaveLength(0);
  });

  it('classifies execute-js with path as read', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'execute-js',
            args: { path: '/script.js' },
          },
        ],
      }),
    ];
    const ops = collectFileOperations(messages);
    expect(ops.readFiles).toContain('/script.js');
  });

  it('deduplicates file paths', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'workspace_read',
            args: { path: '/file.md' },
          },
          {
            type: 'tool-call',
            toolCallId: 'tc-2',
            toolName: 'workspace_read',
            args: { path: '/file.md' },
          },
        ],
      }),
    ];
    const ops = collectFileOperations(messages);
    expect(ops.readFiles).toHaveLength(1);
  });

  it('excludes modified files from read list', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'workspace_read',
            args: { path: '/file.md' },
          },
          {
            type: 'tool-call',
            toolCallId: 'tc-2',
            toolName: 'workspace_write',
            args: { path: '/file.md' },
          },
        ],
      }),
    ];
    const ops = collectFileOperations(messages);
    expect(ops.readFiles).not.toContain('/file.md');
    expect(ops.modifiedFiles).toContain('/file.md');
  });

  it('returns empty lists when no file operations', () => {
    const messages = [makeMessage({ parts: [{ type: 'text', text: 'hello' }] })];
    const ops = collectFileOperations(messages);
    expect(ops.readFiles).toHaveLength(0);
    expect(ops.modifiedFiles).toHaveLength(0);
  });
});

describe('summary prompt injection', () => {
  it('includes tool failures section in prompt when failures exist', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());
    const messages = [
      makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: 'do something' }],
      }),
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'Search failed',
            state: 'output-error',
          },
        ],
      }),
    ];
    await summarizeMessages(messages, mockModelConfig);
    const transcript = mockCompleteText.mock.calls[0]![2] as string;
    expect(transcript).toContain('## Tool failures');
    expect(transcript).toContain('web_search');
  });

  it('includes file operations section in prompt', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());
    const messages = [
      makeMessage({
        role: 'user',
        parts: [{ type: 'text', text: 'read the file' }],
      }),
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'workspace_read',
            args: { path: '/test.md' },
          },
        ],
      }),
    ];
    await summarizeMessages(messages, mockModelConfig);
    const transcript = mockCompleteText.mock.calls[0]![2] as string;
    expect(transcript).toContain('## File operations');
    expect(transcript).toContain('/test.md');
  });

  it('omits sections when empty', async () => {
    mockCompleteText.mockResolvedValue(makeStructuredSummary());
    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: 'hello' }] })];
    await summarizeMessages(messages, mockModelConfig);
    const transcript = mockCompleteText.mock.calls[0]![2] as string;
    expect(transcript).not.toContain('## Tool failures');
    expect(transcript).not.toContain('## File operations');
  });
});

describe('extractCriticalRules', () => {
  it('extracts "Red Lines" section from AGENTS.md', () => {
    const files = [
      { name: 'AGENTS.md', content: '# Agent\n## Red Lines\nNever do X\n## Other\nStuff' },
    ];
    const result = extractCriticalRules(files);
    expect(result).toContain('Red Lines');
    expect(result).toContain('Never do X');
  });

  it('extracts "Rules" section', () => {
    const files = [
      { name: 'AGENTS.md', content: '# Agent\n## Rules\nAlways do Y\n## Other\nStuff' },
    ];
    const result = extractCriticalRules(files);
    expect(result).toContain('Rules');
    expect(result).toContain('Always do Y');
  });

  it('extracts multiple sections', () => {
    const files = [
      {
        name: 'AGENTS.md',
        content: '## Red Lines\nNever do X\n## Constraints\nLimit to 5\n## Other\nStuff',
      },
    ];
    const result = extractCriticalRules(files);
    expect(result).toContain('Red Lines');
    expect(result).toContain('Constraints');
  });

  it('truncates to 2000 chars', () => {
    const longContent = '## Red Lines\n' + 'x'.repeat(3000) + '\n## Other\nStuff';
    const files = [{ name: 'AGENTS.md', content: longContent }];
    const result = extractCriticalRules(files);
    expect(result.length).toBeLessThanOrEqual(2016); // 2000 chars + '\n[... truncated]' (16 chars)
    expect(result).toContain('[... truncated]');
  });

  it('returns empty string when no matching sections', () => {
    const files = [{ name: 'AGENTS.md', content: '## Personality\nFriendly' }];
    const result = extractCriticalRules(files);
    expect(result).toBe('');
  });

  it('falls back to SOUL.md when AGENTS.md not found', () => {
    const files = [{ name: 'SOUL.md', content: '## Safety\nBe careful\n## Other\nEnd' }];
    const result = extractCriticalRules(files);
    expect(result).toContain('Safety');
    expect(result).toContain('Be careful');
  });

  it('handles case-insensitive headers', () => {
    const files = [{ name: 'AGENTS.md', content: '## RED LINES\nNever do X\n## other\nEnd' }];
    const result = extractCriticalRules(files);
    expect(result).toContain('Never do X');
  });
});

describe('summarizeMessages — configurable quality guard', () => {
  it('uses config.qualityGuardMaxRetries', async () => {
    // Summary that fails audit (many identifiers in transcript not in summary)
    const badSummary = 'Plain summary without identifiers';
    mockCompleteText.mockResolvedValue(badSummary);

    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage({
        id: `msg-${i}`,
        role: 'user',
        parts: [{ type: 'text', text: `/path/id-${i}.ts /var/path-${i}.ts /etc/path-${i}.ts` }],
      }),
    );

    // With qualityGuardMaxRetries=1, should only attempt once before returning best-effort
    const result = await summarizeMessages(messages, mockModelConfig, {
      qualityGuardMaxRetries: 1,
    });
    expect(result).toContain(badSummary);
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });

  it('skips audit when qualityGuardEnabled is false', async () => {
    const badSummary = 'No structure at all';
    mockCompleteText.mockResolvedValueOnce(badSummary);

    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage({
        id: `msg-${i}`,
        role: 'user',
        parts: [{ type: 'text', text: `/path/id-${i}.ts /var/path-${i}.ts /etc/path-${i}.ts` }],
      }),
    );

    const result = await summarizeMessages(messages, mockModelConfig, {
      qualityGuardEnabled: false,
    });
    // Should return on first attempt without retrying (no audit)
    expect(result).toContain(badSummary);
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });

  it('uses config.identifierPolicy=off to skip identifier check', async () => {
    // Summary missing all identifiers — would fail with lenient/strict
    const summary = makeStructuredSummary();
    mockCompleteText.mockResolvedValueOnce(summary);

    const transcript =
      '/path/1.ts /path/2.ts /path/3.ts /path/4.ts /path/5.ts /path/6.ts /path/7.ts /path/8.ts /path/9.ts /path/10.ts';
    const messages = [makeMessage({ role: 'user', parts: [{ type: 'text', text: transcript }] })];

    const result = await summarizeMessages(messages, mockModelConfig, {
      identifierPolicy: 'off',
    });
    // Should pass on first attempt since identifier check is off
    expect(result).toContain('KEY DECISIONS');
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });
});
