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
  strictTcmScope?: boolean;
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

const IMPLICIT_HEALTH_HINTS = [
  '身体',
  '不舒服',
  '难受',
  '不太对',
  '不对劲',
  '状态差',
  '还有救吗',
  '有救吗',
  '严不严重',
  '怎么办',
  '怎么回事',
  '扛不住',
  '撑不住',
];

const SELF_HARM_HINTS = [
  '自杀',
  '轻生',
  '想死',
  '不想活',
  '活着没意义',
  '结束生命',
  '去死',
  '死了算了',
  '自残',
  '割腕',
  '跳楼',
];

const STRICT_TCM_SCOPE_LINES = [
  '你只能从中医理论、中式养生和健康管理视角回答问题。',
  '禁止提供西医诊断、药物处方、检验指标结论、影像结论、手术方案或替代线下就医的判断。',
  '如果用户追问的内容超出中医健康范围，先明确说明你仅提供中医视角建议，再只给出与中医调理相关的内容；无法从中医视角回答时直接说明不适用。',
];

function buildSystemPrompt(personalized: boolean, responseStyle: RagResponseStyle, strictTcmScope = false): string {
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

  if (strictTcmScope) {
    lines.push(...STRICT_TCM_SCOPE_LINES);
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

function isLikelyHealthQuery(question: string, allowImplicit = true): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (HEALTH_DOMAIN_HINTS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  return allowImplicit && IMPLICIT_HEALTH_HINTS.some((keyword) => normalized.includes(keyword));
}

function hasHealthConversationContext(history: ConversationTurn[] | undefined): boolean {
  return Boolean(history?.some((item) => isLikelyHealthQuery(item.content, true)));
}

function isSelfHarmRiskQuery(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return SELF_HARM_HINTS.some((keyword) => normalized.includes(keyword));
}

function buildSelfHarmCrisisAnswer(): string {
  return [
    '如果你现在有伤害自己或结束生命的想法，请不要一个人扛着，立刻联系身边可信任的人陪你，并马上寻求线下帮助。',
    '中国大陆可以先拨打全国统一心理援助热线 12356；如果已经有现实危险，请直接拨打 120 或 110。',
    '在等待帮助时，请尽量远离刀片、药物、绳索、酒精和其他可能伤害自己的物品，去有人在的地方。',
    '如果你愿意，也可以直接告诉我：你现在是否已经准备实施、身边是否有人、你所在城市，我会先帮你把求助步骤排清楚。',
  ].join('\n');
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

function buildOutOfScopeAnswer(options: {
  question: string;
  healthContext?: string;
  conversationHistory?: ConversationTurn[];
}): string {
  const likelyHealthQuery = isLikelyHealthQuery(options.question, true);
  const hasPersonalContext = Boolean(options.healthContext?.trim()) || hasHealthConversationContext(options.conversationHistory);

  if (!likelyHealthQuery && !hasPersonalContext) {
    return [
      '当前助手主要处理中医健康、养生和健康数据解读。',
      '这条问题暂时不适合直接用现有知识库作答。',
      '如果你愿意，我可以把它改写成健康相关问法，例如：',
      '1. “带老人和孩子去成都 5 天，如何安排作息、步行量和饮食，减少疲劳？”',
      '2. “旅行期间老人睡眠浅、孩子作息乱，怎么做中医养生式安排？”',
    ].join('\n');
  }

  return [
    '我可以继续帮你，但这句话还不足以判断具体问题。',
    '请优先补充这 3 件事：1. 最困扰的症状或感受 2. 持续了多久 3. 最近作息、饮食、压力或运动有哪些明显变化。',
    '如果方便，也可以补充睡眠、步数、心率、血氧、血糖等数据，我会按中医健康框架继续分析。',
    '如果你现在有胸痛、呼吸困难、持续高热、晕厥，或明显的自伤念头，请立刻线下就医或寻求紧急帮助。',
  ].join('\n');
}

async function buildHealthFallbackAnswer(options: {
  question: string;
  healthContext?: string;
  conversationHistory?: ConversationTurn[];
  strictTcmScope?: boolean;
}): Promise<string> {
  const fallbackText = buildOutOfScopeAnswer(options);

  try {
    const systemLines = [
      '你是 QiAIchemy 的健康陪伴模式。',
      '当知识库证据不足时，不要提“知识库覆盖范围”或“检索不到”。',
      '你可以继续结合用户当前语气、上下文和健康场景，用健康相关的方式回应。',
      '优先做三件事：先接住情绪，再给出最稳妥的健康相关方向，再提出 1-3 个澄清问题。',
      '不要做确定性诊断，不要编造检查结果，不要脱离健康话题闲聊。',
      '如果用户情绪明显低落、绝望或带风险，提醒尽快找家人朋友、医生或心理援助热线支持。',
      '输出 3-6 句中文，不要加标题。',
    ];

    if (options.strictTcmScope) {
      systemLines.push(...STRICT_TCM_SCOPE_LINES);
    }

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: systemLines.join('\n'),
      },
    ];

    if (options.healthContext?.trim()) {
      messages.push({
        role: 'system',
        content: `已知健康背景：\n${options.healthContext.trim()}`,
      });
    }

    if (options.conversationHistory?.length) {
      messages.push(
        ...options.conversationHistory.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        }))
      );
    }

    messages.push({
      role: 'user',
      content: options.question,
    });

    const completion = await createChatCompletion(messages, {
      temperature: 0.3,
      max_tokens: 220,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    return text || fallbackText;
  } catch (error) {
    console.warn('[rag] fallback health chat failed, use static fallback:', error);
    return fallbackText;
  }
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

  if (isSelfHarmRiskQuery(trimmedQuestion)) {
    return {
      answer: buildSelfHarmCrisisAnswer(),
      citations: [],
      evidenceCount: 0,
      model: env.LLM_CHAT_MODEL,
    };
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
      answer: await buildHealthFallbackAnswer({
        question: trimmedQuestion,
        healthContext: options.healthContext,
        conversationHistory: options.conversationHistory,
        strictTcmScope: options.strictTcmScope,
      }),
      citations: [],
      evidenceCount: evidence.length,
      model: env.LLM_CHAT_MODEL,
    };
  }

  const personalized = Boolean(
    (options.conversationHistory && options.conversationHistory.length > 0) || options.healthContext
  );
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(personalized, responseStyle, options.strictTcmScope) },
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
