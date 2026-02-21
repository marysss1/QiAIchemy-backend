import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { KnowledgeChunk } from '../../models/KnowledgeChunk';
import { createEmbeddings } from '../llm/greatRouterClient';
import {
  createSourceIdFromPath,
  normalizeText,
  splitIntoChunks,
  stripExt,
  tokenizeForSearch,
} from './textUtils';

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
const EMBEDDING_BATCH_SIZE = 32;

interface FileChunkDraft {
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  sectionTitle: string;
  chunkIndex: number;
  text: string;
  charCount: number;
  keywords: string[];
}

interface IngestFileResult {
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  chunkCount: number;
}

export interface IngestSummary {
  files: number;
  chunks: number;
  details: IngestFileResult[];
}

function parseSectionedText(raw: string, fallbackTitle: string): Array<{ title: string; text: string }> {
  const lines = raw.split(/\r?\n/);
  const sections: Array<{ title: string; text: string }> = [];

  let currentTitle = fallbackTitle;
  let buffer: string[] = [];

  const flush = (): void => {
    const joined = normalizeText(buffer.join('\n'));
    if (joined) {
      sections.push({ title: currentTitle, text: joined });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^\s*#{1,6}\s+(.+)\s*$/);
    const chapterMatch = line.match(/^\s*第.{1,20}[篇章节卷]\s*$/);
    if (headingMatch || chapterMatch) {
      flush();
      currentTitle = normalizeText((headingMatch?.[1] ?? chapterMatch?.[0] ?? fallbackTitle).trim()) || fallbackTitle;
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections.length ? sections : [{ title: fallbackTitle, text: normalizeText(raw) }];
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const stack = [rootDir];
  const files: string[] = [];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

async function embedDrafts(drafts: FileChunkDraft[]): Promise<Array<FileChunkDraft & { embedding: number[] }>> {
  const result: Array<FileChunkDraft & { embedding: number[] }> = [];

  for (let i = 0; i < drafts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = drafts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const vectors = await createEmbeddings(batch.map((item) => item.text));
    for (let j = 0; j < batch.length; j += 1) {
      result.push({
        ...batch[j],
        embedding: vectors[j] ?? [],
      });
    }
  }

  return result;
}

async function ingestFile(rootDir: string, filePath: string): Promise<IngestFileResult | null> {
  const raw = await fs.readFile(filePath, 'utf8');
  const normalizedRaw = normalizeText(raw);
  if (!normalizedRaw) {
    return null;
  }

  const relativePath = path.relative(rootDir, filePath).replace(/[\\/]+/g, '/');
  const sourceId = createSourceIdFromPath(relativePath);
  const sourceTitle = stripExt(path.basename(filePath));

  const sections = parseSectionedText(normalizedRaw, sourceTitle);
  const drafts: FileChunkDraft[] = [];

  let chunkIndex = 0;
  for (const section of sections) {
    const chunkTexts = splitIntoChunks(section.text, env.RAG_CHUNK_SIZE, env.RAG_CHUNK_OVERLAP);
    for (const chunkText of chunkTexts) {
      drafts.push({
        sourceId,
        sourceTitle,
        sourcePath: relativePath,
        sectionTitle: section.title,
        chunkIndex,
        text: chunkText,
        charCount: chunkText.length,
        keywords: tokenizeForSearch(chunkText).slice(0, 120),
      });
      chunkIndex += 1;
    }
  }

  if (drafts.length === 0) {
    return null;
  }

  const embedded = await embedDrafts(drafts);
  const bulkOps = embedded.map((item) => ({
    updateOne: {
      filter: { sourceId: item.sourceId, chunkIndex: item.chunkIndex },
      update: {
        $set: {
          sourceTitle: item.sourceTitle,
          sourcePath: item.sourcePath,
          sectionTitle: item.sectionTitle,
          text: item.text,
          charCount: item.charCount,
          keywords: item.keywords,
          embedding: item.embedding,
        },
      },
      upsert: true,
    },
  }));

  if (bulkOps.length) {
    await KnowledgeChunk.bulkWrite(bulkOps, { ordered: false });
  }

  await KnowledgeChunk.deleteMany({
    sourceId,
    chunkIndex: { $gte: drafts.length },
  });

  return {
    sourceId,
    sourceTitle,
    sourcePath: relativePath,
    chunkCount: drafts.length,
  };
}

export async function ingestKnowledgeFromDirectory(dir = env.RAG_INGEST_DIR): Promise<IngestSummary> {
  const rootDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  const files = await collectFiles(rootDir);

  const details: IngestFileResult[] = [];
  for (const filePath of files) {
    const result = await ingestFile(rootDir, filePath);
    if (result) {
      details.push(result);
      console.log(`[rag:ingest] ${result.sourcePath} -> ${result.chunkCount} chunks`);
    }
  }

  return {
    files: details.length,
    chunks: details.reduce((sum, item) => sum + item.chunkCount, 0),
    details,
  };
}
