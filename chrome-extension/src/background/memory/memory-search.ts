import type { DbMemoryChunk } from '@extension/storage';

// ── Stop Words (multilingual) ───────────────────

/** English stop words */
const STOP_WORDS_EN = [
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'aren',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'couldn',
  'could',
  'did',
  'didn',
  'do',
  'does',
  'doesn',
  'doing',
  'don',
  'down',
  'during',
  'each',
  'every',
  'few',
  'for',
  'from',
  'further',
  'get',
  'got',
  'had',
  'hadn',
  'has',
  'hasn',
  'have',
  'haven',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'if',
  'in',
  'into',
  'is',
  'isn',
  'it',
  'its',
  'itself',
  'just',
  'let',
  'll',
  'me',
  'might',
  'more',
  'most',
  'mustn',
  'my',
  'myself',
  'need',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'shan',
  'she',
  'should',
  'shouldn',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'us',
  've',
  'very',
  'was',
  'wasn',
  'we',
  'were',
  'weren',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'won',
  'would',
  'wouldn',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
];

/** Chinese stop words (common particles and function words) */
const STOP_WORDS_ZH = [
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '他',
  '她',
  '它',
  '们',
  '那',
  '里',
  '为',
  '什么',
  '吗',
  '没',
  '把',
  '吧',
  '被',
  '比',
  '从',
  '对',
  '但',
  '而',
  '个',
  '给',
  '过',
  '还',
  '或',
  '及',
  '几',
  '可',
  '来',
  '能',
  '让',
  '如',
  '所',
  '只',
  '与',
  '这个',
  '那个',
  '之',
];

/** Japanese stop words (particles, auxiliaries) */
const STOP_WORDS_JA = [
  'の',
  'に',
  'は',
  'を',
  'た',
  'が',
  'で',
  'て',
  'と',
  'し',
  'れ',
  'さ',
  'ある',
  'いる',
  'も',
  'する',
  'から',
  'な',
  'こと',
  'として',
  'い',
  'や',
  'れる',
  'など',
  'なっ',
  'ない',
  'この',
  'ため',
  'その',
  'あっ',
  'よう',
  'また',
  'もの',
  'という',
  'あり',
  'まで',
  'られ',
  'なる',
  'へ',
  'か',
  'だ',
  'これ',
  'によって',
  'により',
  'おり',
  'より',
  'による',
  'ず',
  'なり',
  'られる',
  'において',
  'ば',
  'なかっ',
  'なく',
  'しかし',
  'について',
  'せ',
  'だっ',
  'ほど',
  'それ',
  'です',
  'ます',
  'よ',
  'ね',
];

/** Korean stop words (particles, postpositions, common auxiliary) */
const STOP_WORDS_KO = [
  '이',
  '그',
  '저',
  '것',
  '수',
  '등',
  '들',
  '및',
  '을',
  '를',
  '에',
  '의',
  '가',
  '으로',
  '로',
  '에게',
  '뿐',
  '의해',
  '위해',
  '만',
  '도',
  '는',
  '은',
  '다',
  '에서',
  '까지',
  '부터',
  '하다',
  '있다',
  '되다',
  '없다',
  '않다',
  '같다',
  '보다',
  '때문',
  '처럼',
  '대해',
  '통해',
  '그리고',
  '하지만',
  '그러나',
  '또는',
  '또한',
  '이런',
  '저런',
  '어떤',
];

/** French stop words */
const STOP_WORDS_FR = [
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'dans',
  'de',
  'des',
  'du',
  'elle',
  'en',
  'est',
  'et',
  'eux',
  'il',
  'ils',
  'je',
  'la',
  'le',
  'les',
  'leur',
  'lui',
  'ma',
  'mais',
  'me',
  'mes',
  'mon',
  'ne',
  'nos',
  'notre',
  'nous',
  'on',
  'ou',
  'par',
  'pas',
  'pour',
  'qu',
  'que',
  'qui',
  'sa',
  'se',
  'ses',
  'son',
  'sur',
  'ta',
  'te',
  'tes',
  'toi',
  'ton',
  'tu',
  'un',
  'une',
  'vos',
  'votre',
  'vous',
];

/** German stop words */
const STOP_WORDS_DE = [
  'aber',
  'alle',
  'allem',
  'allen',
  'aller',
  'alles',
  'also',
  'am',
  'an',
  'ander',
  'andere',
  'anderem',
  'anderen',
  'anderer',
  'anderes',
  'als',
  'auf',
  'aus',
  'bei',
  'bin',
  'bis',
  'bist',
  'da',
  'damit',
  'dann',
  'das',
  'dass',
  'dein',
  'deine',
  'deinem',
  'deinen',
  'deiner',
  'dem',
  'den',
  'denn',
  'der',
  'des',
  'die',
  'dies',
  'diese',
  'diesem',
  'diesen',
  'dieser',
  'dieses',
  'doch',
  'dort',
  'du',
  'durch',
  'ein',
  'eine',
  'einem',
  'einen',
  'einer',
  'er',
  'es',
  'euer',
  'eure',
  'eurem',
  'euren',
  'eurer',
  'für',
  'gegen',
  'hat',
  'hatte',
  'hier',
  'hin',
  'hinter',
  'ich',
  'ihm',
  'ihn',
  'ihnen',
  'ihr',
  'ihre',
  'ihrem',
  'ihren',
  'ihrer',
  'im',
  'in',
  'indem',
  'ins',
  'ist',
  'jede',
  'jedem',
  'jeden',
  'jeder',
  'jedes',
  'jene',
  'jenem',
  'jenen',
  'jener',
  'jenes',
  'kein',
  'keine',
  'keinem',
  'keinen',
  'keiner',
  'man',
  'mein',
  'meine',
  'meinem',
  'meinen',
  'meiner',
  'mit',
  'nach',
  'nicht',
  'nichts',
  'noch',
  'nun',
  'nur',
  'ob',
  'oder',
  'ohne',
  'sehr',
  'sein',
  'seine',
  'seinem',
  'seinen',
  'seiner',
  'sich',
  'sie',
  'sind',
  'so',
  'solche',
  'solchem',
  'solchen',
  'solcher',
  'soll',
  'über',
  'um',
  'und',
  'uns',
  'unser',
  'unsere',
  'unserem',
  'unseren',
  'unserer',
  'unter',
  'von',
  'vor',
  'was',
  'weil',
  'welch',
  'welche',
  'welchem',
  'welchen',
  'welcher',
  'wenn',
  'wer',
  'wie',
  'wir',
  'wird',
  'wo',
  'zu',
  'zum',
  'zur',
];

/** Spanish stop words */
const STOP_WORDS_ES = [
  'al',
  'algo',
  'algunas',
  'alguno',
  'algunos',
  'ante',
  'antes',
  'como',
  'con',
  'contra',
  'cual',
  'cuando',
  'de',
  'del',
  'desde',
  'donde',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'entre',
  'era',
  'esa',
  'esas',
  'ese',
  'eso',
  'esos',
  'esta',
  'estas',
  'este',
  'esto',
  'estos',
  'fue',
  'ha',
  'hasta',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'me',
  'mi',
  'muy',
  'ni',
  'no',
  'nos',
  'nosotros',
  'nuestro',
  'nuestra',
  'nuestros',
  'nuestras',
  'otra',
  'otras',
  'otro',
  'otros',
  'para',
  'pero',
  'por',
  'que',
  'se',
  'ser',
  'si',
  'sin',
  'sino',
  'sobre',
  'somos',
  'son',
  'soy',
  'su',
  'sus',
  'también',
  'te',
  'ti',
  'tu',
  'tus',
  'un',
  'una',
  'uno',
  'unos',
  'usted',
  'ustedes',
  'ya',
  'yo',
];

const STOP_WORDS = new Set<string>([
  ...STOP_WORDS_EN,
  ...STOP_WORDS_ZH,
  ...STOP_WORDS_JA,
  ...STOP_WORDS_KO,
  ...STOP_WORDS_FR,
  ...STOP_WORDS_DE,
  ...STOP_WORDS_ES,
]);

// ── Script Detection ────────────────────────────

/** CJK Unified Ideographs (Chinese/Japanese Kanji/Korean Hanja) */
const isCJKIdeograph = (cp: number): boolean =>
  (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
  (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
  (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Extension B
  (cp >= 0xf900 && cp <= 0xfaff); // CJK Compatibility Ideographs

/** Hiragana */
const isHiragana = (cp: number): boolean => cp >= 0x3040 && cp <= 0x309f;

/** Katakana */
const isKatakana = (cp: number): boolean =>
  (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
  (cp >= 0x31f0 && cp <= 0x31ff); // Katakana Phonetic Extensions

/** Korean Hangul syllables and Jamo */
const isHangul = (cp: number): boolean =>
  (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
  (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
  (cp >= 0x3130 && cp <= 0x318f); // Hangul Compatibility Jamo

// ── Multilingual Tokenizer ──────────────────────

/**
 * Script-aware tokenizer supporting:
 * - Latin/Cyrillic/Arabic: word-boundary splitting
 * - CJK ideographs: character bigrams (overlapping pairs)
 * - Japanese: mixed-script handling (hiragana/katakana/kanji segmented separately)
 * - Korean Hangul: individual syllable blocks as tokens
 * - Stop words for 7 languages
 */
const tokenize = (text: string): string[] => {
  if (!text) return [];

  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // Phase 1: extract Latin/Cyrillic/numeric word tokens
  const wordMatches = lower.match(/[a-z0-9_\u00c0-\u024f\u0400-\u04ff\u0600-\u06ff]+/g);
  if (wordMatches) {
    for (const w of wordMatches) {
      if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.push(w);
    }
  }

  // Phase 2: CJK bigrams (overlapping character pairs)
  const cjkChars: string[] = [];
  for (const ch of lower) {
    const cp = ch.codePointAt(0)!;
    if (isCJKIdeograph(cp)) {
      cjkChars.push(ch);
    } else {
      // Emit bigrams from accumulated CJK chars, then reset
      if (cjkChars.length >= 2) {
        for (let i = 0; i < cjkChars.length - 1; i++) {
          const bigram = cjkChars[i]! + cjkChars[i + 1]!;
          if (!STOP_WORDS.has(bigram)) tokens.push(bigram);
        }
      } else if (cjkChars.length === 1 && !STOP_WORDS.has(cjkChars[0]!)) {
        tokens.push(cjkChars[0]!);
      }
      cjkChars.length = 0;
    }
  }
  // Flush remaining CJK chars
  if (cjkChars.length >= 2) {
    for (let i = 0; i < cjkChars.length - 1; i++) {
      const bigram = cjkChars[i]! + cjkChars[i + 1]!;
      if (!STOP_WORDS.has(bigram)) tokens.push(bigram);
    }
  } else if (cjkChars.length === 1 && !STOP_WORDS.has(cjkChars[0]!)) {
    tokens.push(cjkChars[0]!);
  }

  // Phase 3: Japanese kana (hiragana/katakana) — extract runs as tokens
  const kanaRun: string[] = [];
  for (const ch of lower) {
    const cp = ch.codePointAt(0)!;
    if (isHiragana(cp) || isKatakana(cp)) {
      kanaRun.push(ch);
    } else {
      if (kanaRun.length >= 2) {
        const run = kanaRun.join('');
        if (!STOP_WORDS.has(run)) tokens.push(run);
      }
      kanaRun.length = 0;
    }
  }
  if (kanaRun.length >= 2) {
    const run = kanaRun.join('');
    if (!STOP_WORDS.has(run)) tokens.push(run);
  }

  // Phase 4: Korean Hangul syllable blocks as individual tokens
  for (const ch of lower) {
    const cp = ch.codePointAt(0)!;
    if (isHangul(cp) && !STOP_WORDS.has(ch)) {
      tokens.push(ch);
    }
  }

  return tokens;
};

// ── BM25 Index ──────────────────────────────────

interface PostingEntry {
  docId: string;
  termFreq: number;
}

interface ChunkMeta {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

interface BM25Index {
  postings: Map<string, PostingEntry[]>;
  docLengths: Map<string, number>;
  docCount: number;
  avgDocLength: number;
  chunkMeta: Map<string, ChunkMeta>;
  fileVersions: Map<string, number>;
}

const buildIndex = (chunks: DbMemoryChunk[]): BM25Index => {
  const postings = new Map<string, PostingEntry[]>();
  const docLengths = new Map<string, number>();
  const chunkMeta = new Map<string, ChunkMeta>();
  const fileVersions = new Map<string, number>();

  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    docLengths.set(chunk.id, tokens.length);
    totalLength += tokens.length;

    chunkMeta.set(chunk.id, {
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
    });

    fileVersions.set(chunk.fileId, chunk.fileUpdatedAt);

    // Count term frequencies for this document
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    // Add to postings
    for (const [term, freq] of termFreqs) {
      let entries = postings.get(term);
      if (!entries) {
        entries = [];
        postings.set(term, entries);
      }
      entries.push({ docId: chunk.id, termFreq: freq });
    }
  }

  return {
    postings,
    docLengths,
    docCount: chunks.length,
    avgDocLength: chunks.length > 0 ? totalLength / chunks.length : 0,
    chunkMeta,
    fileVersions,
  };
};

// ── BM25 Scoring ────────────────────────────────

const K1 = 1.2;
const B = 0.75;

const computeIDF = (docFreq: number, totalDocs: number): number =>
  Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);

const scoreBM25 = (queryTerms: string[], docId: string, index: BM25Index): number => {
  const docLength = index.docLengths.get(docId) ?? 0;
  let score = 0;

  for (const term of queryTerms) {
    const entries = index.postings.get(term);
    if (!entries) continue;

    const entry = entries.find(e => e.docId === docId);
    if (!entry) continue;

    const idf = computeIDF(entries.length, index.docCount);
    const tf = entry.termFreq;
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLength / index.avgDocLength));
    score += idf * (numerator / denominator);
  }

  return score;
};

// ── Search ──────────────────────────────────────

interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  citation: string;
}

interface SearchOptions {
  maxResults?: number;
  minScore?: number;
}

const search = (index: BM25Index, query: string, options?: SearchOptions): SearchResult[] => {
  const maxResults = options?.maxResults ?? 10;
  const minScore = options?.minScore ?? 0.0;
  const queryTerms = tokenize(query);

  if (queryTerms.length === 0 || index.docCount === 0) return [];

  // AND semantics: only docs that contain ALL query terms
  let candidateDocIds: Set<string> | null = null;
  for (const term of queryTerms) {
    const entries = index.postings.get(term);
    if (!entries) {
      candidateDocIds = new Set();
      break;
    }
    const termDocIds = new Set(entries.map(e => e.docId));
    if (candidateDocIds === null) {
      candidateDocIds = termDocIds;
    } else {
      const prev = candidateDocIds as Set<string>;
      candidateDocIds = new Set([...prev].filter(id => termDocIds.has(id)));
    }
  }

  // OR fallback if AND yields nothing
  if (!candidateDocIds || candidateDocIds.size === 0) {
    candidateDocIds = new Set<string>();
    for (const term of queryTerms) {
      const entries = index.postings.get(term);
      if (entries) {
        for (const e of entries) candidateDocIds.add(e.docId);
      }
    }
  }

  if (candidateDocIds.size === 0) return [];

  // Score candidates
  const scored: SearchResult[] = [];
  for (const docId of candidateDocIds) {
    const score = scoreBM25(queryTerms, docId, index);
    if (score < minScore) continue;

    const meta = index.chunkMeta.get(docId);
    if (!meta) continue;

    scored.push({
      path: meta.filePath,
      startLine: meta.startLine,
      endLine: meta.endLine,
      score,
      snippet: meta.text.slice(0, 700),
      citation: `${meta.filePath}#L${meta.startLine}-L${meta.endLine}`,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
};

export type { BM25Index, SearchResult, SearchOptions, PostingEntry, ChunkMeta };
export { tokenize, buildIndex, search, scoreBM25, computeIDF };
