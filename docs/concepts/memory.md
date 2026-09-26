---
summary: "Memory system — server-side hybrid search over memory files and transcripts, plus session journaling."
read_when:
  - Understanding how AskTab remembers across sessions
  - Configuring the memory system
  - Learning how memory search ranks results
title: "Memory"
---

# Memory

AskTab's memory system provides long-term context recall across sessions. The AskTab service indexes and ranks memory; the extension keeps the source files and uploads them to your account for search.

## How memory works

Memory is built from two sources, scoped per agent:

1. **Memory files** — `MEMORY.md` and files under `memory/` (for example the `memory/YYYY-MM-DD.md` daily journals). Other workspace files are not indexed.
2. **Session transcripts** — When a session journal runs, the conversation transcript is uploaded as `transcript/YYYY-MM-DD/<chatId>-<title>.md`.

The memory search tools let the agent query this knowledge during conversations. Memory search requires signing in to your AskTab account.

## Sync

Each `memory_search` call first syncs the agent's memory with the service:

1. The extension sends the path and `updatedAt` of every memory file, plus the IDs of the agent's chats.
2. The service deletes documents for memory files that no longer exist and transcripts whose chat was deleted.
3. The service returns the files whose stored copy is missing or out of date, and the extension uploads only those.

The extension stores no local index, chunks, or embeddings.

## Search pipeline

The service splits documents into chunks and ranks them with:

- **BM25** full-text search (K1=1.2, B=0.75) with stop words and CJK character bigrams
- **Vector search** when the service has a default embedding model, blended 0.7 vector / 0.3 BM25. Without an embedding model, ranking falls back to BM25.
- **Temporal decay** with a 30-day half-life for dated paths (`memory/YYYY-MM-DD*` and `transcript/YYYY-MM-DD/*`). `MEMORY.md` and undated `memory/*` files never decay, so the curated summary always keeps full weight.
- **MMR re-ranking** (λ=0.7) to reduce redundant results

Each result includes the source path, line range, score, and a snippet of up to 700 characters.

## Session journaling

When you switch chats, AskTab automatically extracts durable memories:

1. **Guard**: 60-second cooldown per chat prevents rapid re-processing
2. **Transcript preparation**: Messages serialized into a readable format (minimum 4 messages required)
3. **Deduplication**: Searches existing memories to avoid writing duplicate facts
4. **LLM extraction**: A prompt asks the LLM to extract bullet-point memories from the transcript
5. **Writing**: New memories appended to `memory/YYYY-MM-DD.md` with timestamp and session title
6. **MEMORY.md curation**: LLM integrates new entries into the summary (kept under 4000 chars)
7. **Transcript indexing**: The conversation transcript is uploaded to the service for search. A later upload for the same chat replaces the earlier one.

If the LLM returns `NO_REPLY`, no new memories are written (the conversation didn't contain anything new).

## Memory tools

Two tools are available for memory access during conversations:

### memory_search

Search across the agent's memory files and transcripts:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | Search query |
| `maxResults` | number | 10 | Maximum results (up to 30) |
| `minScore` | number | 0.0 | Minimum relevance score |

Returns ranked results with file paths, line ranges, scores, and text snippets.

### memory_get

Retrieve specific content from a memory file:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | (required) | File path |
| `from` | number | 1 | Starting line number |
| `lines` | number | — | Max lines to return (up to 200) |

## Configuration

Memory search has no extension settings. The AskTab service decides whether an embedding model is available and applies the ranking parameters above.
