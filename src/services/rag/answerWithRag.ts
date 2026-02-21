import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { env } from '../../config/env';
import { createChatCompletion } from '../llm/greatRouterClient';
import { retrieveRelevantChunks, type RetrievedChunk } from './retrieve';

export interface CitationItem {
  id: string;
  label: string;
  sourceId: string;
  sourceTitle: string;
  sourcePath?: string;
  sectionTitle?: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
}

export interface RagAnswerResult {
  answer: string;
  citations: CitationItem[];
  evidenceCount: number;
  model: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RagPersonalizedOptions {
  question: string;
  topK?: number;
  conversationHistory?: ConversationTurn[];
  healthContext?: string;
}

function buildSystemPrompt(personalized: boolean): string {
  const lines = [
    '你是 QiAIchemy 的中医知识助手。',
    '回答必须严格基于提供的参考资料，不要编造。若证据不足，明确说“根据当前资料无法确定”。',
    '用中文回答，结构清晰，尽量给出要点。',
    '每个关键结论后都要附引用标签，例如 [C1]、[C2]。',
    '不要给出替代医生诊断的结论；涉及疾病或紧急症状时提醒线下就医。',
  ];

  if (personalized) {
    lines.push('如果提供了用户健康快照，请结合该数据给出个性化建议，并明确“基于用户数据”的依据，避免过度推断。');
  }

  return lines.join('\n');
}

function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (!chunks.length) {
    return '无可用参考资料。';
  }

  return chunks
    .map((item, index) => {
      const label = `C${index + 1}`;
      const header = `[${label}] ${item.sourceTitle} | ${item.sectionTitle || '未分节'} | chunk=${item.chunkIndex}`;
      return `${header}\n${item.text}`;
    })
    .join('\n\n---\n\n');
}

function toCitations(chunks: RetrievedChunk[]): CitationItem[] {
  return chunks.map((item, index) => ({
    id: item.id,
    label: `C${index + 1}`,
    sourceId: item.sourceId,
    sourceTitle: item.sourceTitle,
    sourcePath: item.sourcePath,
    sectionTitle: item.sectionTitle,
    chunkIndex: item.chunkIndex,
    excerpt: item.text.slice(0, 240),
    score: Number(item.score.toFixed(6)),
  }));
}

function buildConversationBlock(history: ConversationTurn[] | undefined): string {
  if (!history || history.length === 0) {
    return '无历史对话。';
  }

  return history
    .slice(-8)
    .map((item, index) => `${index + 1}. ${item.role === 'user' ? '用户' : '助手'}：${item.content.trim()}`)
    .join('\n');
}

function buildUserContent(
  question: string,
  evidence: RetrievedChunk[],
  history?: ConversationTurn[],
  healthContext?: string
): string {
  const parts = ['用户问题：', question];

  if (history && history.length > 0) {
    parts.push('', '历史对话（最近若干轮）：', buildConversationBlock(history));
  }

  if (healthContext) {
    parts.push('', '用户健康快照摘要（最近一次）：', healthContext);
  }

  parts.push('', '参考资料（引用时请用 [C1]/[C2] 标签）：', buildContextBlock(evidence));
  return parts.join('\n');
}

export async function answerWithRagPersonalized(
  options: RagPersonalizedOptions
): Promise<RagAnswerResult> {
  const topK = options.topK ?? env.RAG_TOP_K;
  const trimmedQuestion = options.question.trim();
  if (!trimmedQuestion) {
    throw new Error('Question is empty');
  }

  const evidence = await retrieveRelevantChunks(trimmedQuestion, topK);
  const personalized = Boolean(
    (options.conversationHistory && options.conversationHistory.length > 0) || options.healthContext
  );
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(personalized) },
    {
      role: 'user',
      content: buildUserContent(trimmedQuestion, evidence, options.conversationHistory, options.healthContext),
    },
  ];

  const completion = await createChatCompletion(messages, {
    temperature: env.LLM_TEMPERATURE,
    max_tokens: env.LLM_MAX_TOKENS,
  });

  const answer = completion.choices[0]?.message?.content?.trim() || '根据当前资料无法确定。';

  return {
    answer,
    citations: toCitations(evidence),
    evidenceCount: evidence.length,
    model: completion.model,
  };
}

export async function answerWithRag(question: string, topK = env.RAG_TOP_K): Promise<RagAnswerResult> {
  return answerWithRagPersonalized({ question, topK });
}
