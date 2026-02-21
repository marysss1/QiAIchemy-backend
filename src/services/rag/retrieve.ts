import { Types } from 'mongoose';
import { env } from '../../config/env';
import { KnowledgeChunk } from '../../models/KnowledgeChunk';
import { createEmbeddings } from '../llm/greatRouterClient';
import { cosineSimilarity, lexicalSimilarity, tokenizeForSearch } from './textUtils';
import {
  computeGraphQueryFeatures,
  graphTokenSimilarity,
  reciprocalRankFusion,
} from './graphLite';

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
  graphScore: number;
  rrfScore: number;
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
  topK = env.RAG_TOP_K,
  options?: { graphContext?: string }
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

  const graphFeatures = await computeGraphQueryFeatures(queryText, options?.graphContext);

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
    const graphScore = graphTokenSimilarity(docTokens, graphFeatures.tokenBoost);
    const score =
      queryEmbedding.length > 0
        ? embeddingScore * 0.62 + lexicalScore * 0.2 + graphScore * 0.18
        : lexicalScore * 0.7 + graphScore * 0.3;

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
      graphScore,
      rrfScore: 0,
    };
  });

  const byEmbedding = [...scored].sort((a, b) => b.embeddingScore - a.embeddingScore);
  const byLexical = [...scored].sort((a, b) => b.lexicalScore - a.lexicalScore);
  const byGraph = [...scored].sort((a, b) => b.graphScore - a.graphScore);

  const embRank = new Map(byEmbedding.map((item, idx) => [item.id, idx + 1]));
  const lexRank = new Map(byLexical.map((item, idx) => [item.id, idx + 1]));
  const graphRank = new Map(byGraph.map((item, idx) => [item.id, idx + 1]));

  const merged = scored.map((item) => {
    const rrfScore =
      reciprocalRankFusion(embRank.get(item.id) ?? 999) +
      reciprocalRankFusion(lexRank.get(item.id) ?? 999) +
      reciprocalRankFusion(graphRank.get(item.id) ?? 999);
    return {
      ...item,
      rrfScore,
      score: item.score * 0.7 + rrfScore * 0.3,
    };
  });

  return merged.sort((a, b) => b.score - a.score).slice(0, topK);
}
