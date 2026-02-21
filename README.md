# QiAIchemy Backend

Standalone TypeScript backend for QiAIchemy.

## Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT Authentication
- TypeScript
- GreatRouter LLM (OpenAI-compatible)
- RAG (ingest, retrieval, citation output, evaluation scripts)

## Setup

```bash
npm install
```

For local development, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update local `.env`:

```env
HOST=0.0.0.0
PORT=2818
MONGODB_URI=mongodb://127.0.0.1:27017/qiaichemy
JWT_SECRET=replace-with-a-very-long-random-secret
```

## API key safety (production)

- Do not commit real API keys.
- In production, set `GREATROUTER_API_KEY` directly on the server (system env / secret manager), not in git.
- This project supports "on-demand validation":
  - Scripts that do not call LLM can run without `GREATROUTER_API_KEY`.
  - DB-dependent flows require `MONGODB_URI`.
  - Auth flows require `JWT_SECRET`.

## Core env for Agent + RAG

```env
GREATROUTER_API_KEY=sk-gr-xxxx
GREATROUTER_BASE_URL=https://endpoint.wendalog.com
LLM_CHAT_MODEL=gpt-4o
EMBEDDING_MODEL=text-embedding-3-large
RAG_INGEST_DIR=data/knowledge
RAG_GRAPH_PATH=data/graph/tcm_graph_lite.json
RAG_GRAPH_PPR_ALPHA=0.85
RAG_GRAPH_TOP_NODES=12
RAG_TOP_K=6
RAG_EVAL_SET_PATH=data/eval/tcm_eval_120.jsonl
RAG_EVAL_REPORT_DIR=reports
# Optional factual judge model (for eval)
RAG_JUDGE_MODEL=
```

Default API base URL:

- Local: `http://localhost:2818`
- External: `http://<your-server-ip>:2818`

## Run

```bash
npm run dev
```

## Build + Start

```bash
npm run build
npm start
```

## Agent + RAG workflow

1) Prepare knowledge files under `data/knowledge` (`.md` / `.txt`).
   - project now includes 5 starter files:
     - `01_huangdi-neijing_core.md`
     - `02_shanghan_jingui_core.md`
     - `03_wenbing_tiaobian_core.md`
     - `04_tcm_foundation_and_diagnosis.md`
     - `05_chronic_disease_tcm_lifestyle.md`

2) (Recommended) Build large no-fabrication corpus from real source texts.
   - Put real book/guideline texts into `data/knowledge_sources/*` (see `data/knowledge_sources/README.md`).
   - Then run:

```bash
npm run knowledge:build
```

3) Ingest chunks + embeddings:

```bash
npm run rag:ingest
```

4) Generate evaluation set (120 cases):

```bash
npm run rag:eval:gen
```

5) Run evaluation:

```bash
npm run rag:eval
# quick smoke:
npm run rag:eval -- --limit 10
```

Evaluation report JSON will be written to `reports/`.

6) Summarize latest report:

```bash
npm run rag:eval:summary
```

Compare two reports:

```bash
npm run rag:eval:summary -- --file reports/rag-eval-report-NEW.json --compare reports/rag-eval-report-OLD.json
```

## How to use eval report

Report fields (from `summary`) can be used as release gates:

- `citationPresenceRate`: proportion of answers containing citations
- `sourceHintHitRate`: proportion of answers citing expected source hints
- `avgKeywordCoverage`: answer-side key fact coverage
- `avgEvidenceKeywordCoverage`: retrieved evidence coverage

Suggested baseline gates for this project stage:

- citationPresenceRate >= 0.95
- sourceHintHitRate >= 0.70
- avgKeywordCoverage >= 0.65
- avgEvidenceKeywordCoverage >= 0.55

For each iteration (prompt/retrieval/knowledge update):

1. run `npm run rag:eval`
2. run `npm run rag:eval:summary`
3. compare with previous report and keep only non-regressive changes

## Graph-RAG Lite

The retrieval layer now uses a lightweight graph-enhanced strategy:

- Graph seeding from query + optional health/dialog context
- Personalized PageRank (PPR) over `data/graph/tcm_graph_lite.json`
- Graph token boosting for candidate chunks
- Reciprocal Rank Fusion (RRF) across embedding rank / lexical rank / graph rank

This is designed for graduation-project complexity (low ops burden, clear math explanation).

## Expand knowledge 10x without fabrication

Use only real source text (books/guidelines) and build corpus automatically:

```bash
# put real source text into data/knowledge_sources/*
KNOWLEDGE_MIN_CHARS=12000 npm run knowledge:build
```

Then re-ingest:

```bash
npm run rag:ingest -- --dir data/knowledge
```

`knowledge:build` will fail if any output file is below min chars, so you can enforce 5x/10x growth by raising `KNOWLEDGE_MIN_CHARS`.

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `POST /api/agent/chat` (Bearer token, Agent + RAG + citations)
- `POST /api/agent/chat/health` (Bearer token, conversation + latest HealthSnapshot + RAG + citations)
- `POST /api/health/snapshots` (Bearer token, upload HealthKit snapshot with server timestamp)
- `GET /health`

### Personalized Agent Example

`POST /api/agent/chat/health`

```json
{
  "message": "最近睡眠分数低，白天也乏力，怎么调理？",
  "topK": 6,
  "history": [
    { "role": "user", "content": "最近压力大，经常晚睡" },
    { "role": "assistant", "content": "你最近是否有运动和饮食变化？" }
  ]
}
```
