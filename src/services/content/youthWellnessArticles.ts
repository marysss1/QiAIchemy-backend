import { load } from 'cheerio';
import {
  YouthWellnessArticle,
  type YouthWellnessArticleBlock,
  type YouthWellnessArticleDocument,
} from '../../models/YouthWellnessArticle';

const ARTICLE_REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ARTICLES_PER_SOURCE = 4;

type SourceConfig = {
  id: string;
  sourceName: string;
  sourceSection: string;
  sourceDomain: string;
  listingUrl: string;
  fallbackCoverImageUrl: string;
  articleContainerSelectors: string[];
};

type ScrapedArticle = {
  slug: string;
  title: string;
  summary: string;
  author?: string;
  sourceName: string;
  sourceSection: string;
  sourceDomain: string;
  sourceUrl: string;
  publishedAt?: Date;
  coverImageUrl?: string;
  contentBlocks: YouthWellnessArticleBlock[];
  tags: string[];
  fetchedAt: Date;
  syncedAt: Date;
};

const YOUTH_ARTICLE_KEYWORDS = [
  '青年',
  '养生',
  '睡眠',
  '失眠',
  '熬夜',
  '焦虑',
  '情绪',
  '压力',
  '久坐',
  '肩颈',
  '控糖',
  '代谢',
  '祛湿',
  '健脾',
  '上火',
  '作息',
  '运动',
  '疲劳',
  '脾胃',
  '护肺',
  '睡',
  '调理',
];

const SOURCES: SourceConfig[] = [
  {
    id: 'dongfang-kepu',
    sourceName: '北京中医药大学东方医院',
    sourceSection: '科普园地',
    sourceDomain: 'www.dongfangyy.com.cn',
    listingUrl: 'https://www.dongfangyy.com.cn/Html/News/Columns/512/Index.html',
    fallbackCoverImageUrl: 'https://www.dongfangyy.com.cn/Content/Areas/Common/images/logo/wxShare.jpg',
    articleContainerSelectors: ['.article_cont', '.article_right', '.article_cont p', 'article'],
  },
  {
    id: 'dongfang-health-edu',
    sourceName: '北京中医药大学东方医院',
    sourceSection: '健康教育',
    sourceDomain: 'www.dongfangyy.com.cn',
    listingUrl: 'https://www.dongfangyy.com.cn/Html/News/Columns/654/Index.html',
    fallbackCoverImageUrl: 'https://www.dongfangyy.com.cn/Content/Areas/Common/images/logo/wxShare.jpg',
    articleContainerSelectors: ['.article_cont', '.article_right', '.article_cont p', 'article'],
  },
];

let syncPromise: Promise<number> | null = null;

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/^﻿/, '').trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = cleanText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function buildSummary(paragraphs: string[]): string {
  return truncateText(paragraphs.slice(0, 2).join(' '), 120);
}

function extractArticleId(url: string): string {
  const match = url.match(/Articles\/(\d+)\.html/i);
  return match?.[1] ?? String(Buffer.from(url).toString('base64url')).slice(0, 12);
}

function youthRelevanceScore(title: string, previewText = ''): number {
  const haystack = `${title} ${previewText}`;
  return YOUTH_ARTICLE_KEYWORDS.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function parsePublishedAt(rawValue: string | undefined): Date | undefined {
  if (!rawValue) {
    return undefined;
  }

  const match = rawValue.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function findBestContainer(html: string, selectors: string[]): ReturnType<typeof load> {
  const $ = load(html);
  for (const selector of selectors) {
    const container = $(selector).first();
    if (container.length > 0 && cleanText(container.text()).length >= 120) {
      return load(container.html() ?? '');
    }
  }
  return load($.root().html() ?? '');
}

function extractContentLines(html: string): string[] {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');
  const $ = load(`<div>${withBreaks}</div>`);
  return $('div')
    .text()
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);
}

function stripMetadataLines(lines: string[]): string[] {
  return lines.filter((line) => {
    if (line.length < 2) {
      return false;
    }

    const normalized = line.replace(/\s+/g, '');
    if (
      normalized.startsWith('作者：') ||
      normalized.startsWith('来源：') ||
      normalized.startsWith('发布时间：') ||
      normalized.startsWith('浏览次数：') ||
      normalized.startsWith('字号：')
    ) {
      return false;
    }

    return !['健康课堂', '科普园地', '用药知识', '健康教育'].includes(line);
  });
}

function buildContentBlocks(paragraphs: string[], coverImageUrl: string | undefined, sourceName: string): YouthWellnessArticleBlock[] {
  const blocks: YouthWellnessArticleBlock[] = [];

  if (coverImageUrl) {
    blocks.push({
      kind: 'image',
      imageUrl: coverImageUrl,
      caption: sourceName,
    });
  }

  paragraphs.slice(0, 10).forEach((paragraph) => {
    blocks.push({
      kind: 'paragraph',
      text: paragraph,
    });
  });

  return blocks;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (QiAIchemy Content Bot)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('utf8');
}

function absoluteUrl(baseUrl: string, rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
}

async function scrapeArticle(source: SourceConfig, articleUrl: string, syncedAt: Date): Promise<ScrapedArticle | null> {
  const html = await fetchHtml(articleUrl);
  const $ = load(html);
  const title =
    cleanText($('.article_title').first().text()) ||
    cleanText($('h1').first().text()) ||
    cleanText($('title').first().text()).replace(/\s*-\s*北京中医药大学东方医院.*$/, '');

  if (!title) {
    return null;
  }

  const articleContainer = findBestContainer(html, source.articleContainerSelectors);
  const containerHtml = articleContainer.root().html() ?? '';
  const lines = stripMetadataLines(extractContentLines(containerHtml));
  const paragraphs = lines.filter((line) => line.length >= 12).slice(0, 12);
  if (paragraphs.length < 3) {
    return null;
  }

  const previewText = paragraphs.slice(0, 3).join(' ');
  if (youthRelevanceScore(title, previewText) <= 0) {
    return null;
  }

  const metaText = cleanText($('.article_right').first().text());
  const publishedAt = parsePublishedAt(metaText);
  const authorMatch = metaText.match(/作者[:：]\s*([^\s]+)/);
  const imageCandidates = $('.article_cont img, .article_right img')
    .map((_, element) => absoluteUrl(articleUrl, $(element).attr('src') ?? $(element).attr('data-original')))
    .get()
    .filter((value): value is string => Boolean(value))
    .filter((value) => !value.includes('logo') && !value.includes('wxShare'));
  const coverImageUrl = imageCandidates[0] ?? source.fallbackCoverImageUrl;

  return {
    slug: `${source.id}-${extractArticleId(articleUrl)}`,
    title,
    summary: buildSummary(paragraphs),
    author: authorMatch?.[1]?.trim(),
    sourceName: source.sourceName,
    sourceSection: source.sourceSection,
    sourceDomain: source.sourceDomain,
    sourceUrl: articleUrl,
    publishedAt,
    coverImageUrl,
    contentBlocks: buildContentBlocks(paragraphs, coverImageUrl, source.sourceName),
    tags: YOUTH_ARTICLE_KEYWORDS.filter((keyword) => `${title} ${previewText}`.includes(keyword)).slice(0, 6),
    fetchedAt: new Date(),
    syncedAt,
  };
}

async function scrapeSource(source: SourceConfig, syncedAt: Date): Promise<ScrapedArticle[]> {
  const html = await fetchHtml(source.listingUrl);
  const $ = load(html);
  const linkMap = new Map<string, { title: string; score: number }>();

  $('a[href]').each((_, element) => {
    const title = cleanText($(element).text());
    const href = absoluteUrl(source.listingUrl, $(element).attr('href'));
    if (!href || !href.includes('/Html/News/Articles/') || !title) {
      return;
    }

    const score = youthRelevanceScore(title);
    if (score <= 0) {
      return;
    }

    const existing = linkMap.get(href);
    if (!existing || score > existing.score) {
      linkMap.set(href, { title, score });
    }
  });

  const candidates = [...linkMap.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_ARTICLES_PER_SOURCE + 4);

  const articles: ScrapedArticle[] = [];
  for (const [url] of candidates) {
    try {
      const article = await scrapeArticle(source, url, syncedAt);
      if (article) {
        articles.push(article);
      }
    } catch (error) {
      console.warn('[content] scrape article failed:', url, error);
    }

    if (articles.length >= MAX_ARTICLES_PER_SOURCE) {
      break;
    }
  }

  return articles;
}

export async function syncYouthWellnessArticles(force = false): Promise<number> {
  if (!force && syncPromise) {
    return syncPromise;
  }

  const run = async () => {
    const syncedAt = new Date();
    const articles = (await Promise.all(SOURCES.map((source) => scrapeSource(source, syncedAt)))).flat();

    for (const article of articles) {
      await YouthWellnessArticle.updateOne(
        { sourceUrl: article.sourceUrl },
        {
          $set: article,
        },
        { upsert: true }
      );
    }

    return articles.length;
  };

  syncPromise = run().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

export async function ensureFreshYouthWellnessArticles(): Promise<void> {
  const latestArticle = await YouthWellnessArticle.findOne({}, { syncedAt: 1 }).sort({ syncedAt: -1 }).lean();
  const latestSyncedAt = latestArticle?.syncedAt ? new Date(latestArticle.syncedAt).getTime() : 0;
  const needsRefresh = !latestSyncedAt || Date.now() - latestSyncedAt >= ARTICLE_REFRESH_INTERVAL_MS;

  if (needsRefresh) {
    try {
      await syncYouthWellnessArticles();
    } catch (error) {
      console.warn('[content] ensureFreshYouthWellnessArticles failed:', error);
    }
  }
}

export async function listYouthWellnessArticles(limit = 6): Promise<YouthWellnessArticleDocument[]> {
  await ensureFreshYouthWellnessArticles();
  return YouthWellnessArticle.find()
    .sort({ publishedAt: -1, syncedAt: -1, updatedAt: -1 })
    .limit(limit);
}

export async function getLatestYouthWellnessSyncTime(): Promise<Date | null> {
  const latestArticle = await YouthWellnessArticle.findOne({}, { syncedAt: 1 }).sort({ syncedAt: -1 }).lean();
  return latestArticle?.syncedAt ? new Date(latestArticle.syncedAt) : null;
}
