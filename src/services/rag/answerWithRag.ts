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

function buildSystemPrompt(): string {
  return [
    '你是 QiAIchemy 的中医知识助手。',
    '回答必须严格基于提供的参考资料，不要编造。若证据不足，明确说“根据当前资料无法确定”。',
    '用中文回答，结构清晰，尽量给出要点。',
    '每个关键结论后都要附引用标签，例如 [C1]、[C2]。',
    '不要给出替代医生诊断的结论；涉及疾病或紧急症状时提醒线下就医。',
  ].join('\n');
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

export async function answerWithRag(question: string, topK = env.RAG_TOP_K): Promise<RagAnswerResult> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    throw new Error('Question is empty');
  }

  const evidence = await retrieveRelevantChunks(trimmedQuestion, topK);
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: [
        '用户问题：',
        trimmedQuestion,
        '',
        '参考资料（引用时请用 [C1]/[C2] 标签）：',
        buildContextBlock(evidence),
      ].join('\n'),
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
