import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { env } from '../../config/env';

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!env.GREATROUTER_API_KEY) {
    throw new Error(
      'GREATROUTER_API_KEY is missing. Configure it in server environment (.env in dev, env vars in production).'
    );
  }

  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: env.GREATROUTER_API_KEY,
      baseURL: env.GREATROUTER_BASE_URL,
      timeout: 120_000,
    });
  }

  return cachedClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  const maybeError = error as { status?: number; statusCode?: number };
  const status = maybeError?.status ?? maybeError?.statusCode;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries || !isRetryableError(error)) {
        throw error;
      }
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }
  }
}

export async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const response = await withRetry(() =>
    getClient().embeddings.create({
      model: env.EMBEDDING_MODEL,
      input: inputs,
    })
  );

  return response.data.map((item) => item.embedding);
}

export async function createChatCompletion(
  messages: ChatCompletionMessageParam[],
  options?: Partial<Omit<ChatCompletionCreateParamsNonStreaming, 'messages'>>
): Promise<ChatCompletion> {
  const model = options?.model ?? env.LLM_CHAT_MODEL;
  return withRetry(() =>
    getClient().chat.completions.create({
      model,
      messages,
      temperature: env.LLM_TEMPERATURE,
      max_tokens: env.LLM_MAX_TOKENS,
      ...options,
    })
  );
}

export { getClient as greatRouterClient };
