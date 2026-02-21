import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { tokenizeForSearch } from './textUtils';

type GraphNode = {
  id: string;
  label: string;
  type: string;
  aliases?: string[];
  sourceHints?: string[];
};

type GraphEdge = {
  from: string;
  to: string;
  relation: string;
  weight?: number;
  undirected?: boolean;
};

type GraphLiteDoc = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type GraphRuntime = {
  nodes: GraphNode[];
  nodeMap: Map<string, GraphNode>;
  adj: Map<string, Array<{ to: string; weight: number }>>;
  tokenToNodeIds: Map<string, string[]>;
};

let graphCache: GraphRuntime | null = null;
let graphPathCache = '';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniquePushMap(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, [value]);
    return;
  }
  if (!existing.includes(value)) {
    existing.push(value);
  }
}

async function readGraphDoc(): Promise<GraphLiteDoc> {
  const graphPath = path.isAbsolute(env.RAG_GRAPH_PATH)
    ? env.RAG_GRAPH_PATH
    : path.resolve(process.cwd(), env.RAG_GRAPH_PATH);
  const content = await fs.readFile(graphPath, 'utf8');
  const parsed = JSON.parse(content) as GraphLiteDoc;

  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('Invalid graph document: nodes/edges missing');
  }

  graphPathCache = graphPath;
  return parsed;
}

function buildRuntime(doc: GraphLiteDoc): GraphRuntime {
  const nodeMap = new Map<string, GraphNode>();
  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  const tokenToNodeIds = new Map<string, string[]>();

  for (const node of doc.nodes) {
    if (!node.id || !node.label) {
      continue;
    }
    nodeMap.set(node.id, node);
    if (!adj.has(node.id)) {
      adj.set(node.id, []);
    }
    const text = [node.label, ...(node.aliases ?? [])].join(' ');
    const tokens = tokenizeForSearch(text);
    for (const token of tokens) {
      uniquePushMap(tokenToNodeIds, token, node.id);
    }
  }

  for (const edge of doc.edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
      continue;
    }
    const weight = clamp(edge.weight ?? 1, 0.01, 10);
    adj.get(edge.from)?.push({ to: edge.to, weight });
    if (edge.undirected) {
      adj.get(edge.to)?.push({ to: edge.from, weight });
    }
  }

  return {
    nodes: [...nodeMap.values()],
    nodeMap,
    adj,
    tokenToNodeIds,
  };
}

async function getGraph(): Promise<GraphRuntime | null> {
  try {
    const graphPath = path.isAbsolute(env.RAG_GRAPH_PATH)
      ? env.RAG_GRAPH_PATH
      : path.resolve(process.cwd(), env.RAG_GRAPH_PATH);
    if (graphCache && graphPath === graphPathCache) {
      return graphCache;
    }
    const doc = await readGraphDoc();
    graphCache = buildRuntime(doc);
    return graphCache;
  } catch (error) {
    console.warn('[rag-graph] graph load skipped:', error);
    return null;
  }
}

function buildSeedScores(graph: GraphRuntime, queryText: string, graphContext?: string): Map<string, number> {
  const seeds = new Map<string, number>();
  const merged = [queryText, graphContext ?? ''].join('\n');
  const tokens = tokenizeForSearch(merged);

  for (const token of tokens) {
    const ids = graph.tokenToNodeIds.get(token);
    if (!ids?.length) {
      continue;
    }
    const incr = 1 / ids.length;
    for (const id of ids) {
      seeds.set(id, (seeds.get(id) ?? 0) + incr);
    }
  }

  if (seeds.size === 0) {
    return seeds;
  }

  const max = Math.max(...seeds.values());
  for (const [id, value] of seeds) {
    seeds.set(id, value / max);
  }
  return seeds;
}

function runPersonalizedPageRank(
  graph: GraphRuntime,
  seeds: Map<string, number>,
  alpha = env.RAG_GRAPH_PPR_ALPHA,
  maxIter = 30
): Map<string, number> {
  const nodes = graph.nodes;
  if (!nodes.length || !seeds.size) {
    return new Map();
  }

  const scores = new Map<string, number>();
  const seedNorm = Array.from(seeds.values()).reduce((sum, v) => sum + v, 0) || 1;
  for (const node of nodes) {
    scores.set(node.id, (seeds.get(node.id) ?? 0) / seedNorm);
  }

  for (let iter = 0; iter < maxIter; iter += 1) {
    const next = new Map<string, number>();
    for (const node of nodes) {
      next.set(node.id, (1 - alpha) * ((seeds.get(node.id) ?? 0) / seedNorm));
    }

    for (const node of nodes) {
      const id = node.id;
      const outgoing = graph.adj.get(id) ?? [];
      const current = scores.get(id) ?? 0;
      if (!outgoing.length) {
        next.set(id, (next.get(id) ?? 0) + alpha * current);
        continue;
      }
      const weightSum = outgoing.reduce((sum, e) => sum + e.weight, 0) || 1;
      for (const edge of outgoing) {
        const contrib = alpha * current * (edge.weight / weightSum);
        next.set(edge.to, (next.get(edge.to) ?? 0) + contrib);
      }
    }

    let delta = 0;
    for (const node of nodes) {
      const id = node.id;
      delta += Math.abs((next.get(id) ?? 0) - (scores.get(id) ?? 0));
      scores.set(id, next.get(id) ?? 0);
    }
    if (delta < 1e-6) {
      break;
    }
  }

  return scores;
}

function buildTokenBoostMap(graph: GraphRuntime, nodeScores: Map<string, number>): Map<string, number> {
  const sorted = [...nodeScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, env.RAG_GRAPH_TOP_NODES);
  const tokenBoost = new Map<string, number>();

  for (const [nodeId, score] of sorted) {
    const node = graph.nodeMap.get(nodeId);
    if (!node) {
      continue;
    }
    const tokens = tokenizeForSearch([node.label, ...(node.aliases ?? [])].join(' '));
    for (const token of tokens) {
      const prev = tokenBoost.get(token) ?? 0;
      tokenBoost.set(token, Math.max(prev, score));
    }
  }

  return tokenBoost;
}

export async function computeGraphQueryFeatures(
  queryText: string,
  graphContext?: string
): Promise<{
  tokenBoost: Map<string, number>;
  topNodes: Array<{ nodeId: string; label: string; score: number }>;
}> {
  const graph = await getGraph();
  if (!graph) {
    return { tokenBoost: new Map(), topNodes: [] };
  }

  const seeds = buildSeedScores(graph, queryText, graphContext);
  if (!seeds.size) {
    return { tokenBoost: new Map(), topNodes: [] };
  }

  const nodeScores = runPersonalizedPageRank(graph, seeds);
  const tokenBoost = buildTokenBoostMap(graph, nodeScores);
  const topNodes = [...nodeScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, env.RAG_GRAPH_TOP_NODES)
    .map(([nodeId, score]) => ({
      nodeId,
      label: graph.nodeMap.get(nodeId)?.label ?? nodeId,
      score: Number(score.toFixed(6)),
    }));

  return { tokenBoost, topNodes };
}

export function graphTokenSimilarity(docTokens: string[], tokenBoost: Map<string, number>): number {
  if (!docTokens.length || tokenBoost.size === 0) {
    return 0;
  }

  let hitScore = 0;
  const seen = new Set<string>();
  for (const token of docTokens) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    hitScore += tokenBoost.get(token) ?? 0;
  }

  return hitScore / Math.sqrt(docTokens.length * Math.max(tokenBoost.size, 1));
}

export function reciprocalRankFusion(rank: number, k = 60): number {
  return 1 / (k + rank);
}
