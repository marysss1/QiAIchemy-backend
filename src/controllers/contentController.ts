import { Request, Response } from 'express';
import {
  getLatestYouthWellnessSyncTime,
  listYouthWellnessArticles,
  syncYouthWellnessArticles,
} from '../services/content/youthWellnessArticles';

function clampLimit(rawValue: unknown, fallback = 6): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), 1), 12);
}

function parseForceSync(rawValue: unknown): boolean {
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }
  if (typeof rawValue !== 'string') {
    return false;
  }
  return ['1', 'true', 'yes', 'refresh'].includes(rawValue.trim().toLowerCase());
}

export async function listYouthArticles(req: Request, res: Response): Promise<void> {
  try {
    const limit = clampLimit(req.query.limit, 6);
    const forceSync = parseForceSync(req.query.forceSync);
    if (forceSync) {
      await syncYouthWellnessArticles(true);
    }
    const [articles, lastSyncedAt] = await Promise.all([
      listYouthWellnessArticles(limit),
      getLatestYouthWellnessSyncTime(),
    ]);

    res.status(200).json({
      articles: articles.map((article) => ({
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        author: article.author || undefined,
        sourceName: article.sourceName,
        sourceSection: article.sourceSection,
        sourceDomain: article.sourceDomain,
        sourceUrl: article.sourceUrl,
        publishedAt: article.publishedAt?.toISOString(),
        coverImageUrl: article.coverImageUrl || undefined,
        contentBlocks: article.contentBlocks,
        tags: article.tags,
        updatedAt: article.updatedAt?.toISOString(),
      })),
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('[content] listYouthArticles failed:', error);
    res.status(500).json({ message: 'Youth article feed request failed' });
  }
}
