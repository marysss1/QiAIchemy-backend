import { Types } from 'mongoose';
import { env } from '../../config/env';
import { KnowledgeChunk } from '../../models/KnowledgeChunk';
import { createEmbeddings } from '../llm/greatRouterClient';
import { cosineSimilarity, lexicalSimilarity, tokenizeForSearch } from './textUtils';

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourcePath?: string;
  sectionTitle?: string;
  chunkIndex: number;
  text: string;
  score: number;
  embeddingScore: number;
  lexicalScore: number;
}

type CandidateChunk = {
  _id: Types.ObjectId;
  sourceId: string;
  sourceTitle: string;
  sourcePath?: string;
  sectionTitle?: string;
  chunkIndex: number;
  text: string;
  embedding?: number[];
  keywords?: string[];
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadCandidates(query: string, limit: number): Promise<CandidateChunk[]> {
  const tokens = tokenizeForSearch(query).slice(0, 8).filter((token) => token.length >= 2);
  const regexes = tokens.map((token) => new RegExp(escapeRegExp(token), 'i'));

  const primary = regexes.length
    ? await KnowledgeChunk.find(
        {
          $or: [
            ...regexes.map((regex) => ({ text: regex })),
            ...regexes.map((regex) => ({ sourceTitle: regex })),
            ...regexes.map((regex) => ({ sectionTitle: regex })),
          ],
        },
        {
          sourceId: 1,
          sourceTitle: 1,
          sourcePath: 1,
          sectionTitle: 1,
          chunkIndex: 1,
          text: 1,
          embedding: 1,
          keywords: 1,
        }
      )
        .limit(limit)
        .lean<CandidateChunk[]>()
    : [];

  if (primary.length >= limit) {
    return primary;
  }

  const existingIds = new Set(primary.map((item) => String(item._id)));
  const fallback = await KnowledgeChunk.find(
    existingIds.size ? { _id: { $nin: [...existingIds].map((id) => new Types.ObjectId(id)) } } : {},
    {
      sourceId: 1,
      sourceTitle: 1,
      sourcePath: 1,
      sectionTitle: 1,
      chunkIndex: 1,
      text: 1,
      embedding: 1,
      keywords: 1,
    }
  )
    .sort({ updatedAt: -1 })
    .limit(Math.max(limit - primary.length, 0))
    .lean<CandidateChunk[]>();

  return [...primary, ...fallback];
}

export async function retrieveRelevantChunks(
  query: string,
  topK = env.RAG_TOP_K
): Promise<RetrievedChunk[]> {
  const queryText = query.trim();
  if (!queryText) {
    return [];
  }

  const queryTokens = tokenizeForSearch(queryText);
  const candidates = await loadCandidates(queryText, env.RAG_CANDIDATE_LIMIT);
  if (candidates.length === 0) {
    return [];
  }

  let queryEmbedding: number[] = [];
  try {
    const vectors = await createEmbeddings([queryText]);
    queryEmbedding = vectors[0] ?? [];
  } catch (error) {
    console.warn('[rag] embedding query failed, fallback to lexical only:', error);
  }

  const scored = candidates.map<RetrievedChunk>((candidate) => {
    const docTokens = candidate.keywords?.length ? candidate.keywords : tokenizeForSearch(candidate.text);
    const lexicalScore = lexicalSimilarity(queryTokens, docTokens);
    const embeddingScore = cosineSimilarity(queryEmbedding, candidate.embedding ?? []);
    const score = queryEmbedding.length > 0 ? embeddingScore * 0.78 + lexicalScore * 0.22 : lexicalScore;

    return {
      id: String(candidate._id),
      sourceId: candidate.sourceId,
      sourceTitle: candidate.sourceTitle,
      sourcePath: candidate.sourcePath,
      sectionTitle: candidate.sectionTitle,
      chunkIndex: candidate.chunkIndex,
      text: candidate.text,
      score,
      embeddingScore,
      lexicalScore,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
