# poc-12 — Embedding RAG

Local semantic search in the browser using WASM-compiled transformer models.
No server, no API key — everything runs in the tab.

## What this demos

| Step | What happens |
|------|-------------|
| **Load** | `@xenova/transformers` fetches `all-MiniLM-L6-v2` (~23 MB, cached in IndexedDB after first visit) |
| **Embed corpus** | 15 documents are each encoded into a 384-dim float vector |
| **Query** | User query is embedded with the same model into a 384-dim vector |
| **Rank** | Cosine similarity scores all 15 docs; top 5 are displayed |

The example queries are designed to share **no keywords** with the correct documents:
"gravity so strong light cannot escape" → ranks *Black holes* first even though
none of those words appear in the corpus text.

## Why cosine similarity works

Each embedding maps semantically similar sentences to nearby points in a
high-dimensional vector space. The model was fine-tuned for sentence similarity on
millions of pairs, so proximity in vector space ≈ semantic relatedness.
Because both query and doc vectors are L2-normalized, cosine similarity reduces
to a plain dot product.

## Model

`Xenova/all-MiniLM-L6-v2` — 6-layer MiniLM sentence-transformer.
384 output dimensions. ~23 MB quantized (q8 ONNX).
Cached in IndexedDB after the first visit so subsequent loads are instant.

## How to run

```sh
# from web-assembly-playground/
python3 -m http.server 8088
# → http://localhost:8088/poc-12-embedding-rag/
```

ES-module imports and the WASM/ONNX loader require an HTTP server —
opening `index.html` directly as `file://` will fail.

All dependencies load from CDN — no `npm install`, no build step.

## File layout

```
poc-12-embedding-rag/
├── index.html   — shell, header, search bar, two-panel layout
├── app.js       — corpus, pipeline setup, embed, cosine sim, render
├── style.css    — dark theme, score bars, corpus sidebar
└── README.md
```

## RAG relevance

This POC covers the **retrieval** half of RAG: embedding-based semantic search to
find the most relevant context chunks for a given query. The generation half —
feeding retrieved chunks to an LLM — would be the natural next step, e.g. using
`webllm` for local inference or a remote Claude API call.

## Bundle cost

| Asset | Size |
|-------|------|
| `@xenova/transformers` (CDN, cached) | ~500 KB JS |
| `all-MiniLM-L6-v2` ONNX model | ~23 MB (IndexedDB after first visit) |
| App code | < 10 KB |

First-visit transfer ≈ 23.5 MB, matching the roadmap estimate.
Repeat visits are near-instant.
