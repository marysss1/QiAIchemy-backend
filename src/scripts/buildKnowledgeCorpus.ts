import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { normalizeText } from '../services/rag/textUtils';

type CorpusGroup = {
  sourceDir: string;
  outputFile: string;
  title: string;
};

const GROUPS: CorpusGroup[] = [
  {
    sourceDir: 'data/knowledge_sources/01_huangdi_neijing',
    outputFile: 'data/knowledge/01_huangdi-neijing_core.md',
    title: '黄帝内经（扩展原文语料）',
  },
  {
    sourceDir: 'data/knowledge_sources/02_shanghan_jingui',
    outputFile: 'data/knowledge/02_shanghan_jingui_core.md',
    title: '伤寒论与金匮要略（扩展原文语料）',
  },
  {
    sourceDir: 'data/knowledge_sources/03_wenbing_tiaobian',
    outputFile: 'data/knowledge/03_wenbing_tiaobian_core.md',
    title: '温病条辨（扩展原文语料）',
  },
  {
    sourceDir: 'data/knowledge_sources/04_foundation_diagnosis',
    outputFile: 'data/knowledge/04_tcm_foundation_and_diagnosis.md',
    title: '中医基础理论与诊断（扩展原文语料）',
  },
  {
    sourceDir: 'data/knowledge_sources/05_chronic_youth_subhealth',
    outputFile: 'data/knowledge/05_chronic_disease_tcm_lifestyle.md',
    title: '青年亚健康与慢病管理（扩展原文语料）',
  },
];

const SUPPORTED_EXT = new Set(['.txt', '.md', '.markdown']);
const MIN_CHARS = Number(process.env.KNOWLEDGE_MIN_CHARS ?? 12000);

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    let entries: Dirent[] = [];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXT.has(ext)) {
        result.push(full);
      }
    }
  }

  return result.sort();
}

function sourceHeader(title: string, sourcePath: string): string {
  return [`## 来源: ${sourcePath}`, '', `> 说明: 以下内容为原文导入片段，归属于 ${title} 语料。`, ''].join('\n');
}

async function buildGroup(group: CorpusGroup): Promise<{ chars: number; files: number }> {
  const sourceRoot = path.resolve(process.cwd(), group.sourceDir);
  const targetPath = path.resolve(process.cwd(), group.outputFile);
  const files = await walkFiles(sourceRoot);

  if (files.length === 0) {
    throw new Error(`No source files found in ${group.sourceDir}`);
  }

  const sections: string[] = [];
  for (const filePath of files) {
    const rel = path.relative(sourceRoot, filePath).replace(/[\\/]+/g, '/');
    const raw = await fs.readFile(filePath, 'utf8');
    const normalized = normalizeText(raw);
    if (!normalized) {
      continue;
    }
    sections.push(sourceHeader(group.title, rel));
    sections.push(normalized);
    sections.push('');
  }

  const merged = ['# ' + group.title, '', ...sections].join('\n');
  const charCount = merged.length;
  if (charCount < MIN_CHARS) {
    throw new Error(
      `${group.outputFile} too short (${charCount} chars). Need at least ${MIN_CHARS}. Add more real source text.`
    );
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, merged, 'utf8');

  return { chars: charCount, files: files.length };
}

async function main(): Promise<void> {
  const summary: Array<{ file: string; chars: number; files: number }> = [];
  for (const group of GROUPS) {
    const result = await buildGroup(group);
    summary.push({ file: group.outputFile, chars: result.chars, files: result.files });
    console.log(`[knowledge:build] ${group.outputFile} <- ${result.files} source files, ${result.chars} chars`);
  }

  console.log('[knowledge:build] done');
  for (const item of summary) {
    console.log(`- ${item.file}: ${item.chars} chars (${item.files} sources)`);
  }
}

main().catch((error) => {
  console.error('[knowledge:build] failed:', error);
  process.exit(1);
});
