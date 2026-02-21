# Graph-RAG Lite (for Graduation Project)

## Why

Classic RAG may miss multi-hop relations in TCM reasoning, e.g.:
- "睡眠差 + HRV低 + 焦虑" -> "肝郁/心神不宁倾向" -> "调睡眠节律 + 情志调畅"

Graph-RAG Lite adds a lightweight graph reasoning channel without introducing heavy graph databases.

## Pipeline

1. **Classic retrieval**: lexical + embedding from chunk store
2. **Graph seeding**: extract seed tokens from user question + optional health context
3. **Personalized PageRank (PPR)** over TCM graph
4. **Graph score** for each chunk by token overlap with top PPR nodes
5. **Reciprocal Rank Fusion (RRF)** across three rank lists
6. **Final fusion score** and top-k context to LLM

## Math

### PPR

For node score vector `p`:

`p_(t+1) = (1 - alpha) * s + alpha * W^T * p_t`

- `alpha`: restart damping (`RAG_GRAPH_PPR_ALPHA`, default 0.85)
- `s`: normalized seed distribution
- `W`: row-normalized edge-weight transition matrix

### RRF

For candidate `d`, rank lists `r_i(d)`:

`RRF(d) = sum_i 1 / (k + r_i(d))`

- Here `k = 60`
- rank lists: embedding rank, lexical rank, graph rank

### Final score

- raw score with embedding:
  - `raw = 0.62*embed + 0.20*lex + 0.18*graph`
- raw score without embedding fallback:
  - `raw = 0.70*lex + 0.30*graph`
- final:
  - `score = 0.70*raw + 0.30*RRF`

## Youth sub-health focus

Current graph focuses on:
- sleep quality / sleep duration
- stress & anxiety
- sedentary behavior
- exercise volume
- blood glucose / blood oxygen / resting heart rate / HRV
- lifestyle advice: sleep rhythm, light exposure, post-meal walk, stress release, anti-sedentary habits

## Safety principle

Graph only **helps retrieval**. Final response still requires chunk citations.
No direct diagnosis from graph structure alone.
