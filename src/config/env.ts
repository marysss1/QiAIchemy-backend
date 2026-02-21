import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(2818),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required').optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars').optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  GREATROUTER_API_KEY: z.string().optional(),
  GREATROUTER_BASE_URL: z.string().url().default('https://endpoint.wendalog.com'),
  LLM_CHAT_MODEL: z.string().default('gpt-4o'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
  RAG_TOP_K: z.coerce.number().int().positive().max(20).default(6),
  RAG_CANDIDATE_LIMIT: z.coerce.number().int().positive().default(300),
  RAG_CHUNK_SIZE: z.coerce.number().int().positive().default(600),
  RAG_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(120),
  RAG_INGEST_DIR: z.string().default('data/knowledge'),
  RAG_GRAPH_PATH: z.string().default('data/graph/tcm_graph_lite.json'),
  RAG_GRAPH_PPR_ALPHA: z.coerce.number().min(0.5).max(0.99).default(0.85),
  RAG_GRAPH_TOP_NODES: z.coerce.number().int().positive().max(40).default(12),
  RAG_EVAL_SET_PATH: z.string().default('data/eval/tcm_eval_120.jsonl'),
  RAG_EVAL_REPORT_DIR: z.string().default('reports'),
  RAG_JUDGE_MODEL: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:');
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;

function requireConfig(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required for this operation`);
  }
  return value;
}

export function requireMongoUri(): string {
  return requireConfig('MONGODB_URI', env.MONGODB_URI);
}

export function requireJwtSecret(): string {
  return requireConfig('JWT_SECRET', env.JWT_SECRET);
}
