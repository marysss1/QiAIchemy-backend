import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

type EvalCaseResult = {
  id: string;
  category: string;
  citationPresence: boolean;
  sourceHintHit: boolean;
  keywordCoverage: number;
  evidenceKeywordCoverage: number;
};

type EvalReport = {
  generatedAt: string;
  totalCases: number;
  summary: {
    citationPresenceRate: number;
    sourceHintHitRate: number;
    avgKeywordCoverage: number;
    avgEvidenceKeywordCoverage: number;
    avgJudgeFactualityScore?: number;
  };
  cases: EvalCaseResult[];
};

function parseArg(name: string): string | undefined {
  const idx = process.argv.findIndex((item) => item === name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function getLatestReportPath(): Promise<string> {
  const reportDir = path.isAbsolute(env.RAG_EVAL_REPORT_DIR)
    ? env.RAG_EVAL_REPORT_DIR
    : path.resolve(process.cwd(), env.RAG_EVAL_REPORT_DIR);
  const files = await fs.readdir(reportDir);
  const target = files
    .filter((name) => name.startsWith('rag-eval-report-') && name.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))[0];

  if (!target) {
    throw new Error(`No rag eval report found in ${reportDir}`);
  }
  return path.join(reportDir, target);
}

async function loadReport(filePath: string): Promise<EvalReport> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as EvalReport;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function printReport(title: string, report: EvalReport): void {
  console.log(`\\n=== ${title} ===`);
  console.log(`generatedAt: ${report.generatedAt}`);
  console.log(`totalCases: ${report.totalCases}`);
  console.log(`citationPresenceRate: ${pct(report.summary.citationPresenceRate)}`);
  console.log(`sourceHintHitRate: ${pct(report.summary.sourceHintHitRate)}`);
  console.log(`avgKeywordCoverage: ${pct(report.summary.avgKeywordCoverage)}`);
  console.log(`avgEvidenceKeywordCoverage: ${pct(report.summary.avgEvidenceKeywordCoverage)}`);
  if (typeof report.summary.avgJudgeFactualityScore === 'number') {
    console.log(`avgJudgeFactualityScore: ${report.summary.avgJudgeFactualityScore.toFixed(4)}`);
  }

  const weakCases = [...report.cases]
    .sort((a, b) => a.keywordCoverage - b.keywordCoverage)
    .slice(0, 10);

  console.log('\\nLowest keyword coverage cases:');
  for (const item of weakCases) {
    console.log(
      `- ${item.id} [${item.category}] keyword=${pct(item.keywordCoverage)} evidence=${pct(
        item.evidenceKeywordCoverage
      )} sourceHit=${item.sourceHintHit}`
    );
  }
}

function printDelta(base: EvalReport, next: EvalReport): void {
  console.log('\\n=== Delta (next - base) ===');
  const fields: Array<
    'citationPresenceRate' | 'sourceHintHitRate' | 'avgKeywordCoverage' | 'avgEvidenceKeywordCoverage'
  > = [
    'citationPresenceRate',
    'sourceHintHitRate',
    'avgKeywordCoverage',
    'avgEvidenceKeywordCoverage',
  ];
  for (const field of fields) {
    const delta = next.summary[field] - base.summary[field];
    console.log(`${field}: ${(delta * 100).toFixed(2)}pp`);
  }
}

async function main(): Promise<void> {
  const fileArg = parseArg('--file');
  const compareArg = parseArg('--compare');

  const filePath = fileArg ? path.resolve(process.cwd(), fileArg) : await getLatestReportPath();
  const report = await loadReport(filePath);
  printReport('Current Report', report);

  if (compareArg) {
    const base = await loadReport(path.resolve(process.cwd(), compareArg));
    printReport('Base Report', base);
    printDelta(base, report);
  }
}

main().catch((error) => {
  console.error('[rag:eval:summary] failed:', error);
  process.exit(1);
});
