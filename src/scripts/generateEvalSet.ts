import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';

type EvalCase = {
  id: string;
  category: string;
  question: string;
  expectedKeywords: string[];
  expectedSourceHints: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  rubric: string;
};

const TOPICS: Array<{
  category: string;
  target: string;
  keyTerms: string[];
}> = [
  { category: '体质辨识', target: '气虚体质', keyTerms: ['气虚', '乏力', '调养'] },
  { category: '体质辨识', target: '阳虚体质', keyTerms: ['阳虚', '畏寒', '温阳'] },
  { category: '体质辨识', target: '阴虚体质', keyTerms: ['阴虚', '口燥', '滋阴'] },
  { category: '体质辨识', target: '痰湿体质', keyTerms: ['痰湿', '困重', '健脾'] },
  { category: '体质辨识', target: '湿热体质', keyTerms: ['湿热', '口苦', '清热'] },
  { category: '体质辨识', target: '气郁体质', keyTerms: ['气郁', '情志', '疏肝'] },
  { category: '脏腑调理', target: '脾胃虚弱', keyTerms: ['脾胃', '饮食', '作息'] },
  { category: '脏腑调理', target: '肝郁不舒', keyTerms: ['肝郁', '情绪', '疏导'] },
  { category: '脏腑调理', target: '肾气不足', keyTerms: ['肾气', '腰膝', '调补'] },
  { category: '脏腑调理', target: '心神不宁', keyTerms: ['心神', '失眠', '安神'] },
  { category: '睡眠', target: '入睡困难', keyTerms: ['入睡困难', '睡眠', '节律'] },
  { category: '睡眠', target: '早醒多梦', keyTerms: ['早醒', '多梦', '调理'] },
  { category: '饮食', target: '秋季养肺饮食', keyTerms: ['秋季', '养肺', '饮食'] },
  { category: '饮食', target: '夏季祛湿饮食', keyTerms: ['夏季', '祛湿', '饮食'] },
  { category: '饮食', target: '高血糖人群饮食', keyTerms: ['血糖', '饮食', '控制'] },
  { category: '运动', target: '气虚人群运动', keyTerms: ['气虚', '运动', '强度'] },
  { category: '运动', target: '中老年有氧运动', keyTerms: ['中老年', '有氧', '安全'] },
  { category: '经络穴位', target: '缓解焦虑穴位', keyTerms: ['穴位', '焦虑', '按压'] },
  { category: '经络穴位', target: '改善疲劳穴位', keyTerms: ['穴位', '疲劳', '经络'] },
  { category: '妇科', target: '经前不适调理', keyTerms: ['经前', '调理', '情绪'] },
  { category: '呼吸系统', target: '慢性咳嗽调护', keyTerms: ['咳嗽', '调护', '肺'] },
  { category: '消化系统', target: '食欲不振调理', keyTerms: ['食欲不振', '脾胃', '饮食'] },
  { category: '慢病管理', target: '高血压中医调养', keyTerms: ['高血压', '调养', '生活方式'] },
  { category: '慢病管理', target: '血脂偏高调理', keyTerms: ['血脂', '饮食', '运动'] },
];

const QUESTION_TEMPLATES: Array<{
  makeQuestion: (target: string) => string;
  rubric: string;
  difficulty: 'easy' | 'medium' | 'hard';
}> = [
  {
    makeQuestion: (target) => `请用中医角度解释“${target}”的常见表现、成因和日常调养要点。`,
    rubric: '应包含表现-成因-调养三段，并尽量有可执行建议。',
    difficulty: 'easy',
  },
  {
    makeQuestion: (target) => `如果一个人近期出现与“${target}”相关表现，优先应从哪些生活习惯调整？`,
    rubric: '应给出优先级顺序与可执行动作，避免空泛描述。',
    difficulty: 'medium',
  },
  {
    makeQuestion: (target) => `围绕“${target}”，请给出一份连续7天的作息与饮食建议框架。`,
    rubric: '应包含周期安排、节律要求和风险提示。',
    difficulty: 'hard',
  },
  {
    makeQuestion: (target) => `“${target}”在《黄帝内经》或中医经典中可如何理解？请给出可验证出处方向。`,
    rubric: '应包含经典依据方向，回答中要有来源引用。',
    difficulty: 'medium',
  },
  {
    makeQuestion: (target) => `请比较“${target}”与常见相近证候的区别，并给出辨别思路。`,
    rubric: '应有差异点和辨证路径，避免武断诊断。',
    difficulty: 'hard',
  },
];

function buildCases(): EvalCase[] {
  const cases: EvalCase[] = [];
  let index = 1;

  for (const topic of TOPICS) {
    for (const template of QUESTION_TEMPLATES) {
      const id = `q${String(index).padStart(3, '0')}`;
      cases.push({
        id,
        category: topic.category,
        question: template.makeQuestion(topic.target),
        expectedKeywords: [...topic.keyTerms, topic.target],
        expectedSourceHints: ['黄帝内经', '中医基础理论', topic.category],
        difficulty: template.difficulty,
        rubric: template.rubric,
      });
      index += 1;
    }
  }

  return cases;
}

async function main(): Promise<void> {
  const targetPath = path.isAbsolute(env.RAG_EVAL_SET_PATH)
    ? env.RAG_EVAL_SET_PATH
    : path.resolve(process.cwd(), env.RAG_EVAL_SET_PATH);
  const dirPath = path.dirname(targetPath);
  await fs.mkdir(dirPath, { recursive: true });

  const cases = buildCases();
  const jsonl = cases.map((item) => JSON.stringify(item, null, 0)).join('\n');
  await fs.writeFile(targetPath, `${jsonl}\n`, 'utf8');

  console.log(`[rag:eval:gen] wrote ${cases.length} cases -> ${targetPath}`);
}

main().catch((error) => {
  console.error('[rag:eval:gen] failed:', error);
  process.exit(1);
});
