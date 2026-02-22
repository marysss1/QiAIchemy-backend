import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type EvalCase = {
  id: string;
  difficulty?: string;
  keywordCoverage: number;
  evidenceKeywordCoverage: number;
  sourceHintHit: boolean;
  citationPresence: boolean;
  judgeFactualityScore?: number;
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
  cases: EvalCase[];
};

function parseArg(name: string): string | undefined {
  const idx = process.argv.findIndex((item) => item === name);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function loadReport(filePath: string): Promise<EvalReport> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as EvalReport;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(sortedValues: number[], p: number): number {
  if (!sortedValues.length) {
    return 0;
  }
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * p)));
  return sortedValues[idx];
}

function bootstrapMeanCi(values: number[], rounds = 2000): { lo: number; hi: number } {
  if (values.length === 0) {
    return { lo: 0, hi: 0 };
  }
  const stats: number[] = [];
  for (let i = 0; i < rounds; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) {
      const idx = Math.floor(Math.random() * values.length);
      sum += values[idx];
    }
    stats.push(sum / values.length);
  }
  stats.sort((a, b) => a - b);
  return {
    lo: percentile(stats, 0.025),
    hi: percentile(stats, 0.975),
  };
}

function binomialTwoSidedP(win: number, lose: number): number {
  const n = win + lose;
  if (n === 0) {
    return 1;
  }
  const k = Math.min(win, lose);
  const p0 = Math.pow(0.5, n);
  let cumulative = p0;
  let pk = p0;
  for (let i = 0; i < k; i += 1) {
    pk = (pk * (n - i)) / (i + 1);
    cumulative += pk;
  }
  return Math.min(1, 2 * cumulative);
}

async function main(): Promise<void> {
  const baseArg = parseArg('--base');
  const nextArg = parseArg('--next');

  if (!baseArg || !nextArg) {
    throw new Error('Usage: ts-node src/scripts/compareRagEval.ts --base <base-report.json> --next <next-report.json>');
  }

  const basePath = path.resolve(process.cwd(), baseArg);
  const nextPath = path.resolve(process.cwd(), nextArg);
  const [base, next] = await Promise.all([loadReport(basePath), loadReport(nextPath)]);

  const baseMap = new Map(base.cases.map((item) => [item.id, item]));
  const nextMap = new Map(next.cases.map((item) => [item.id, item]));
  const sharedIds = [...baseMap.keys()].filter((id) => nextMap.has(id)).sort();

  if (!sharedIds.length) {
    throw new Error('No overlapping case ids between two reports.');
  }

  const deltas: number[] = [];
  let win = 0;
  let lose = 0;
  let tie = 0;
  let sourceHitBase = 0;
  let sourceHitNext = 0;

  const rows = sharedIds.map((id) => {
    const b = baseMap.get(id)!;
    const n = nextMap.get(id)!;
    const delta = n.keywordCoverage - b.keywordCoverage;
    deltas.push(delta);
    if (delta > 0) {
      win += 1;
    } else if (delta < 0) {
      lose += 1;
    } else {
      tie += 1;
    }
    if (b.sourceHintHit) {
      sourceHitBase += 1;
    }
    if (n.sourceHintHit) {
      sourceHitNext += 1;
    }
    return {
      id,
      baseKw: b.keywordCoverage,
      nextKw: n.keywordCoverage,
      delta,
    };
  });

  const avgBase = mean(rows.map((r) => r.baseKw));
  const avgNext = mean(rows.map((r) => r.nextKw));
  const avgDelta = mean(deltas);
  const pValue = binomialTwoSidedP(win, lose);
  const ci = bootstrapMeanCi(deltas, 3000);

  console.log('=== Paired Compare ===');
  console.log(`shared_cases=${sharedIds.length}`);
  console.log(`avg_keyword_coverage_base=${avgBase.toFixed(4)}`);
  console.log(`avg_keyword_coverage_next=${avgNext.toFixed(4)}`);
  console.log(`avg_delta=${avgDelta.toFixed(4)}`);
  console.log(`delta_95ci=[${ci.lo.toFixed(4)}, ${ci.hi.toFixed(4)}]`);
  console.log(`win=${win} lose=${lose} tie=${tie}`);
  console.log(`sign_test_p=${pValue.toExponential(3)}`);
  console.log(`sourceHit_base=${sourceHitBase}/${sharedIds.length}`);
  console.log(`sourceHit_next=${sourceHitNext}/${sharedIds.length}`);

  const improved = [...rows].sort((a, b) => b.delta - a.delta).slice(0, 10);
  const degraded = [...rows].sort((a, b) => a.delta - b.delta).slice(0, 10);

  console.log('\nTop improved cases:');
  for (const row of improved) {
    console.log(
      `+ ${row.id} delta=${row.delta.toFixed(4)} base=${row.baseKw.toFixed(4)} next=${row.nextKw.toFixed(4)}`
    );
  }

  console.log('\nTop degraded cases:');
  for (const row of degraded) {
    console.log(
      `- ${row.id} delta=${row.delta.toFixed(4)} base=${row.baseKw.toFixed(4)} next=${row.nextKw.toFixed(4)}`
    );
  }
}

main().catch((error) => {
  console.error('[rag:eval:compare] failed:', error);
  process.exit(1);
});

