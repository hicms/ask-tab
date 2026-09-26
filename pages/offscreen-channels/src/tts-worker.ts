// ──────────────────────────────────────────────
// TTS Worker — Local Voice Synthesis (Kokoro)
// ──────────────────────────────────────────────
// Uses kokoro-js (Kokoro-82M ONNX) for local, private TTS.
// Mirrors stt-worker.ts architecture.

// Static import of @huggingface/transformers is REQUIRED here — it forces Vite
// to bundle transformers.js + onnxruntime-web into this chunk. Without it,
// kokoro-js's dynamic import of transformers falls back to CDN loading, which
// Chrome extension CSP blocks ("Failed to fetch dynamically imported module").
// This mirrors stt-worker.ts which statically imports { pipeline }.

import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import * as ort from 'onnxruntime-web';
import type { KokoroTTS } from 'kokoro-js';

// Configure ONNX runtime BEFORE any kokoro-js import.
// Point wasmPaths to same-origin extension files so dynamic import() uses
// chrome-extension:// URLs (allowed by MV3 CSP 'self') instead of CDN URLs
// (blocked by CSP).
try {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('offscreen-channels/assets/');
} catch (err) {
  diagnostics.error('[tts] Failed to configure ONNX runtime:', err);
}

// Relay logger — sends structured log entries to the background SW's logger-buffer
const log = (level: string, message: string, data?: unknown) => {
  const consoleFn = level === 'error' ? diagnostics.error : diagnostics.debug;
  consoleFn('[tts]', message, data ?? '');
  chrome.runtime
    .sendMessage({
      type: 'LOG_RELAY',
      level,
      message: `[tts] ${message}`,
      ...(data !== undefined ? { data } : {}),
    })
    .catch(() => {});
};
const trace = (msg: string, data?: unknown) => log('trace', msg, data);
const debug = (msg: string, data?: unknown) => log('debug', msg, data);

// ── Model Cache ─────────────────────────────────

let cachedTts: KokoroTTS | null = null;
let cachedModel: string | null = null;
let modelLoadPromise: Promise<KokoroTTS> | null = null;

// ── Progress Reporting ──────────────────────────

const sendTtsProgress = (
  requestId: string,
  status: 'downloading' | 'loading' | 'synthesizing' | 'encoding' | 'ready',
): void => {
  chrome.runtime.sendMessage({ type: 'TTS_PROGRESS', requestId, status }).catch(() => {});
};

const sendDownloadProgress = (
  downloadId: string,
  status: 'downloading' | 'complete' | 'error',
  percent: number,
  error?: string,
): void => {
  chrome.runtime
    .sendMessage({ type: 'TTS_DOWNLOAD_PROGRESS', downloadId, status, percent, error })
    .catch(() => {});
};

// ── WAV Encoding ────────────────────────────────

/**
 * Encode Float32Array PCM to WAV ArrayBuffer.
 * WAV is simple, universally supported, and needs no extra dependencies.
 * Telegram can play WAV as audio (not voice bubble — that needs OGG Opus).
 */
const float32ToWav = (samples: Float32Array, sampleRate: number): ArrayBuffer => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert Float32 [-1, 1] to Int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
};

const writeString = (view: DataView, offset: number, str: string): void => {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
};

// ── OGG Opus Encoding ───────────────────────────

/**
 * Try to encode Float32 PCM as OGG Opus using WebCodecs AudioEncoder.
 * Returns null if WebCodecs is not available (graceful degradation to WAV).
 *
 * The offscreen document has full web API access including AudioEncoder.
 */
const pcmToOpus = async (
  samples: Float32Array,
  sampleRate: number,
): Promise<ArrayBuffer | null> => {
  if (typeof AudioEncoder === 'undefined') {
    debug('pcmToOpus: AudioEncoder API not available');
    return null;
  }

  // Pre-flight check: verify Opus codec support before attempting
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 64000,
    });
    if (!support.supported) {
      debug('pcmToOpus: Opus codec not supported by AudioEncoder', support);
      return null;
    }
  } catch (err) {
    debug('pcmToOpus: isConfigSupported check failed', String(err));
    return null;
  }

  const opusPackets: Uint8Array[] = [];

  try {
    const encoder = new AudioEncoder({
      output: chunk => {
        const buf = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buf);
        opusPackets.push(buf);
      },
      error: e => {
        debug('AudioEncoder error', String(e));
      },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 64000,
    });

    // Resample to 48kHz if needed (Opus requires 48kHz)
    const resampled = sampleRate === 48000 ? samples : resampleTo48k(samples, sampleRate);

    // Encode in 20ms frames (960 samples at 48kHz)
    const frameSize = 960;
    for (let i = 0; i < resampled.length; i += frameSize) {
      const end = Math.min(i + frameSize, resampled.length);
      const frame = new Float32Array(frameSize); // zero-padded
      frame.set(resampled.subarray(i, end));

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: frameSize,
        numberOfChannels: 1,
        timestamp: Math.round((i / 48000) * 1_000_000), // microseconds
        data: frame,
      });

      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();

    if (opusPackets.length === 0) return null;

    return muxToOgg(opusPackets, 48000);
  } catch (err) {
    debug('pcmToOpus failed, falling back to WAV', String(err));
    return null;
  }
};

/** Simple linear interpolation resampler to 48kHz. */
const resampleTo48k = (samples: Float32Array, fromRate: number): Float32Array => {
  const ratio = fromRate / 48000;
  const outLength = Math.round(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
};

// ── Minimal OGG Container Muxer ─────────────────

/**
 * Wrap Opus packets into an OGG container.
 * Produces: ID header page, comment header page, then audio data pages.
 * This is the minimum required for Telegram to recognize it as a voice note.
 */
const muxToOgg = (packets: Uint8Array[], sampleRate: number): ArrayBuffer => {
  const serialNo = (Math.random() * 0xffffffff) >>> 0;
  const pages: Uint8Array[] = [];
  let granulePos = 0n;
  let pageSeqNo = 0;

  // Page 1: OpusHead (ID header)
  const opusHead = new Uint8Array(19);
  const headView = new DataView(opusHead.buffer);
  // 'OpusHead'
  opusHead.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]);
  opusHead[8] = 1; // version
  opusHead[9] = 1; // channel count
  headView.setUint16(10, 0, true); // pre-skip
  headView.setUint32(12, sampleRate, true); // input sample rate
  headView.setUint16(16, 0, true); // output gain
  opusHead[18] = 0; // channel mapping family

  pages.push(buildOggPage([opusHead], 0n, serialNo, pageSeqNo++, 0x02)); // BOS flag
  granulePos = 0n;

  // Page 2: OpusTags (comment header)
  const vendor = 'AskTab';
  const tagsSize = 8 + 4 + vendor.length + 4; // 'OpusTags' + vendorLen + vendor + commentCount
  const opusTags = new Uint8Array(tagsSize);
  const tagsView = new DataView(opusTags.buffer);
  opusTags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // 'OpusTags'
  tagsView.setUint32(8, vendor.length, true);
  for (let i = 0; i < vendor.length; i++) opusTags[12 + i] = vendor.charCodeAt(i);
  tagsView.setUint32(12 + vendor.length, 0, true); // 0 comments

  pages.push(buildOggPage([opusTags], 0n, serialNo, pageSeqNo++, 0x00));

  // Audio pages: group packets into pages (max ~255 segments per page)
  const maxSegmentsPerPage = 200;
  let pagePackets: Uint8Array[] = [];
  let segCount = 0;

  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i];
    const pktSegments = Math.ceil(pkt.length / 255) + (pkt.length % 255 === 0 ? 1 : 0);

    if (segCount + pktSegments > maxSegmentsPerPage && pagePackets.length > 0) {
      pages.push(buildOggPage(pagePackets, granulePos, serialNo, pageSeqNo++, 0x00));
      pagePackets = [];
      segCount = 0;
    }

    // Granule position: cumulative sample count at 48kHz
    // Each Opus frame at 20ms = 960 samples
    granulePos += 960n;
    pagePackets.push(pkt);
    segCount += pktSegments;
  }

  // Final page with EOS flag
  if (pagePackets.length > 0) {
    pages.push(buildOggPage(pagePackets, granulePos, serialNo, pageSeqNo++, 0x04)); // EOS
  }

  // Concatenate all pages
  const totalSize = pages.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const page of pages) {
    result.set(page, offset);
    offset += page.length;
  }

  return result.buffer;
};

/** Build a single OGG page containing one or more packets. */
const buildOggPage = (
  packets: Uint8Array[],
  granulePos: bigint,
  serialNo: number,
  pageSeqNo: number,
  flags: number,
): Uint8Array => {
  // Build segment table
  const segments: number[] = [];
  for (const pkt of packets) {
    let remaining = pkt.length;
    while (remaining >= 255) {
      segments.push(255);
      remaining -= 255;
    }
    segments.push(remaining); // terminal segment (< 255)
  }

  const dataSize = packets.reduce((sum, p) => sum + p.length, 0);
  const headerSize = 27 + segments.length;
  const page = new Uint8Array(headerSize + dataSize);
  const view = new DataView(page.buffer);

  // OGG page header
  page.set([0x4f, 0x67, 0x67, 0x53]); // 'OggS'
  page[4] = 0; // version
  page[5] = flags;
  view.setBigUint64(6, granulePos, true);
  view.setUint32(14, serialNo, true);
  view.setUint32(18, pageSeqNo, true);
  view.setUint32(22, 0, true); // checksum (filled later)
  page[26] = segments.length;

  // Segment table
  for (let i = 0; i < segments.length; i++) {
    page[27 + i] = segments[i];
  }

  // Packet data
  let offset = headerSize;
  for (const pkt of packets) {
    page.set(pkt, offset);
    offset += pkt.length;
  }

  // CRC-32 checksum
  const crc = oggCrc32(page);
  view.setUint32(22, crc, true);

  return page;
};

/** OGG CRC-32 (polynomial 0x04C11DB7, direct lookup table). */
const oggCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

const oggCrc32 = (data: Uint8Array): number => {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  }
  return crc;
};

// ── Base64 Encoding ─────────────────────────────

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000; // 32KB chunks to avoid call stack limits
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
};

// ── Synthesis ───────────────────────────────────

const synthesizeWithKokoro = async (
  text: string,
  requestId: string,
  model: string,
  voice: string,
  speed: number,
): Promise<void> => {
  sendTtsProgress(requestId, 'downloading');
  trace('kokoro: start', { model, voice, speed });

  // Invalidate cache if model changed
  if (cachedModel !== model) {
    cachedTts = null;
    cachedModel = null;
    modelLoadPromise = null;
  }

  if (!cachedTts) {
    if (!modelLoadPromise) {
      trace('kokoro: loading model');
      sendTtsProgress(requestId, 'loading');
      const t0 = performance.now();

      // Dynamic import to avoid loading kokoro-js until needed
      modelLoadPromise = import('kokoro-js').then(async ({ KokoroTTS: KokoroTTSClass }) => {
        const tts = await KokoroTTSClass.from_pretrained(model, { dtype: 'fp32' });
        debug('kokoro: model loaded', { elapsed: Math.round(performance.now() - t0) + 'ms' });
        return tts;
      });
    }
    cachedTts = await modelLoadPromise;
    cachedModel = model;
  }

  sendTtsProgress(requestId, 'synthesizing');
  trace('kokoro: generating', { textLength: text.length, voice, speed });

  const t1 = performance.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await cachedTts.generate(text, { voice: voice as any, speed });
  const synthMs = Math.round(performance.now() - t1);
  const audioDuration = (result.audio.length / result.sampling_rate).toFixed(2);

  debug('kokoro: synthesis done', {
    synthMs,
    audioDuration: audioDuration + 's',
    samples: result.audio.length,
    sampleRate: result.sampling_rate,
  });

  // Try OGG Opus encoding first (voice-bubble compatible), fall back to WAV
  sendTtsProgress(requestId, 'encoding');

  let audioBase64: string;
  let contentType: string;
  let voiceCompatible: boolean;

  const opusBuffer = await pcmToOpus(result.audio, result.sampling_rate);
  if (opusBuffer) {
    audioBase64 = arrayBufferToBase64(opusBuffer);
    contentType = 'audio/ogg';
    voiceCompatible = true;
    debug('kokoro: OGG Opus encoded', { opusBytes: opusBuffer.byteLength });
  } else {
    const wavBuffer = float32ToWav(result.audio, result.sampling_rate);
    audioBase64 = arrayBufferToBase64(wavBuffer);
    contentType = 'audio/wav';
    voiceCompatible = false;
    debug('kokoro: WAV encoded (Opus unavailable)', { wavBytes: wavBuffer.byteLength });
  }

  // Send result back
  await chrome.runtime
    .sendMessage({
      type: 'TTS_RESULT',
      audioBase64,
      contentType,
      voiceCompatible,
      sampleRate: result.sampling_rate,
      requestId,
    })
    .catch(() => {});

  sendTtsProgress(requestId, 'ready');
};

// ── Streaming Synthesis ─────────────────────────

/** Ensure model is loaded and return it. Shared by all streaming variants. */
const ensureKokoroModel = async (
  requestId: string,
  model: string,
  logPrefix: string,
): Promise<KokoroTTS> => {
  sendTtsProgress(requestId, 'downloading');
  trace(`${logPrefix}: start`, { model });

  if (cachedModel !== model) {
    cachedTts = null;
    cachedModel = null;
    modelLoadPromise = null;
  }

  if (!cachedTts) {
    if (!modelLoadPromise) {
      trace(`${logPrefix}: loading model`);
      sendTtsProgress(requestId, 'loading');
      const t0 = performance.now();
      modelLoadPromise = import('kokoro-js').then(async ({ KokoroTTS: KokoroTTSClass }) => {
        const tts = await KokoroTTSClass.from_pretrained(model, { dtype: 'fp32' });
        debug(`${logPrefix}: model loaded`, { elapsed: Math.round(performance.now() - t0) + 'ms' });
        return tts;
      });
    }
    cachedTts = await modelLoadPromise;
    cachedModel = model;
  }

  return cachedTts;
};

const streamSynthesizeWithKokoro = async (
  text: string,
  requestId: string,
  model: string,
  voice: string,
  speed: number,
): Promise<void> => {
  const tts = await ensureKokoroModel(requestId, model, 'kokoro-stream');

  sendTtsProgress(requestId, 'synthesizing');
  trace('kokoro-stream: generating', { textLength: text.length, voice, speed });

  let chunkIndex = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = tts.stream(text, { voice: voice as any, speed });

  for await (const chunk of stream) {
    const samples = chunk.audio as unknown as Float32Array;
    const sampleRate = (chunk as unknown as { sampling_rate?: number }).sampling_rate ?? 24000;
    const chunkText = (chunk.text as string) ?? '';

    // Encode chunk: try OGG Opus first, fall back to WAV
    let audioBase64: string;
    let contentType: string;
    let voiceCompatible: boolean;

    const opusBuffer = await pcmToOpus(samples, sampleRate);
    if (opusBuffer) {
      audioBase64 = arrayBufferToBase64(opusBuffer);
      contentType = 'audio/ogg';
      voiceCompatible = true;
    } else {
      const wavBuffer = float32ToWav(samples, sampleRate);
      audioBase64 = arrayBufferToBase64(wavBuffer);
      contentType = 'audio/wav';
      voiceCompatible = false;
    }

    trace('kokoro-stream: chunk', { chunkIndex, textLength: chunkText.length, contentType });

    await chrome.runtime
      .sendMessage({
        type: 'TTS_STREAM_CHUNK',
        requestId,
        chunkIndex,
        text: chunkText,
        audioBase64,
        contentType,
        voiceCompatible,
        sampleRate,
      })
      .catch(() => {});

    chunkIndex++;
  }

  debug('kokoro-stream: complete', { totalChunks: chunkIndex });

  await chrome.runtime
    .sendMessage({ type: 'TTS_STREAM_END', requestId, totalChunks: chunkIndex })
    .catch(() => {});

  sendTtsProgress(requestId, 'ready');
};

// ── Text Splitting ──────────────────────────────

/**
 * Find the first natural split point in text for batched TTS.
 *
 * Returns the first segment (including any trailing whitespace consumed by the
 * split) so the caller can do `text.slice(result.length).trim()` to get the
 * remainder.  Returns `null` when splitting would not help (text too short,
 * first piece trivially short, or no good boundary found).
 *
 * Split strategy (priority order):
 * 1. Sentence-ending punctuation (.!?…。？！) followed by whitespace
 * 2. Paragraph break (\n\n)
 * 3. Word boundary near 200 chars (for unpunctuated text)
 * 4. null — no good split point
 */
const extractFirstSentence = (text: string): string | null => {
  // Too short to benefit from splitting
  if (text.length < 80) return null;

  // 1. Sentence-ending punctuation followed by whitespace
  const sentenceMatch = text.match(/^(.*?[.!?…。？！])\s+/s);
  if (sentenceMatch) {
    const first = sentenceMatch[1];
    // Skip if first piece is trivially short (e.g. "Hi.")
    if (first.length < 20) return null;

    // If this match crosses a paragraph break, prefer the paragraph break
    // to avoid creating one huge cross-paragraph chunk.
    const firstPara = text.indexOf('\n\n');
    if (firstPara >= 20 && firstPara < first.length) {
      const paraRemainder = text.slice(firstPara + 2).trim();
      if (paraRemainder.length > 0) {
        return text.slice(0, firstPara + 2);
      }
    }

    // Skip if remainder would be empty
    const remainder = text.slice(sentenceMatch[0].length).trim();
    if (remainder.length === 0) return null;
    return sentenceMatch[0];
  }

  // 2. Paragraph break (\n\n)
  const paraIdx = text.indexOf('\n\n');
  if (paraIdx >= 20) {
    const remainder = text.slice(paraIdx + 2).trim();
    if (remainder.length > 0) {
      // Include the \n\n in the returned slice so caller can cleanly slice
      return text.slice(0, paraIdx + 2);
    }
  }

  // 3. Word boundary near 200 chars (for text with no punctuation at all)
  if (text.length > 200) {
    // Find the last space at or before position 200
    const searchRegion = text.slice(0, 200);
    const lastSpace = searchRegion.lastIndexOf(' ');
    if (lastSpace >= 20) {
      const remainder = text.slice(lastSpace + 1).trim();
      if (remainder.length > 0) {
        return text.slice(0, lastSpace + 1); // include trailing space
      }
    }
  }

  // 4. No good split point
  return null;
};

// ── Adaptive Chunking Constants ─────────────────

const TARGET_SECONDS_PER_CHUNK = 5; // each chunk targets ~5s synthesis time
const MIN_CHARS_PER_CHUNK = 100; // floor: don't create tiny chunks
const MAX_CHARS_PER_CHUNK = 800; // ceiling: don't let fast hardware create huge chunks
const FALLBACK_CHARS_PER_CHUNK = 300; // used when first chunk is too short to measure reliably

// ── Remainder Splitting ─────────────────────────

/**
 * Split text into chunks of approximately `targetChars` characters,
 * breaking at natural boundaries (sentence > paragraph > word > force).
 *
 * Returns an array of non-empty trimmed strings.
 */
const splitTextIntoChunks = (text: string, targetChars: number): string[] => {
  const safeTarget = Math.max(Math.round(targetChars) || 1, 1); // guard against 0, NaN, negative
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    // Close enough to target — don't split further
    if (remaining.length <= safeTarget * 1.3) {
      chunks.push(remaining);
      break;
    }

    const searchRegion = remaining.slice(0, safeTarget);
    let splitAt = -1;

    // Priority 1: last sentence boundary in region
    // Find last occurrence of sentence-ending punctuation followed by whitespace
    const sentenceRe = /[.!?…。？！]\s+/g;
    let lastSentenceMatch: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = sentenceRe.exec(searchRegion)) !== null) {
      lastSentenceMatch = m;
    }
    if (
      lastSentenceMatch &&
      lastSentenceMatch.index + lastSentenceMatch[0].length >= safeTarget * 0.4
    ) {
      splitAt = lastSentenceMatch.index + lastSentenceMatch[0].length;
    }

    // Priority 2: paragraph break
    if (splitAt === -1) {
      const lastPara = searchRegion.lastIndexOf('\n\n');
      if (lastPara >= safeTarget * 0.3) {
        splitAt = lastPara + 2; // skip past the \n\n
      }
    }

    // Priority 3: word boundary
    if (splitAt === -1) {
      const lastSpace = searchRegion.lastIndexOf(' ');
      if (lastSpace >= safeTarget * 0.3) {
        splitAt = lastSpace + 1; // skip past the space
      }
    }

    // Priority 4: force split at safeTarget
    if (splitAt === -1) {
      splitAt = safeTarget;
    }

    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks;
};

// ── Batched Streaming Synthesis ─────────────────
// Splits text into first-sentence + adaptively-sized remainder chunks,
// using tts.generate() for each part. Measures first chunk synthesis speed
// to calculate optimal chunk size for the current hardware.

const batchedStreamSynthesizeWithKokoro = async (
  text: string,
  requestId: string,
  model: string,
  voice: string,
  speed: number,
  adaptiveChunking = true,
): Promise<void> => {
  const tts = await ensureKokoroModel(requestId, model, 'kokoro-batched');

  sendTtsProgress(requestId, 'synthesizing');
  trace('kokoro-batched: generating', { textLength: text.length, voice, speed });

  /** Encode PCM → OGG Opus (preferred) or WAV (fallback). */
  const encodeAudio = async (
    samples: Float32Array,
    sampleRate: number,
  ): Promise<{ audioBase64: string; contentType: string; voiceCompatible: boolean }> => {
    const opusBuffer = await pcmToOpus(samples, sampleRate);
    if (opusBuffer) {
      return {
        audioBase64: arrayBufferToBase64(opusBuffer),
        contentType: 'audio/ogg',
        voiceCompatible: true,
      };
    }
    const wavBuffer = float32ToWav(samples, sampleRate);
    return {
      audioBase64: arrayBufferToBase64(wavBuffer),
      contentType: 'audio/wav',
      voiceCompatible: false,
    };
  };

  const split = extractFirstSentence(text);
  let totalChunks = 0;

  if (split) {
    const firstText = split.trim();
    const remainderText = text.slice(split.length).trim();

    // ── First sentence: generate + send TTS_STREAM_CHUNK ──
    trace('kokoro-batched: generating first sentence', { firstLength: firstText.length });
    const t1 = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstResult = await tts.generate(firstText, { voice: voice as any, speed });
    const firstSynthMs = performance.now() - t1;

    sendTtsProgress(requestId, 'encoding');
    const firstEncoded = await encodeAudio(firstResult.audio, firstResult.sampling_rate);

    trace('kokoro-batched: first chunk sent', {
      synthMs: Math.round(firstSynthMs),
      textLength: firstText.length,
      contentType: firstEncoded.contentType,
    });

    await chrome.runtime
      .sendMessage({
        type: 'TTS_STREAM_CHUNK',
        requestId,
        chunkIndex: 0,
        text: firstText,
        ...firstEncoded,
        sampleRate: firstResult.sampling_rate,
      })
      .catch(() => {});
    totalChunks = 1;

    // ── Remainder chunking ──
    if (remainderText.length > 0) {
      // Determine chunks: adaptive splits remainder into multiple pieces,
      // non-adaptive sends the whole remainder as a single blob.
      let chunks: string[];

      if (adaptiveChunking) {
        const safeSynthMs = Math.max(firstSynthMs, 1); // floor at 1ms to avoid Infinity
        const charsPerSecond = firstText.length / (safeSynthMs / 1000);
        const rawTarget = charsPerSecond * TARGET_SECONDS_PER_CHUNK;
        const clampedTarget = Math.max(
          MIN_CHARS_PER_CHUNK,
          Math.min(MAX_CHARS_PER_CHUNK, rawTarget),
        );
        // If first chunk was too short to measure reliably, use fallback
        const effectiveTarget = firstText.length < 50 ? FALLBACK_CHARS_PER_CHUNK : clampedTarget;

        debug('kokoro-batched: adaptive chunking', {
          charsPerSecond: Math.round(charsPerSecond),
          effectiveTarget: Math.round(effectiveTarget),
          remainderLength: remainderText.length,
        });

        chunks = splitTextIntoChunks(remainderText, Math.round(effectiveTarget));
      } else {
        trace('kokoro-batched: single remainder (adaptive chunking disabled)', {
          remainderLength: remainderText.length,
        });
        chunks = [remainderText];
      }

      for (const chunk of chunks) {
        sendTtsProgress(requestId, 'synthesizing');
        trace('kokoro-batched: generating remainder chunk', {
          chunkIndex: totalChunks,
          chunkLength: chunk.length,
        });
        const tChunk = performance.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunkResult = await tts.generate(chunk, { voice: voice as any, speed });
        const chunkMs = Math.round(performance.now() - tChunk);

        sendTtsProgress(requestId, 'encoding');
        const chunkEncoded = await encodeAudio(chunkResult.audio, chunkResult.sampling_rate);

        debug('kokoro-batched: remainder chunk encoded', {
          chunkIndex: totalChunks,
          synthMs: chunkMs,
          textLength: chunk.length,
          contentType: chunkEncoded.contentType,
        });

        await chrome.runtime
          .sendMessage({
            type: 'TTS_STREAM_REMAINDER',
            requestId,
            ...chunkEncoded,
            sampleRate: chunkResult.sampling_rate,
          })
          .catch(() => {});
        totalChunks++;
      }
    }
  } else {
    // No split point — monolithic generate (fine for short text)
    trace('kokoro-batched: no split, monolithic generate', { textLength: text.length });
    const t1 = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tts.generate(text, { voice: voice as any, speed });
    const synthMs = Math.round(performance.now() - t1);

    sendTtsProgress(requestId, 'encoding');
    const encoded = await encodeAudio(result.audio, result.sampling_rate);

    trace('kokoro-batched: monolithic chunk sent', {
      synthMs,
      textLength: text.length,
      contentType: encoded.contentType,
    });

    await chrome.runtime
      .sendMessage({
        type: 'TTS_STREAM_CHUNK',
        requestId,
        chunkIndex: 0,
        text,
        ...encoded,
        sampleRate: result.sampling_rate,
      })
      .catch(() => {});
    totalChunks = 1;
  }

  debug('kokoro-batched: complete', { totalChunks });

  await chrome.runtime
    .sendMessage({ type: 'TTS_STREAM_END', requestId, totalChunks })
    .catch(() => {});

  sendTtsProgress(requestId, 'ready');
};

// ── Public Handlers ─────────────────────────────

const handleSynthesisRequest = async (
  text: string,
  requestId: string,
  model: string,
  voice: string,
  speed: number,
): Promise<void> => {
  try {
    await synthesizeWithKokoro(text, requestId, model, voice, speed);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'TTS synthesis error', error);
    await chrome.runtime.sendMessage({ type: 'TTS_ERROR', error, requestId }).catch(() => {});
  }
};

const handleStreamSynthesisRequest = async (
  text: string,
  requestId: string,
  model: string,
  voice: string,
  speed: number,
): Promise<void> => {
  try {
    await streamSynthesizeWithKokoro(text, requestId, model, voice, speed);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'TTS streaming synthesis error', error);
    await chrome.runtime.sendMessage({ type: 'TTS_ERROR', error, requestId }).catch(() => {});
  }
};

const handleBatchedStreamSynthesisRequest = async (
  text: string,
  requestId: string,
  model: string,
  voice: string,
  speed: number,
  adaptiveChunking = true,
): Promise<void> => {
  try {
    await batchedStreamSynthesizeWithKokoro(text, requestId, model, voice, speed, adaptiveChunking);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'TTS batched streaming synthesis error', error);
    await chrome.runtime.sendMessage({ type: 'TTS_ERROR', error, requestId }).catch(() => {});
  }
};

const handleModelDownload = async (model: string, downloadId: string): Promise<void> => {
  try {
    trace('handleModelDownload: start', { model, downloadId });
    sendDownloadProgress(downloadId, 'downloading', 0);

    const { KokoroTTS: KokoroTTSClass } = await import('kokoro-js');
    const t0 = performance.now();
    cachedTts = await KokoroTTSClass.from_pretrained(model, { dtype: 'fp32' });
    cachedModel = model;

    debug('handleModelDownload: complete', {
      elapsed: Math.round(performance.now() - t0) + 'ms',
    });
    sendDownloadProgress(downloadId, 'complete', 100);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'TTS model download error', error);
    sendDownloadProgress(downloadId, 'error', 0, error);
  }
};

export {
  handleSynthesisRequest,
  handleStreamSynthesisRequest,
  handleBatchedStreamSynthesisRequest,
  handleModelDownload,
  extractFirstSentence,
  splitTextIntoChunks,
};
