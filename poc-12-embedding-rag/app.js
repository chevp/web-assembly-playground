// poc-12 — Embedding RAG
// @xenova/transformers loaded from CDN — no build step, no npm install.
// Model files (ONNX + tokenizer) are fetched from HuggingFace and cached
// in IndexedDB after the first visit.

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowRemoteModels = true;
env.useBrowserCache   = true;

// ── Corpus ────────────────────────────────────────────────────────────────────
// 15 short documents from distinct domains. The demo shows that semantic
// similarity finds the right document even when the query shares no keywords.

const CORPUS = [
  {
    id:  0,
    title: 'Git version control',
    text: 'Git records snapshots of source code files over time. Developers commit changes, branch for parallel work, and merge histories back together. Every revision is retrievable and auditable.',
  },
  {
    id:  1,
    title: 'Docker containerization',
    text: 'Docker packages an application together with its dependencies into a lightweight, isolated container. Containers share the host OS kernel but have their own filesystem, making them portable across machines.',
  },
  {
    id:  2,
    title: 'Rust memory safety',
    text: 'Rust enforces memory safety through an ownership and borrowing system checked at compile time. The borrow checker prevents dangling pointers, data races, and buffer overflows without a garbage collector.',
  },
  {
    id:  3,
    title: 'Neural network training',
    text: 'Training a neural network adjusts millions of weights using backpropagation. The loss function measures prediction error, and gradients flow backward through each layer to update parameters via gradient descent.',
  },
  {
    id:  4,
    title: 'B-tree database indexing',
    text: 'B-trees organize database records in a balanced, sorted hierarchy. Lookups, inserts, and deletes all run in O(log n) time, letting databases serve queries orders of magnitude faster than full table scans.',
  },
  {
    id:  5,
    title: 'Photosynthesis',
    text: 'Chlorophyll in plant chloroplasts absorbs sunlight and uses that energy to convert carbon dioxide and water into glucose. This process releases oxygen as a byproduct and is the foundation of most food chains.',
  },
  {
    id:  6,
    title: 'Black holes',
    text: 'A black hole forms when a massive star collapses under its own gravity. At the event horizon, gravity is so extreme that the escape velocity exceeds the speed of light — nothing, including light, can get out.',
  },
  {
    id:  7,
    title: 'TCP/IP networking',
    text: 'TCP provides reliable, ordered byte-stream delivery over IP. It establishes connections with a three-way handshake, tracks sequence numbers for each segment, and automatically retransmits lost packets.',
  },
  {
    id:  8,
    title: 'WebAssembly (WASM)',
    text: 'WebAssembly is a compact binary instruction format that runs in browsers at near-native speed. It is a compilation target for Rust, C++, and Go, enabling code originally written for native platforms to run on the web.',
  },
  {
    id:  9,
    title: 'Quantum computing',
    text: 'A quantum computer uses qubits that exploit superposition to represent 0 and 1 simultaneously. Entanglement and interference allow quantum algorithms to explore exponentially many states in parallel.',
  },
  {
    id: 10,
    title: 'DNA replication',
    text: 'Helicase unwinds the DNA double helix before cell division. DNA polymerase reads each strand as a template and assembles a complementary copy, faithfully duplicating genetic information for daughter cells.',
  },
  {
    id: 11,
    title: 'Blockchain consensus',
    text: 'A blockchain is a distributed ledger where consensus algorithms such as proof-of-work or proof-of-stake let untrusted peers agree on a canonical transaction history. Cryptographic linking makes tampering evident.',
  },
  {
    id: 12,
    title: 'LLVM compiler pipeline',
    text: 'LLVM compiles source code to an intermediate representation (IR), applies machine-independent optimization passes, then emits efficient machine code for the target CPU. Clang, Rust, and Swift all use LLVM as a backend.',
  },
  {
    id: 13,
    title: 'Renaissance art',
    text: 'Renaissance painters revived classical ideals of beauty and proportion, mastering linear perspective and detailed anatomy. Leonardo da Vinci and Michelangelo elevated painting and sculpture into intellectual disciplines.',
  },
  {
    id: 14,
    title: 'Gradient descent optimization',
    text: 'Gradient descent minimizes a loss function by iteratively moving parameters opposite to the gradient. Adaptive variants such as Adam scale the learning rate per parameter, enabling faster and more stable convergence.',
  },
];

// ── State ─────────────────────────────────────────────────────────────────────
let extractor       = null;
let corpusVectors   = [];  // Float32Array per doc (normalized)
let topResultIds    = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const progressBar  = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const searchInput  = document.getElementById('search-input');
const searchBtn    = document.getElementById('search-btn');
const resultsPanel = document.getElementById('results-panel');
const corpusPanel  = document.getElementById('corpus-panel');

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(state, text, pct = null) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
  if (pct !== null) {
    progressBar.style.display = 'block';
    progressFill.style.width  = pct + '%';
  } else {
    progressBar.style.display = 'none';
  }
}

// Vectors are L2-normalized by the pipeline, so dot product = cosine similarity.
function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ── Model + corpus embedding ──────────────────────────────────────────────────
async function loadModel() {
  setStatus('loading', 'Downloading model…', 0);

  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    progress_callback(info) {
      if (info.status === 'progress') {
        const pct = info.progress != null
          ? Math.round(info.progress)
          : (info.total ? Math.round((info.loaded / info.total) * 100) : null);
        setStatus('loading', `Downloading ${info.file ?? '…'} (${pct ?? '?'}%)`, pct);
      } else if (info.status === 'initiate') {
        setStatus('loading', `Fetching ${info.file ?? '…'}`, null);
      } else if (info.status === 'done') {
        setStatus('loading', `Loaded ${info.file ?? '…'}`, null);
      } else if (info.status === 'ready') {
        setStatus('loading', 'Model ready — embedding corpus…', null);
      }
    },
  });

  await embedCorpus();

  setStatus('ready', `Ready — ${CORPUS.length} docs embedded (dim ${corpusVectors[0].length})`, null);
  searchInput.disabled = false;
  searchBtn.disabled   = false;
  renderCorpus(true);
}

async function embedOne(text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

async function embedCorpus() {
  corpusVectors = [];
  for (let i = 0; i < CORPUS.length; i++) {
    corpusVectors.push(await embedOne(CORPUS[i].text));
    const pct = Math.round(((i + 1) / CORPUS.length) * 100);
    setStatus('loading', `Embedding corpus… ${i + 1}/${CORPUS.length}`, pct);

    // Show green checkmark on the card as each doc is embedded
    const embedEl = document.getElementById(`embed-${i}`);
    if (embedEl) {
      embedEl.textContent = `✓ dim ${corpusVectors[i].length}`;
      embedEl.classList.add('visible');
    }
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
async function search(query) {
  searchBtn.disabled  = true;
  searchBtn.textContent = '…';
  setStatus('loading', 'Embedding query…', null);

  const qVec = await embedOne(query);

  const ranked = CORPUS
    .map((doc, i) => ({ ...doc, score: cosineSim(qVec, corpusVectors[i]) }))
    .sort((a, b) => b.score - a.score);

  topResultIds = new Set(ranked.slice(0, 5).map(r => r.id));
  renderResults(ranked.slice(0, 5), query);
  renderCorpus(true);

  setStatus('ready', `Top 5 of ${CORPUS.length} results for "${query}"`, null);
  searchBtn.disabled    = false;
  searchBtn.textContent = 'Search';
}

// ── Render: results ───────────────────────────────────────────────────────────
function renderResults(results, query) {
  const dim   = corpusVectors[0]?.length ?? '?';
  const maxS  = results[0]?.score ?? 1;

  resultsPanel.innerHTML = `
    <div class="dim-info">
      query embedded → ${dim}-dim vector &nbsp;·&nbsp; ranked by cosine similarity
    </div>
    <div class="panel-title">Results for &ldquo;${escHtml(query)}&rdquo;</div>
    ${results.map((r, i) => `
      <div class="result-card">
        <div class="score-col">
          <div class="score-val">${r.score.toFixed(3)}</div>
          <div class="score-bar">
            <div class="score-bar-fill" style="width:${Math.round((r.score / maxS) * 100)}%"></div>
          </div>
        </div>
        <div>
          <div class="result-rank">#${i + 1}</div>
          <div class="result-title">${escHtml(r.title)}</div>
          <div class="result-text">${escHtml(r.text)}</div>
        </div>
      </div>
    `).join('')}
  `;
}

// ── Render: corpus sidebar ────────────────────────────────────────────────────
function renderCorpus(withEmbedStatus = false) {
  corpusPanel.innerHTML = `
    <div class="panel-title">Corpus — ${CORPUS.length} documents</div>
    ${CORPUS.map((doc, i) => `
      <div class="corpus-card ${topResultIds.has(doc.id) ? 'hit' : ''}">
        <div class="corpus-title">${escHtml(doc.title)}</div>
        <div class="corpus-text">${escHtml(doc.text)}</div>
        <div class="corpus-embed ${withEmbedStatus && corpusVectors[i] ? 'visible' : ''}" id="embed-${i}">
          ${withEmbedStatus && corpusVectors[i] ? `✓ dim ${corpusVectors[i].length}` : ''}
        </div>
      </div>
    `).join('')}
  `;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Events ────────────────────────────────────────────────────────────────────
searchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  if (q && extractor && corpusVectors.length === CORPUS.length) search(q);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') searchBtn.click();
});

document.querySelectorAll('.example-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    searchInput.value = btn.dataset.query;
    if (extractor && corpusVectors.length === CORPUS.length) search(btn.dataset.query);
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
renderCorpus(false);

loadModel().catch(err => {
  setStatus('error', 'Model load failed: ' + err.message, null);
  console.error(err);
});
