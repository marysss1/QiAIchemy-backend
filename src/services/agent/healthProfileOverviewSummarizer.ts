import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { createChatCompletion } from '../llm/greatRouterClient';

type HealthSignalLike = {
  title: string;
  severity: 'watch' | 'high';
  occurrenceCount: number;
  latestMessage: string;
};

type UserHealthOverviewInput = {
  age?: number;
  gender?: string;
  heightCm?: number;
  weightKg?: number;
  latestSignals: HealthSignalLike[];
  trackedSignals: HealthSignalLike[];
};

function fallbackOverview(input: UserHealthOverviewInput): string {
  const latestCount = input.latestSignals.length;
  const highRiskCount = input.latestSignals.filter(signal => signal.severity === 'high').length;
  const topSignals = input.trackedSignals
    .slice()
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount)
    .slice(0, 3)
    .map(signal => signal.title);

  const demographicBits = [
    typeof input.age === 'number' ? `${input.age}岁` : '',
    input.gender ? `性别${input.gender}` : '',
  ].filter(Boolean);

  const prefix = demographicBits.length > 0 ? `${demographicBits.join('，')}用户` : '该用户';
  if (latestCount === 0) {
    return `${prefix}当前未识别出明显异常，历史记录以持续观察为主。`;
  }

  return `${prefix}本次识别到 ${latestCount} 项异常，其中高风险 ${highRiskCount} 项；当前重点关注 ${
    topSignals.join('、') || '睡眠与恢复'
  }。`;
}

function extractJsonBlock(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export async function summarizeHealthProfileOverview(input: UserHealthOverviewInput): Promise<string> {
  if (input.latestSignals.length === 0 && input.trackedSignals.length === 0) {
    return fallbackOverview(input);
  }

  const prompt = [
    '你是健康画像摘要助手。',
    '请根据用户基础信息和健康异常记录，总结一段 60-120 字的中文健康总览。',
    '要求：',
    '1. 概括当前主要问题、长期趋势和优先关注点。',
    '2. 必须带数字，例如异常项数量、高风险数量、出现次数。',
    '3. 不要给医疗诊断，只做健康画像总结。',
    '4. 只输出 JSON，格式为 {"overview":"..."}。',
    `年龄: ${input.age ?? '未知'}`,
    `性别: ${input.gender ?? '未知'}`,
    `身高: ${input.heightCm ?? '未知'} cm`,
    `体重: ${input.weightKg ?? '未知'} kg`,
    `本次异常: ${input.latestSignals.map(signal => `${signal.title}(${signal.severity})`).join(' | ') || '无'}`,
    `累计异常: ${input.trackedSignals
      .map(signal => `${signal.title}(${signal.occurrenceCount}次)`)
      .join(' | ') || '无'}`,
  ].join('\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: '你只输出 JSON。' },
    { role: 'user', content: prompt },
  ];

  try {
    const completion = await createChatCompletion(messages, {
      temperature: 0,
      max_tokens: 180,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const jsonBlock = extractJsonBlock(raw);
    if (!jsonBlock) {
      return fallbackOverview(input);
    }

    const parsed = JSON.parse(jsonBlock) as { overview?: string };
    const overview = parsed.overview?.replace(/\s+/g, ' ').trim() ?? '';
    return overview || fallbackOverview(input);
  } catch {
    return fallbackOverview(input);
  }
}
