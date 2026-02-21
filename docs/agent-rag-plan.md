# Agent + RAG Technical Plan (No Knowledge Graph)

## Goal

Ship a production-usable backend in small steps:

1. Authenticated Agent API
2. RAG retrieval over local TCM corpus
3. Answer with explicit citations
4. 100-200 case factual evaluation pipeline

## Security Baseline

- Keep `GREATROUTER_API_KEY` server-side only.
- Never commit real keys.
- Use environment variables on server runtime (`systemd`, Docker secrets, or cloud secret manager).
- `.env.example` is for local development only.

## Architecture

### Components

- `POST /api/agent/chat` (JWT protected)
- `KnowledgeChunk` collection
- Ingestion pipeline (`rag:ingest`)
- Hybrid retrieval (embedding + lexical)
- LLM answer generation with citation tags `[C1] [C2]`
- Evaluation scripts:
  - `rag:eval:gen` for dataset generation
  - `rag:eval` for scoring and report

### Data flow

1. Ingestion:
   - Read `data/knowledge/*.md|*.txt`
   - Section parse -> chunk -> embed -> upsert MongoDB
2. Query:
   - Embed user query
   - Candidate recall by token regex + fallback
   - Hybrid scoring, top-k selection
3. Generation:
   - Prompt with context blocks `[C1..Cn]`
   - Return answer + structured citations

## API Contract

### Agent chat

- `POST /api/agent/chat`
- Request:
  - `message: string`
  - `topK?: number`
- Response:
  - `answer: string`
  - `citations: [{ label, sourceTitle, sourcePath, sectionTitle, excerpt, score }]`
  - `evidenceCount: number`
  - `model: string`

## Evaluation (100-200 cases)

Current default set size: 120 cases (`data/eval/tcm_eval_120.jsonl`).

Metrics:

- Citation presence rate
- Source hint hit rate
- Answer keyword coverage
- Evidence keyword coverage
- Optional LLM factual judge score (`RAG_JUDGE_MODEL`)

Output:

- JSON report under `reports/`

## Rollout Steps

1. Load corpus into `data/knowledge`.
2. Run `npm run rag:ingest`.
3. Run `npm run rag:eval:gen` (already prepared, 120 cases).
4. Run `npm run rag:eval`.
5. Gate deploy with minimum targets, for example:
   - citation presence >= 0.95
   - source hint hit >= 0.80
   - avg keyword coverage >= 0.70

## Next Iterations (After v1)

- Better chunk strategy per classic text structure
- Reranker model for final top-k
- Query rewrite for ambiguous TCM terms
- Hallucination guard for insufficient-evidence answers
- Per-category eval dashboards
