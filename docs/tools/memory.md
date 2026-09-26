---
summary: "Memory tools — search and retrieve from the server-side hybrid memory system."
read_when:
  - Using memory search in conversations
  - Understanding memory tool parameters
  - Retrieving specific memory content
title: "Memory Tools"
---

# Memory Tools

Two tools for accessing the [memory system](/concepts/memory) during conversations.

## memory_search

Search the agent's memory files (`MEMORY.md`, `memory/*`) and past conversation transcripts. The extension syncs changed memory files to the AskTab service before each search; the service ranks the results. Requires an AskTab account sign-in.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | Search query |
| `maxResults` | number | 10 | Maximum results (up to 30) |
| `minScore` | number | 0.0 | Minimum relevance score threshold |

### Returns

Ranked results with:
- **path** — Source file path (e.g., `memory/2024-03-15.md`)
- **startLine / endLine** — Line range within the file
- **score** — Relevance score
- **snippet** — Up to 700 characters of the matching chunk

Each result is formatted as `[n] path#Lstart-Lend (score: x.xx)` followed by the snippet. The service ranks results with BM25 blended with vector scores when an embedding model is available, applies temporal decay to dated entries, and uses MMR re-ranking to reduce redundancy. See [Memory](/concepts/memory) for details.

### Example usage

The agent automatically uses `memory_search` when it needs to recall information from past conversations:

```
User: What did we decide about the database schema last week?

Agent: [calls memory_search with query "database schema decision"]
→ Returns relevant memory chunks from memory/2024-03-12.md
```

---

## memory_get

Retrieve specific content from a memory file by path and line range.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | (required) | File path |
| `from` | number | 1 | Starting line number (1-based) |
| `lines` | number | — | Max lines to return (up to 200) |

### Returns

File content with line numbers, starting from the specified position.

### Example usage

After finding a relevant chunk via `memory_search`, the agent can retrieve more context:

```
Agent: [calls memory_get with path "memory/2024-03-12.md", from 15, lines 30]
→ Returns lines 15-44 of the memory file
```

## When memory tools are used

The agent uses memory tools when:

- You ask about past conversations or decisions
- You reference something discussed previously
- The agent needs context that isn't in the current conversation
- Workspace instructions reference stored knowledge

`memory_search` needs a signed-in AskTab account. The service falls back to BM25 when it has no embedding model. `memory_get` reads local files and works offline.
