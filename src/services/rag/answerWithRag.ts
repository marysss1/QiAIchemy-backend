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

export type RagResponseStyle = 'default' | 'readable';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RagPersonalizedOptions {
  question: string;
  topK?: number;
  conversationHistory?: ConversationTurn[];
  healthContext?: string;
  responseStyle?: RagResponseStyle;
  temperature?: number;
  maxTokens?: number;
}

const HEALTH_DOMAIN_HINTS = [
  '中医',
  '养生',
  '健康',
  '调理',
  '症状',
  '体征',
  '睡眠',
  '失眠',
  '熬夜',
  '心悸',
  '乏力',
  '疲劳',
  '焦虑',
  '压力',
  '情绪',
  '饮食',
  '食欲',
  '胃',
  '脾',
  '肝',
  '肺',
  '肾',
  '血糖',
  '血氧',
  '心率',
  'hrv',
  '血压',
  '体重',
  'bmi',
  '运动',
  '步数',
  '头痛',
  '腹痛',
  '胸闷',
  '腹泻',
  '便秘',
  '咳嗽',
  '月经',
  '经期',
  '恢复',
  '亚健康',
];

function buildSystemPrompt(personalized: boolean, responseStyle: RagResponseStyle): string {
  const lines = [
    '你是 QiAIchemy 的中医知识助手。',
    '回答必须严格基于提供的参考资料，不要编造。若证据不足，明确说“根据当前资料无法确定”。',
    '用中文回答，结构清晰，尽量给出要点。',
    '每个关键结论后都要附引用标签，例如 [C1]、[C2]。',
    '不要给出替代医生诊断的结论；涉及疾病或紧急症状时提醒线下就医。',
    '如果用户问题明显不属于中医、健康、养生或健康数据解读范围，直接说明当前助手不处理该类任务，不要勉强套用现有资料回答。',
  ];

  if (personalized) {
    lines.push('如果提供了用户健康快照，请结合该数据给出个性化建议，并明确“基于用户数据”的依据，避免过度推断。');
  }

  if (responseStyle === 'readable') {
    lines.push(
      '请严格按以下 Markdown 结构输出，且不要添加其他一级/二级标题：',
      '### 一句话结论',
      '1 句话，直接回答用户问题，结尾带引用标签。',
      '### 证据链（指标→症状→证候）',
      '2-4 条短句，每条使用“→”连接，并带引用标签。',
      '### 7天执行计划',
      '按 D1~D7 给出可执行动作，优先量化（时间/频次/分钟）。',
      '### 每日监测KPI',
      '列 3-5 个指标，不要空泛。',
      '### 红旗与就医',
      '给 1-2 条需要线下就医的触发条件。',
      '### 引用对照',
      '按 [C#] 对应一句来源说明。',
      '总字数控制在 260~420 字，避免重复与套话。'
    );
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

function isLikelyHealthQuery(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return HEALTH_DOMAIN_HINTS.some((keyword) => normalized.includes(keyword));
}

function hasUsableEvidence(question: string, evidence: RetrievedChunk[]): boolean {
  if (evidence.length === 0) {
    return false;
  }

  const likelyHealthQuery = isLikelyHealthQuery(question);
  const topScore = evidence[0]?.score ?? 0;
  const topLexical = evidence[0]?.lexicalScore ?? 0;
  const topEmbedding = evidence[0]?.embeddingScore ?? 0;
  const supportiveHits = evidence.filter((item) => item.score >= 0.25).length;

  if (!likelyHealthQuery) {
    return topScore >= 0.28 && supportiveHits >= 2;
  }

  if (topScore >= 0.3) {
    return true;
  }

  return supportiveHits >= 2 && (topLexical >= 0.04 || topEmbedding >= 0.58);
}

function buildOutOfScopeAnswer(question: string): string {
  if (!isLikelyHealthQuery(question)) {
    return [
      '当前助手聚焦中医健康、养生和健康数据解读。',
      '你这条问题更像通用规划/生活安排任务，不属于当前知识库覆盖范围，所以不适合硬答。',
      '如果你愿意，可以改成健康相关问法，例如：',
      '1. “带老人和孩子去成都 5 天，如何安排作息、步行量和饮食，减少疲劳？”',
      '2. “旅行期间老人睡眠浅、孩子作息乱，怎么做中医养生式安排？”',
    ].join('\n');
  }

  return [
    '当前知识库里没有足够直接的证据支持这条回答，所以我不想硬凑结论。',
    '你可以补充更具体的健康信息，例如症状、持续时间、近期作息、饮食、活动和关键指标，我再按中医健康框架重答。',
  ].join('\n');
}

export async function answerWithRagPersonalized(
  options: RagPersonalizedOptions
): Promise<RagAnswerResult> {
  const topK = options.topK ?? env.RAG_TOP_K;
  const responseStyle = options.responseStyle ?? 'default';
  const trimmedQuestion = options.question.trim();
  if (!trimmedQuestion) {
    throw new Error('Question is empty');
  }

  const graphContext = [
    options.healthContext ?? '',
    ...(options.conversationHistory?.map((item) => `${item.role}:${item.content}`) ?? []),
  ]
    .join('\n')
    .trim();

  const evidence = await retrieveRelevantChunks(trimmedQuestion, topK, {
    graphContext: graphContext || undefined,
  });

  if (!hasUsableEvidence(trimmedQuestion, evidence)) {
    return {
      answer: buildOutOfScopeAnswer(trimmedQuestion),
      citations: [],
      evidenceCount: evidence.length,
      model: env.LLM_CHAT_MODEL,
    };
  }

  const personalized = Boolean(
    (options.conversationHistory && options.conversationHistory.length > 0) || options.healthContext
  );
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(personalized, responseStyle) },
    {
      role: 'user',
      content: buildUserContent(trimmedQuestion, evidence, options.conversationHistory, options.healthContext),
    },
  ];

  const completion = await createChatCompletion(messages, {
    temperature: options.temperature ?? env.LLM_TEMPERATURE,
    max_tokens: options.maxTokens ?? env.LLM_MAX_TOKENS,
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
