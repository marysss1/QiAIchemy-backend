import 'dotenv/config';
import { promises as fs } from 'node:fs';
import mongoose from 'mongoose';
import path from 'node:path';
import { connectToDatabase } from '../config/db';
import { env } from '../config/env';
import { answerWithRag } from '../services/rag/answerWithRag';
import { createChatCompletion } from '../services/llm/greatRouterClient';

type EvalCase = {
  id: string;
  category: string;
  question: string;
  expectedKeywords: string[];
  expectedSourceHints: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  rubric: string;
};

type CaseResult = {
  id: string;
  category: string;
  difficulty: string;
  citationCount: number;
  citationPresence: boolean;
  sourceHintHit: boolean;
  keywordCoverage: number;
  evidenceKeywordCoverage: number;
  judgeFactualityScore?: number;
  judgeReason?: string;
  answerPreview: string;
};

function parseLimitArg(): number | undefined {
  const limitFlagIndex = process.argv.findIndex((arg) => arg === '--limit');
  if (limitFlagIndex >= 0 && process.argv[limitFlagIndex + 1]) {
    const parsed = Number(process.argv[limitFlagIndex + 1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/g, '');
}

function coverageRate(text: string, keywords: string[]): number {
  if (!keywords.length) {
    return 1;
  }
  const normalizedText = normalizeForMatch(text);
  let hits = 0;
  for (const keyword of keywords) {
    if (normalizeForMatch(keyword) && normalizedText.includes(normalizeForMatch(keyword))) {
      hits += 1;
    }
  }
  return hits / keywords.length;
}

async function maybeJudgeFactuality(
  evalCase: EvalCase,
  answer: string,
  evidence: string
): Promise<{ score?: number; reason?: string }> {
  if (!env.RAG_JUDGE_MODEL) {
    return {};
  }

  const response = await createChatCompletion(
    [
      {
        role: 'system',
        content:
          '你是严格的事实一致性评估器。只输出 JSON，格式为 {"score":0-1,"reason":"..."}，score 越高代表回答越被证据支持。',
      },
      {
        role: 'user',
        content: [
          `问题：${evalCase.question}`,
          `评分标准：${evalCase.rubric}`,
          `参考证据：\n${evidence}`,
          `回答：\n${answer}`,
          '请评估回答是否被证据支持，不要考虑文风。',
        ].join('\n\n'),
      },
    ],
    {
      model: env.RAG_JUDGE_MODEL,
      temperature: 0,
      max_tokens: 220,
    }
  );

  const content = response.choices[0]?.message?.content?.trim() ?? '';
  const jsonTextMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonTextMatch) {
    return {};
  }

  try {
    const parsed = JSON.parse(jsonTextMatch[0]) as { score?: number; reason?: string };
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : undefined;
    return { score, reason: parsed.reason };
  } catch {
    return {};
  }
}

async function readEvalSet(filePath: string): Promise<EvalCase[]> {
  const content = await fs.readFile(filePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalCase);
}

async function main(): Promise<void> {
  const setPath = path.isAbsolute(env.RAG_EVAL_SET_PATH)
    ? env.RAG_EVAL_SET_PATH
    : path.resolve(process.cwd(), env.RAG_EVAL_SET_PATH);
  const reportDir = path.isAbsolute(env.RAG_EVAL_REPORT_DIR)
    ? env.RAG_EVAL_REPORT_DIR
    : path.resolve(process.cwd(), env.RAG_EVAL_REPORT_DIR);
  await fs.mkdir(reportDir, { recursive: true });

  const allCases = await readEvalSet(setPath);
  const limit = parseLimitArg();
  const cases = typeof limit === 'number' ? allCases.slice(0, limit) : allCases;

  console.log(`[rag:eval] loaded ${cases.length} cases`);
  await connectToDatabase();

  const caseResults: CaseResult[] = [];
  for (const evalCase of cases) {
    const rag = await answerWithRag(evalCase.question, env.RAG_TOP_K);
    const evidenceText = rag.citations.map((item) => `[${item.label}] ${item.excerpt}`).join('\n');
    const answerKeywordCoverage = coverageRate(rag.answer, evalCase.expectedKeywords);
    const evidenceKeywordCoverage = coverageRate(evidenceText, evalCase.expectedKeywords);
    const sourceHintHit = evalCase.expectedSourceHints.some((hint) =>
      rag.citations.some((citation) =>
        normalizeForMatch(
          `${citation.sourceTitle} ${citation.sourcePath ?? ''} ${citation.sectionTitle ?? ''}`
        ).includes(normalizeForMatch(hint))
      )
    );

    const judge = await maybeJudgeFactuality(evalCase, rag.answer, evidenceText);
    caseResults.push({
      id: evalCase.id,
      category: evalCase.category,
      difficulty: evalCase.difficulty,
      citationCount: rag.citations.length,
      citationPresence: rag.citations.length > 0,
      sourceHintHit,
      keywordCoverage: Number(answerKeywordCoverage.toFixed(4)),
      evidenceKeywordCoverage: Number(evidenceKeywordCoverage.toFixed(4)),
      judgeFactualityScore: typeof judge.score === 'number' ? Number(judge.score.toFixed(4)) : undefined,
      judgeReason: judge.reason,
      answerPreview: rag.answer.slice(0, 160),
    });

    console.log(
      `[rag:eval] ${evalCase.id} citations=${rag.citations.length} sourceHit=${sourceHintHit} answerKW=${answerKeywordCoverage.toFixed(2)}`
    );
  }

  const total = caseResults.length;
  const citationPresenceRate =
    caseResults.filter((item) => item.citationPresence).length / Math.max(total, 1);
  const sourceHintHitRate =
    caseResults.filter((item) => item.sourceHintHit).length / Math.max(total, 1);
  const avgKeywordCoverage =
    caseResults.reduce((sum, item) => sum + item.keywordCoverage, 0) / Math.max(total, 1);
  const avgEvidenceKeywordCoverage =
    caseResults.reduce((sum, item) => sum + item.evidenceKeywordCoverage, 0) / Math.max(total, 1);
  const judgeScores = caseResults
    .map((item) => item.judgeFactualityScore)
    .filter((value): value is number => typeof value === 'number');
  const avgJudgeFactualityScore = judgeScores.length
    ? judgeScores.reduce((sum, score) => sum + score, 0) / judgeScores.length
    : undefined;

  const report = {
    generatedAt: new Date().toISOString(),
    evalSetPath: setPath,
    totalCases: total,
    summary: {
      citationPresenceRate: Number(citationPresenceRate.toFixed(4)),
      sourceHintHitRate: Number(sourceHintHitRate.toFixed(4)),
      avgKeywordCoverage: Number(avgKeywordCoverage.toFixed(4)),
      avgEvidenceKeywordCoverage: Number(avgEvidenceKeywordCoverage.toFixed(4)),
      avgJudgeFactualityScore:
        typeof avgJudgeFactualityScore === 'number'
          ? Number(avgJudgeFactualityScore.toFixed(4))
          : undefined,
    },
    cases: caseResults,
  };

  const outputPath = path.join(
    reportDir,
    `rag-eval-report-${Date.now()}.json`
  );
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[rag:eval] report -> ${outputPath}`);
}

main()
  .catch((error) => {
    console.error('[rag:eval] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
