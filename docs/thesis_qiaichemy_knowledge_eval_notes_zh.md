# QiAIchemy 后端：知识库选择与建模、评测集设计（代码事实版写作底稿）

## Summary
基于指定仓库 `/Users/primopan/WebstormProjects/QiAIchemy-backend`，本稿按代码与数据文件核对“知识库怎么选、怎么建模、怎么入库、评测集怎么设计、是否合理”。以下内容可直接交给写作 agent 扩展，且均以当前仓库可见实现为准。

## 可直接用于论文的文本
本系统的知识库采用“中医经典 + 基础教材 + 青年亚健康管理”的五路语料结构。具体分为：`黄帝内经`、`伤寒论/金匮要略`、`温病条辨`、`中医基础理论与诊断`、`青年亚健康与慢病生活方式管理`，对应目录见 `/Users/primopan/WebstormProjects/QiAIchemy-backend/data/knowledge_sources`。语料构建脚本 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/scripts/buildKnowledgeCorpus.ts` 将五类源文件汇总为 `/Users/primopan/WebstormProjects/QiAIchemy-backend/data/knowledge/*.md`，并按来源自动加头信息；脚本支持 `.txt/.md/.markdown`，并通过 `KNOWLEDGE_MIN_CHARS`（默认 12000）控制最小语料长度，确保知识库可扩展、可审计。

知识库建模采用“文本块 + 向量 + 关键词索引”的轻量混合方案。Mongo 模型定义在 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/models/KnowledgeChunk.ts`，核心字段包括 `sourceId/sourceTitle/sourcePath/sectionTitle/chunkIndex/text/embedding/keywords`，并建立了 `(sourceId, chunkIndex)` 唯一索引、全文索引和关键词索引。入库流程由 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/scripts/ragIngest.ts` 调用 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/services/rag/ingestKnowledge.ts` 完成：先按标题或“第X篇/章/卷”做分节，再按 `RAG_CHUNK_SIZE=600`、`RAG_CHUNK_OVERLAP=120` 切块，随后批量调用 embedding 接口生成向量并 upsert 入库。该流程的特点是增量更新稳定（同一 sourceId/chunkIndex 覆盖），并可自动清理旧尾块，避免重复语料污染检索。

检索层不是纯向量检索，而是“词法 + 向量 + 图增强 + 融合排序”。实现见 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/services/rag/retrieve.ts` 和 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/services/rag/graphLite.ts`。系统先做候选召回，再计算 lexical score 与 embedding score；图增强部分使用轻量图文件 `/Users/primopan/WebstormProjects/QiAIchemy-backend/data/graph/tcm_graph_lite.json`（当前 47 节点/47 边），通过 query seed + Personalized PageRank 生成 token boost，再对候选块加权。最终通过 RRF 与线性融合得到 top-k 引文，交由 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/services/rag/answerWithRag.ts` 组织回答并强制引用标签 `[C1][C2]`。因此本项目的知识建模是“可解释检索优先”，而不是黑盒端到端生成。

评测集方面，项目存在 120 题与 200 题两套；严格主集是 `/Users/primopan/WebstormProjects/QiAIchemy-backend/data/eval/tcm_eval_200_graph_youth_strict_multihop_v1.jsonl`。该集字段包含 `id/category/question/expectedKeywords/expectedSourceHints/difficulty/rubric`，总计 200 题，类别 25 个且每类 8 题，难度分布为 easy 50 / medium 75 / hard 75。题干显式要求“多跳链路 + 证据对应 + 风险分层/就医红线”，与 Graph-RAG 目标一致。评测脚本 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/scripts/runRagEval.ts` 输出 citation presence、source hint hit、answer keyword coverage、evidence keyword coverage（可选 LLM factual judge）；对比脚本 `/Users/primopan/WebstormProjects/QiAIchemy-backend/src/scripts/compareRagEval.ts` 进一步做 paired delta、bootstrap CI 和 sign test，满足实验可重复与统计比较需求。

从“是否合理”看：该评测设计对本科毕设是合理且扎实的，优点是结构完整、类别均衡、与图增强目标高度对齐、可自动回归；但也有可改进点。第一，当前 strict 集大量复用通用关键词（如“指标/症状/证候/治法/行动/复盘”等），会让覆盖率指标更偏“格式遵循”而非“医学语义深度”。第二，`expectedSourceHints` 在多数样本中几乎总包含五个核心语料文件名，容易使 sourceHintHit 接近饱和，区分度不足。第三，关键词覆盖采用字符串包含，不处理同义改写与语义等价。综上，该方案适合作为工程可复现评测基线，但若用于更高水平论文，应补充人工专家盲评、语义级评分或更精细的 evidence-grounding 标注。

## Important Changes / Public Interfaces
- 本轮为“代码解读与论文素材整理”，未修改任何 API、数据库 schema 或 TypeScript 类型。
- 关键接口与类型仅作说明：`KnowledgeChunk`、`rag:ingest`、`rag:eval`、`rag:eval:compare`。

## Test Cases and Scenarios
1. 语料构建可复现：运行 `npm run knowledge:build`，应在 `data/knowledge` 生成 5 个目标文件并满足最小长度阈值。  
2. 入库可复现：运行 `npm run rag:ingest -- --dir data/knowledge`，应输出每文件 chunk 数并写入 Mongo。  
3. 评测可复现：运行 `npm run rag:eval:strict`，应生成 `reports/rag-eval-report-*.json`。  
4. 对比可复现：运行 `npm run rag:eval:compare -- --base <A> --next <B>`，应输出 paired delta/CI/sign test。

## Assumptions and Defaults
1. 本说明基于当前本地 checkout（路径见上），不自动继承云端未同步的临时文件。  
2. 当前 `data/knowledge_sources` 里可见的是 `source_summary_zh_3000.md` 版本；是否已替换为更长原文，以服务器实际状态为准。  
3. 评测合理性判断按“本科毕设工程目标”口径给出，而非医学临床证据等级口径。
