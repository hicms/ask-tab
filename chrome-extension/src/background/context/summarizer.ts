import {
  shouldUseAdaptiveCompaction,
  computePartCount,
  splitMessagesByTokenShare,
} from './adaptive-compaction';
import { completeText } from '../agents/stream-bridge';
import { createLogger } from '../logging/logger-buffer';
import type { ChatMessage, ChatModel } from '@extension/shared';

const summarizerLog = createLogger('stream');

// ── Structured summarization prompt ─────────────

const SUMMARY_PROMPT = `Summarize this conversation history into the following structured sections. Be thorough and precise — this summary will REPLACE the original messages.

## Required Sections

### 1. KEY DECISIONS & OUTCOMES
List all decisions made, conclusions reached, and outcomes of tool calls. Include specific results.

### 2. OPEN TODOs & PENDING TASKS
List any tasks that were started but not completed, or explicitly mentioned as next steps.

### 3. CONSTRAINTS & RULES ESTABLISHED
Any rules, constraints, preferences, or conventions the user specified during the conversation.

### 4. PENDING USER ASKS
What was the user's most recent request or question? What are they waiting for?

### 5. EXACT IDENTIFIERS
Preserve ALL of the following verbatim (do not paraphrase):
- File paths, URLs, API endpoints
- UUIDs, IDs, hashes, version numbers
- Variable names, function names, class names
- Configuration keys and values
- Error messages and error codes

### 6. TOOL FAILURES & FILE OPERATIONS
- List any tool calls that failed, with the error message
- List files that were read, created, or modified

### 7. CURRENT TASK STATE
What is the assistant actively working on right now? Include:
- The specific task or sub-task in progress
- Key state/data accumulated (tab IDs, file paths, variable values, URLs)
- What the next planned step was before this summary
- Any blocking issues or failed approaches already tried

## Rules
- If a section has no content, write "None" — do not omit the section
- Prefer exact quotes over paraphrasing for technical content
- The CURRENT TASK STATE section is critical — prioritize it over older history
- Keep the total summary under 1200 tokens`;

const MERGE_PROMPT = `You are given multiple partial summaries of a single conversation. Merge them into one cohesive structured summary using the same section format.

## Required Sections
1. KEY DECISIONS & OUTCOMES
2. OPEN TODOs & PENDING TASKS
3. CONSTRAINTS & RULES ESTABLISHED
4. PENDING USER ASKS
5. EXACT IDENTIFIERS
6. TOOL FAILURES & FILE OPERATIONS
7. CURRENT TASK STATE

## Rules
- Merge overlapping content, removing duplicates
- Preserve all exact identifiers from all parts
- If sections conflict, prefer the later part (more recent)
- The CURRENT TASK STATE section is critical — take it from the latest part
- Keep the total under 1200 tokens
- Do not add information not present in the partial summaries`;

/** Max chars per recent turn to embed verbatim in the summary */
const RECENT_TURN_MAX_CHARS = 600;

/** Number of recent turns to preserve verbatim */
const RECENT_TURNS_TO_PRESERVE = 3;

/** Max summarization retry attempts */
const MAX_SUMMARY_RETRIES = 2;

/** Base delay for retry backoff (ms) */
const RETRY_BASE_DELAY_MS = 500;

/** Max delay cap for retry backoff (ms) */
const RETRY_MAX_DELAY_MS = 5000;

// ── Quality audit ───────────────────────────────

/** Preferred section headers — missing sections warn but don't fail the audit */
const PREFERRED_SECTIONS = [
  'KEY DECISIONS',
  'OPEN TODO',
  'CONSTRAINTS',
  'PENDING USER',
  'EXACT IDENTIFIERS',
  'TOOL FAILURES',
  'CURRENT TASK STATE',
];

/**
 * Extract identifiers from text: file paths, UUIDs, URLs, function names, etc.
 */
const extractIdentifiers = (text: string): Set<string> => {
  const identifiers = new Set<string>();

  // File paths (Unix and Windows)
  const paths = text.match(/(?:\/[\w.-]+){2,}|(?:[A-Z]:\\[\w.-\\]+)/g);
  if (paths) paths.forEach(p => identifiers.add(p));

  // UUIDs
  const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (uuids) uuids.forEach(u => identifiers.add(u.toLowerCase()));

  // URLs
  const urls = text.match(/https?:\/\/[^\s)>"']+/g);
  if (urls) urls.forEach(u => identifiers.add(u));

  // Error codes (e.g., E1234, ERR_NOT_FOUND)
  const errors = text.match(/\b(?:ERR_[A-Z_]+|E\d{4,}|[A-Z][A-Z0-9_]{3,}Error)\b/g);
  if (errors) errors.forEach(e => identifiers.add(e));

  return identifiers;
};

interface QualityAuditResult {
  passed: boolean;
  issues: string[];
}

/**
 * Validate a summary against quality criteria.
 * Missing sections are warned but don't cause failure.
 * Only critically low identifier overlap causes failure.
 */
const auditSummaryQuality = (
  summary: string,
  transcript: string,
  latestUserAsk: string,
  recentMessages?: ChatMessage[],
  identifierPolicy: 'strict' | 'lenient' | 'off' = 'lenient',
): QualityAuditResult => {
  const issues: string[] = [];
  const upperSummary = summary.toUpperCase();

  // Sections are preferred but not required — only warn
  const missingSections = PREFERRED_SECTIONS.filter(s => !upperSummary.includes(s));
  if (missingSections.length > 0) {
    issues.push(`Missing section: ${missingSections.join(', ')}`);
  }

  // Identifier overlap check — controlled by identifierPolicy
  if (identifierPolicy !== 'off') {
    const overlapThreshold = identifierPolicy === 'strict' ? 0.5 : 0.2;
    const sourceIds = extractIdentifiers(transcript);
    if (sourceIds.size >= 3) {
      const summaryIds = extractIdentifiers(summary);
      let overlapCount = 0;
      for (const id of sourceIds) {
        if (summaryIds.has(id) || summary.includes(id)) overlapCount++;
      }
      const overlapRatio = overlapCount / sourceIds.size;
      if (overlapRatio < overlapThreshold) {
        summarizerLog.trace('Quality audit: identifier overlap failure', {
          sourceIds: [...sourceIds].slice(0, 10),
          summaryIds: [...summaryIds].slice(0, 10),
          overlapCount,
          total: sourceIds.size,
        });
        issues.push(
          `Low identifier overlap: ${overlapCount}/${sourceIds.size} (${Math.round(overlapRatio * 100)}%)`,
        );
      }
    }

    // Recency-weighted identifier check
    if (recentMessages && recentMessages.length > 0) {
      const recentIds = extractIdentifiers(formatTranscript(recentMessages));
      if (recentIds.size >= 3) {
        let recentOverlap = 0;
        for (const id of recentIds) {
          if (summary.includes(id)) recentOverlap++;
        }
        const recentOverlapRatio = recentOverlap / recentIds.size;
        if (recentOverlapRatio < 0.5) {
          issues.push(
            `Low recent identifier overlap: ${recentOverlap}/${recentIds.size} (${Math.round(recentOverlapRatio * 100)}%)`,
          );
        }
      }
    }
  }

  // Check that the latest user ask is reflected
  if (latestUserAsk.length > 10) {
    const askTerms =
      latestUserAsk
        .toLowerCase()
        .match(/[a-z0-9_]+/g)
        ?.filter(t => t.length >= 3) ?? [];
    const matchedTerms = askTerms.filter(t => summary.toLowerCase().includes(t));
    if (askTerms.length > 0 && matchedTerms.length < Math.min(2, askTerms.length)) {
      issues.push('Latest user ask not reflected in summary');
    }
  }

  // Pass if no critical issue (low identifier overlap or low recent identifier overlap)
  const hasCriticalIssue = issues.some(
    i => i.startsWith('Low identifier') || i.startsWith('Low recent identifier'),
  );
  return { passed: !hasCriticalIssue, issues };
};

// ── Transcript formatting ───────────────────────

/**
 * Format messages into a readable transcript for summarization.
 * Includes tool-call names, tool-result status, and failure indicators.
 */
const formatTranscript = (messages: ChatMessage[]): string =>
  messages
    .map(m => {
      const textParts = m.parts
        .filter(p => p.type === 'text')
        .map(p => (p as { type: 'text'; text: string }).text)
        .join('');
      const toolParts = m.parts
        .filter(p => p.type === 'tool-call')
        .map(p => `[Tool: ${(p as { type: 'tool-call'; toolName: string }).toolName}]`)
        .join(' ');
      const toolResults = m.parts
        .filter(p => p.type === 'tool-result')
        .map(p => {
          const tr = p as { type: 'tool-result'; toolName: string; result: unknown };
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
          const isError =
            resultStr.toLowerCase().includes('error') || resultStr.toLowerCase().includes('failed');
          return `[Result: ${tr.toolName}${isError ? ' FAILED' : ''}]`;
        })
        .join(' ');
      const content = [textParts, toolParts, toolResults].filter(Boolean).join(' ');
      return `${m.role}: ${content}`;
    })
    .join('\n');

/**
 * Extract identifiers from the last N messages only (recency-weighted).
 */
const extractRecentIdentifiers = (messages: ChatMessage[], count = 10): Set<string> => {
  const recent = messages.slice(-count);
  return extractIdentifiers(formatTranscript(recent));
};

/**
 * Extract the latest user ask from messages (searching from the end).
 */
const getLatestUserAsk = (messages: ChatMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user') {
      return msg.parts
        .filter(p => p.type === 'text')
        .map(p => (p as { type: 'text'; text: string }).text)
        .join(' ');
    }
  }
  return '';
};

/**
 * Get recent turns as verbatim text for preservation across compaction.
 * Returns the last N turns, each truncated to RECENT_TURN_MAX_CHARS.
 */
const getRecentTurnsVerbatim = (
  messages: ChatMessage[],
  count: number = RECENT_TURNS_TO_PRESERVE,
): string => {
  const recent = messages.slice(-count);
  if (recent.length === 0) return '';

  const lines = recent.map(m => {
    const text = m.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join(' ');
    const truncated =
      text.length > RECENT_TURN_MAX_CHARS ? text.slice(0, RECENT_TURN_MAX_CHARS) + '...' : text;
    return `${m.role}: ${truncated}`;
  });

  return '\n\n## RECENT TURNS (verbatim)\n' + lines.join('\n');
};

// ── Retry with backoff ──────────────────────────

/**
 * Sleep with exponential backoff + jitter.
 */
const backoffDelay = (attempt: number): Promise<void> => {
  const cappedDelay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
  const jitter = Math.random() * cappedDelay * 0.3;
  return new Promise(resolve => setTimeout(resolve, cappedDelay + jitter));
};

// ── Tool failure collection ─────────────────────

interface ToolFailure {
  toolCallId: string;
  toolName: string;
  error: string;
}

/**
 * Collect tool failures from messages (tool-result parts with state === 'output-error').
 * Deduplicates by toolCallId and limits to maxFailures.
 */
const collectToolFailures = (messages: ChatMessage[], maxFailures = 8): ToolFailure[] => {
  const seen = new Set<string>();
  const failures: ToolFailure[] = [];

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool-result' && part.state === 'output-error') {
        const toolCallId = part.toolCallId;
        if (seen.has(toolCallId)) continue;
        seen.add(toolCallId);

        const resultStr =
          typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
        const truncated = resultStr.length > 240 ? resultStr.slice(0, 240) + '...' : resultStr;

        failures.push({
          toolCallId,
          toolName: part.toolName,
          error: truncated,
        });

        if (failures.length >= maxFailures) return failures;
      }
    }
  }

  return failures;
};

/**
 * Format tool failures as a markdown section for prepending to transcript.
 */
const formatToolFailures = (failures: ToolFailure[]): string => {
  if (failures.length === 0) return '';
  const lines = failures.map(f => `- **${f.toolName}** (${f.toolCallId}): ${f.error}`);
  return `## Tool failures\n${lines.join('\n')}\n\n`;
};

// ── File operations tracking ────────────────────

/**
 * Collect file operations from tool-call parts in messages.
 * Classifies workspace/document tool calls as read or modified.
 */
const collectFileOperations = (
  messages: ChatMessage[],
): { readFiles: string[]; modifiedFiles: string[] } => {
  const readSet = new Set<string>();
  const modifiedSet = new Set<string>();

  const READ_TOOLS = ['workspace_read', 'document_read'];
  const MODIFY_TOOLS = [
    'workspace_write',
    'workspace_create',
    'workspace_update',
    'document_write',
    'document_create',
    'document_update',
  ];

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== 'tool-call') continue;

      const toolName = part.toolName;
      const args = part.args as Record<string, unknown>;
      const path =
        ([args.path, args.file, args.filename].find(v => typeof v === 'string') as string) ?? '';

      if (READ_TOOLS.includes(toolName) && path) {
        readSet.add(path);
      } else if (MODIFY_TOOLS.includes(toolName) && path) {
        modifiedSet.add(path);
      } else if (toolName === 'execute-js' && path) {
        readSet.add(path);
      }
    }
  }

  // Exclude modified files from read list
  for (const f of modifiedSet) {
    readSet.delete(f);
  }

  return {
    readFiles: [...readSet].sort(),
    modifiedFiles: [...modifiedSet].sort(),
  };
};

/**
 * Format file operations as a markdown section for prepending to transcript.
 */
const formatFileOperations = (ops: { readFiles: string[]; modifiedFiles: string[] }): string => {
  if (ops.readFiles.length === 0 && ops.modifiedFiles.length === 0) return '';
  const lines: string[] = ['## File operations'];
  if (ops.readFiles.length > 0) lines.push(`Read: ${ops.readFiles.join(', ')}`);
  if (ops.modifiedFiles.length > 0) lines.push(`Modified: ${ops.modifiedFiles.join(', ')}`);
  return lines.join('\n') + '\n\n';
};

// ── Workspace critical rules extraction ─────────

/**
 * Extract critical rules sections from workspace files (AGENTS.md or SOUL.md fallback).
 * Looks for headers: Red Lines, Session Startup, Rules, Constraints, Safety.
 */
const extractCriticalRules = (workspaceFiles: Array<{ name: string; content: string }>): string => {
  // Find AGENTS.md first, then SOUL.md as fallback
  const target =
    workspaceFiles.find(f => f.name === 'AGENTS.md') ??
    workspaceFiles.find(f => f.name === 'SOUL.md');
  if (!target) return '';

  const content = target.content;
  // Match sections with headers: Red Lines, Session Startup, Rules, Constraints, Safety
  const sectionPattern =
    /^##\s+(Red Lines|Session Startup|Rules|Constraints|Safety)\b[^\n]*\n([\s\S]*?)(?=^##\s|$)/gim;
  const sections: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = sectionPattern.exec(content)) !== null) {
    sections.push(`## ${match[1]}\n${match[2]!.trim()}`);
  }

  const combined = sections.join('\n\n');
  if (combined.length === 0) return '';
  if (combined.length > 2000) return combined.slice(0, 2000) + '\n[... truncated]';
  return combined;
};

// ── Summarization functions ─────────────────────

/** Max chars for the LLM-generated summary (before appending recent turns) */
const MAX_SUMMARY_CHARS = 8000;

/** Timeout for the entire summarization process (ms) */
const SUMMARIZATION_TIMEOUT_MS = 120_000;

/**
 * Internal implementation of summarizeMessages with quality audit and retry.
 */
interface SummarizerOptions {
  criticalRules?: string;
  qualityGuardEnabled?: boolean;
  qualityGuardMaxRetries?: number;
  identifierPolicy?: 'strict' | 'lenient' | 'off';
}

const summarizeMessagesImpl = async (
  messages: ChatMessage[],
  modelConfig: ChatModel,
  options: SummarizerOptions = {},
): Promise<string> => {
  const {
    criticalRules,
    qualityGuardEnabled = true,
    qualityGuardMaxRetries = MAX_SUMMARY_RETRIES,
    identifierPolicy = 'lenient',
  } = options;

  const maxRetries = qualityGuardEnabled ? qualityGuardMaxRetries : MAX_SUMMARY_RETRIES;

  const transcript = formatTranscript(messages);
  const latestUserAsk = getLatestUserAsk(messages);
  const recentTurns = getRecentTurnsVerbatim(messages);
  const recentMessages = messages.slice(-10);

  // Collect tool failures and file operations to prepend to transcript
  const toolFailures = collectToolFailures(messages);
  const fileOps = collectFileOperations(messages);
  const criticalRulesPrefix = criticalRules
    ? `<workspace-critical-rules>\n${criticalRules}\n</workspace-critical-rules>\n\n`
    : '';
  const enrichedTranscript =
    criticalRulesPrefix +
    formatToolFailures(toolFailures) +
    formatFileOperations(fileOps) +
    transcript;

  let lastSummary = '';
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await backoffDelay(attempt - 1);
      summarizerLog.trace('summarizeMessages: retry', { attempt, issues: lastIssues });
    }

    try {
      const prompt =
        attempt > 0
          ? `${SUMMARY_PROMPT}\n\nIMPORTANT: Your previous summary had these issues:\n${lastIssues.map(i => `- ${i}`).join('\n')}\nPlease fix them.`
          : SUMMARY_PROMPT;

      lastSummary = await completeText(modelConfig, prompt, enrichedTranscript, {
        maxTokens: 1200,
      });

      // Cap LLM output before appending recent turns
      if (lastSummary.length > MAX_SUMMARY_CHARS) {
        lastSummary = lastSummary.slice(0, MAX_SUMMARY_CHARS);
      }

      // Append recent turns verbatim
      lastSummary += recentTurns;

      // Quality audit with recency check (skip if disabled)
      if (!qualityGuardEnabled) {
        return lastSummary;
      }

      const audit = auditSummaryQuality(
        lastSummary,
        transcript,
        latestUserAsk,
        recentMessages,
        identifierPolicy,
      );
      if (audit.passed) {
        summarizerLog.trace('summarizeMessages: quality audit passed', { attempt });
        return lastSummary;
      }

      lastIssues = audit.issues;
      summarizerLog.trace('summarizeMessages: quality audit failed', {
        attempt,
        issues: audit.issues,
      });
    } catch (err) {
      // On the last attempt, throw. Otherwise retry.
      if (attempt === maxRetries - 1) throw err;
      summarizerLog.trace('summarizeMessages: LLM error, will retry', {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Exhausted retries — return the last summary with a warning
  summarizerLog.trace('summarizeMessages: exhausted retries, using best effort', {
    issues: lastIssues,
  });
  return lastSummary;
};

/**
 * Summarize a set of messages using the LLM with structured prompt.
 * Includes quality audit with retry and a 30s timeout.
 * On timeout, the caller's catch block falls back to sliding-window compaction.
 */
const summarizeMessages = async (
  messages: ChatMessage[],
  modelConfig: ChatModel,
  options?: SummarizerOptions | string,
): Promise<string> => {
  // Backward compat: accept criticalRules string directly
  const opts: SummarizerOptions =
    typeof options === 'string' ? { criticalRules: options } : (options ?? {});

  return Promise.race([
    summarizeMessagesImpl(messages, modelConfig, opts),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Summarization timeout')), SUMMARIZATION_TIMEOUT_MS),
    ),
  ]);
};

/**
 * Multi-stage summarization for very long histories.
 *
 * Stage 1: Split messages into parts, summarize each independently (parallel).
 * Stage 2: Merge partial summaries into a final cohesive summary.
 */
const summarizeInStages = async (
  messages: ChatMessage[],
  modelConfig: ChatModel,
  modelId: string,
  contextWindowOverride?: number,
  options?: SummarizerOptions | string,
): Promise<string> => {
  const opts: SummarizerOptions =
    typeof options === 'string' ? { criticalRules: options } : (options ?? {});
  const { criticalRules } = opts;
  const partCount = computePartCount(messages, modelId, contextWindowOverride);
  const parts = splitMessagesByTokenShare(messages, partCount);

  summarizerLog.trace('summarizeInStages: splitting', {
    totalMessages: messages.length,
    partCount,
    messageCounts: parts.map(p => p.length),
  });

  // Stage 1: Summarize each part in parallel (with partial failure fallback)
  const criticalRulesPrefix = criticalRules
    ? `<workspace-critical-rules>\n${criticalRules}\n</workspace-critical-rules>\n\n`
    : '';
  const settledResults = await Promise.allSettled(
    parts.map(async (part, i) => {
      const transcript = formatTranscript(part);
      const toolFailures = collectToolFailures(part);
      const fileOps = collectFileOperations(part);
      const enrichedTranscript =
        criticalRulesPrefix +
        formatToolFailures(toolFailures) +
        formatFileOperations(fileOps) +
        transcript;
      return completeText(
        modelConfig,
        `${SUMMARY_PROMPT}\n\nThis is part ${i + 1} of ${parts.length} of the conversation.`,
        enrichedTranscript,
        { maxTokens: 1200 },
      );
    }),
  );

  // Check if ALL chunks failed — if so, throw to trigger sliding-window fallback
  const allFailed = settledResults.every(r => r.status === 'rejected');
  if (allFailed) {
    throw new Error('All summarization chunks failed');
  }

  // For fulfilled results use the summary; for rejected, use truncated raw transcript
  const partialSummaries = settledResults.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const rawTranscript = formatTranscript(parts[i]!);
    const truncated =
      rawTranscript.length > 2000 ? rawTranscript.slice(0, 2000) + '...' : rawTranscript;
    return `[summarization failed for this section]\n${truncated}`;
  });

  summarizerLog.trace('summarizeInStages: partials done', {
    partCount,
    summaryLengths: partialSummaries.map(s => s.length),
    failedParts: settledResults.filter(r => r.status === 'rejected').length,
  });

  // Stage 2: Merge partial summaries
  const mergeInput = partialSummaries
    .map((summary, i) => `--- Part ${i + 1} ---\n${summary}`)
    .join('\n\n');

  let finalSummary = await completeText(modelConfig, MERGE_PROMPT, mergeInput, {
    maxTokens: 1200,
  });

  // Append recent turns from the last part
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    finalSummary += getRecentTurnsVerbatim(lastPart);
  }

  summarizerLog.trace('summarizeInStages: merge done', {
    finalLength: finalSummary.length,
  });

  return finalSummary;
};

export type { ToolFailure, SummarizerOptions };

export {
  summarizeMessages,
  summarizeInStages,
  extractCriticalRules,
  shouldUseAdaptiveCompaction,
  formatTranscript,
  auditSummaryQuality,
  extractIdentifiers,
  extractRecentIdentifiers,
  collectToolFailures,
  collectFileOperations,
  getLatestUserAsk,
  getRecentTurnsVerbatim,
  PREFERRED_SECTIONS,
  MAX_SUMMARY_RETRIES,
  RETRY_MAX_DELAY_MS,
  SUMMARIZATION_TIMEOUT_MS,
  RECENT_TURN_MAX_CHARS,
  RECENT_TURNS_TO_PRESERVE,
};
