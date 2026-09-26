interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

interface MemoryChunk {
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
}

const DEFAULT_MAX_CHARS = 1600;
const DEFAULT_OVERLAP_CHARS = 320;

const hashText = async (text: string): Promise<string> => {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const chunkText = async (content: string, options?: ChunkOptions): Promise<MemoryChunk[]> => {
  if (!content) return [];

  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options?.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const lines = content.split('\n');
  const chunks: MemoryChunk[] = [];

  let startIdx = 0;

  while (startIdx < lines.length) {
    let charCount = 0;
    let endIdx = startIdx;

    // Accumulate lines until we exceed maxChars
    while (endIdx < lines.length) {
      const lineLen = lines[endIdx].length + (endIdx > startIdx ? 1 : 0); // +1 for \n
      if (charCount + lineLen > maxChars && endIdx > startIdx) {
        break;
      }
      charCount += lineLen;
      endIdx++;
    }

    // Handle very long single lines that exceed maxChars
    if (endIdx === startIdx + 1 && lines[startIdx].length > maxChars) {
      const longLine = lines[startIdx];
      let segStart = 0;
      while (segStart < longLine.length) {
        const segText = longLine.slice(segStart, segStart + maxChars);
        chunks.push({
          startLine: startIdx + 1,
          endLine: startIdx + 1,
          text: segText,
          contentHash: await hashText(segText),
        });
        segStart += maxChars - overlapChars;
        if (segStart >= longLine.length) break;
      }
      startIdx = endIdx;
      continue;
    }

    const chunkLines = lines.slice(startIdx, endIdx);
    const text = chunkLines.join('\n');

    chunks.push({
      startLine: startIdx + 1,
      endLine: endIdx,
      text,
      contentHash: await hashText(text),
    });

    // Calculate overlap: back up by overlapChars worth of lines
    if (endIdx >= lines.length) break;

    let overlapCount = 0;
    let backIdx = endIdx;
    while (backIdx > startIdx + 1 && overlapCount < overlapChars) {
      backIdx--;
      overlapCount += lines[backIdx].length + 1;
    }

    startIdx = backIdx;
  }

  return chunks;
};

export type { ChunkOptions, MemoryChunk };
export { chunkText };
