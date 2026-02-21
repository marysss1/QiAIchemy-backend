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

2) Ingest chunks + embeddings:

```bash
npm run rag:ingest
```

3) Generate evaluation set (120 cases):

```bash
npm run rag:eval:gen
```

4) Run evaluation:

```bash
npm run rag:eval
# quick smoke:
npm run rag:eval -- --limit 10
```

Evaluation report JSON will be written to `reports/`.

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `POST /api/agent/chat` (Bearer token, Agent + RAG + citations)
- `POST /api/health/snapshots` (Bearer token, upload HealthKit snapshot with server timestamp)
- `GET /health`
