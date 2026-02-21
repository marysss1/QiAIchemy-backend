const CHINESE_CHAR_REGEX = /\p{Script=Han}/u;

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function tokenizeForSearch(input: string): string[] {
  const normalized = normalizeText(input).toLowerCase();
  const englishTokens = normalized.match(/[a-z0-9]{2,}/g) ?? [];

  const hanChars = [...normalized].filter((char) => CHINESE_CHAR_REGEX.test(char));
  const chineseBigrams: string[] = [];
  for (let i = 0; i < hanChars.length - 1; i += 1) {
    chineseBigrams.push(`${hanChars[i]}${hanChars[i + 1]}`);
  }

  const merged = [...englishTokens, ...chineseBigrams];
  const uniq = new Set<string>();
  for (const token of merged) {
    if (token.length >= 2) {
      uniq.add(token);
    }
  }
  return [...uniq];
}

export function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  const step = Math.max(chunkSize - overlap, 1);
  for (let start = 0; start < normalized.length; start += step) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end === normalized.length) {
      break;
    }
  }

  return chunks;
}

export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length === 0 || vectorB.length === 0 || vectorA.length !== vectorB.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vectorA.length; i += 1) {
    const a = vectorA[i];
    const b = vectorB[i];
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function lexicalSimilarity(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) {
    return 0;
  }

  const docSet = new Set(docTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (docSet.has(token)) {
      hits += 1;
    }
  }

  return hits / Math.sqrt(queryTokens.length * docTokens.length);
}

export function createSourceIdFromPath(filePath: string): string {
  return filePath
    .replace(/[\\/]+/g, '/')
    .replace(/^\.\//, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '')
    .toLowerCase();
}

export function stripExt(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}
