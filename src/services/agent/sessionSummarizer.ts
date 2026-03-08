import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { createChatCompletion } from '../llm/greatRouterClient';

type SessionMessageLike = {
  role: 'user' | 'assistant';
  content: string;
};

export type SessionSummaryResult = {
  title: string;
  summary: string;
};

function trimSentence(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function fallbackSummary(
  messages: SessionMessageLike[],
  sessionType: 'manual' | 'login_health_review'
): SessionSummaryResult {
  const firstUser = messages.find(item => item.role === 'user')?.content ?? '';
  const lastAssistant = [...messages].reverse().find(item => item.role === 'assistant')?.content ?? '';
  const title = trimSentence(firstUser, 16) || (sessionType === 'login_health_review' ? '登录健康分析' : '健康对话');
  const summarySource = lastAssistant || firstUser || '围绕健康问题进行了简短交流。';
  return {
    title,
    summary: trimSentence(summarySource, 68) || '围绕健康问题进行了简短交流。',
  };
}

function extractJsonBlock(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export async function summarizeChatSession(
  messages: SessionMessageLike[],
  sessionType: 'manual' | 'login_health_review'
): Promise<SessionSummaryResult> {
  const normalizedMessages = messages
    .map(item => ({
      role: item.role,
      content: item.content.replace(/\s+/g, ' ').trim(),
    }))
    .filter(item => item.content.length > 0)
    .slice(-12);

  if (normalizedMessages.length === 0) {
    return fallbackSummary(messages, sessionType);
  }

  const transcript = normalizedMessages
    .map((item, index) => `${index + 1}. ${item.role === 'user' ? '用户' : '助手'}：${item.content}`)
    .join('\n');

  const systemPrompt = [
    '你是健康对话记录助手。',
    '请根据一段用户与中医健康助手的对话，生成一个简短标题和一句摘要。',
    '要求：',
    '1. 标题 6-16 个中文字符，不要带标点。',
    '2. 摘要 24-68 个中文字符，突出主诉、关键异常或调理方向。',
    '3. 只输出 JSON，不要输出 markdown。',
    '4. JSON 格式必须为 {"title":"...","summary":"..."}。',
  ].join('\n');

  const userPrompt = [
    `会话类型：${sessionType === 'login_health_review' ? '登录后主动健康分析' : '普通问诊对话'}`,
    '对话内容如下：',
    transcript,
  ].join('\n');

  const messagesForModel: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const completion = await createChatCompletion(messagesForModel, {
      temperature: 0,
      max_tokens: 180,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const jsonBlock = extractJsonBlock(raw);
    if (!jsonBlock) {
      return fallbackSummary(messages, sessionType);
    }

    const parsed = JSON.parse(jsonBlock) as { title?: string; summary?: string };
    const title = trimSentence(parsed.title ?? '', 16);
    const summary = trimSentence(parsed.summary ?? '', 68);
    if (!title || !summary) {
      return fallbackSummary(messages, sessionType);
    }

    return { title, summary };
  } catch {
    return fallbackSummary(messages, sessionType);
  }
}
