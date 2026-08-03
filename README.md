# MenuLens 🍽️

![CI](https://github.com/Saad-Ahmad-code/project/actions/workflows/ci.yml/badge.svg)

Scan a restaurant menu photo and get structured, AI-enriched dish data — descriptions,
images, nutrition, translations, and side-by-side comparisons.

Built with **Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Framer Motion**.

## Features

- 📸 **Menu scanning** — upload a photo; multi-layer OCR extracts dishes, prices,
  categories, and descriptions (RapidOCR + Tesseract.js + Sharp preprocessing + Python
  pipeline + AI vision rescue)
- 🤖 **AI enrichment** — per-dish descriptions, origins, dietary tags, and food images
  (background job queue with retries + dead-letter queue)
- 🥗 **Nutrition lookup** — Open Food Facts + USDA FoodData Central (by name or barcode)
- 🧾 **Smart suggestions** — expert picks, pairings, and allergen flags; dietary filter
- 🌍 **Translation** — menu text into 8+ languages
- ⚖️ **Compare scans** — side-by-side dish comparison
- 👤 **Auth** — NextAuth with local JSON storage

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your keys (see below)
npm run dev                  # → http://localhost:3000
```

### Environment variables

See `.env.example` for the full list with descriptions. At minimum you'll want an
OpenRouter or Groq API key for AI features (the app falls back gracefully without them —
OCR still works offline).

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build ⚠️ stop the dev server first (see AGENTS.md) |
| `npm run start` | Serve a production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run check` | `lint` + `typecheck` |
| `npm run test` | Full local test suite: unit tests → splitter probes → OCR batch (154/154) |
| `npm run test:units` | 41 unit tests (cleaner, validation, price, name cleanup, merged-row splitter) |
| `npm run test:splitter` | Splitter regression probes (fused-row cases, never-split guards) |
| `npm run test:ocr` | Full OCR batch against 20 synthetic menus vs ground truth |

> Test harnesses (`test_*.ts`, `corpus/`) are intentionally gitignored — they're
> local-only verification tools, not shipped with the app.

## Project structure

```
src/
├── app/                # Pages + API route handlers (App Router)
│   ├── scan/           #   upload + live progress
│   ├── history/        #   past scans
│   ├── results/[id]    #   scan results & dishes
│   ├── compare/        #   side-by-side comparison
│   ├── admin/          #   stats, agent queue, AI health
│   └── api/            #   REST + SSE endpoints
├── components/         # UI components (shadcn/ui + feature components)
├── hooks/              # Client hooks (useScan, useDebounce, SSE progress)
├── lib/
│   ├── ocr/            # offline OCR pipeline (decomposed — see below)
│   ├── ai/             # provider fallback chain w/ circuit breaker, vision OCR,
│   │                   # Python OCR runner
│   ├── agent/          # enrichment job queue (backoff, retries, DLQ)
│   ├── images/         # multi-source dish-image search (scored & filtered)
│   ├── storage/        # typed JSON-file database wrapper
│   ├── config.ts       # central runtime constants
│   ├── db-types.ts     # shared document types
│   ├── mongodb.ts      # local JSON database engine
│   └── diagnostics.ts  # health probes (incl. Ollama)
└── scripts/            # menu_ocr.py, rapidocr_scan.py, food_classifier.py
```

### OCR internals (`src/lib/ocr/`)

The offline pipeline lives in `local.ts` and is decomposed into focused modules:

| Module | Responsibility |
|---|---|
| `local.ts` | Orchestration: preprocessing, candidate pool, parser layering, gates |
| `candidates.ts` | Candidate generation & `getBestResult` scoring |
| `cleaner.ts` | Pre-parser cleanup (venue/noise lines, split-price merge) |
| `parsing.ts` | Paragraph-aware + sequential parsers |
| `columns.ts` | Column detection & per-column parsing |
| `merged-split.ts` | Split fused OCR rows (2-3 dishes on one line) |
| `price.ts` | Price token detection |
| `name-cleanup.ts` | Dish name cleanup stages |
| `validation.ts` | `isHeaderLike`, `isNoiseLine`, `hasSufficientRealWords`, category guessing |
| `ollama.ts` | Local LLM refine (fail-soft) + vision rescue |
| `data/` | Keyword/word lists (`category-keywords`, `food-words`, `ocr-corrections`, `real-word-re`) |
| `engine.ts` | ⚠️ **Online pipeline — do not modify** (see AGENTS.md) |

## How OCR works

1. **RapidOCR** — primary reader (ONNX/PP-OCR), fastest high-quality pass.
2. **Tesseract.js + Sharp** — grayscale/normalize/sharpen preprocessing, multiple
   page-segmentation modes tried in parallel, best result picked.
3. **Python pipeline** — pytesseract with PIL/scipy enhancements (`src/scripts/menu_ocr.py`).
4. **AI vision** — falls back to a vision-capable model for difficult menus (rescue only).

Each layer falls through to the next; results are streamed to the UI via SSE.
Dish parsing is layout-aware (paragraphs → columns → sequential blocks) with
validation gates that reject garbled OCR while accepting single-word dishes.

## Testing

- **Unit tests** (`test_units.ts`): 41 assertions across the OCR helper modules.
- **Splitter probes** (`test_splitter.ts`): fused-row splitting edge cases.
- **OCR regression** (`test_batch.ts` + `corpus/`): 20 PIL-generated menus, 154 dishes —
  exact name + price + category match against ground truth, deterministic.
- Run everything: `npm run test` (takes a few minutes).

## Deployment

MenuLens needs a **real server** — it can't run on static hosting (GitHub Pages) or
plain serverless (Vercel):

- **Persistent storage** — the JSON-file DB lives on local disk (`data/`)
- **Python subprocess** — the OCR pipeline spawns Python (`pytesseract`, RapidOCR)
- **Background worker** — the enrichment queue runs continuously

Recommended: a small **VPS** (2–4 GB RAM, Ubuntu) with Node 22, Python + tesseract,
PM2, and a reverse proxy (Caddy) for HTTPS. See `.plans/` for the detailed deployment
plan. MongoDB Atlas + OCR API would enable serverless hosting but requires a refactor.

## Docs for agents & contributors

**Read [`AGENTS.md`](AGENTS.md) first** — it documents the architecture, file map,
hard rules (which files to modify, build discipline, storage conventions), and pitfalls
that have caused production bugs.

## Tech notes

- **Storage:** local JSON-file DB (`src/lib/mongodb.ts`, typed via `src/lib/db-types.ts`) —
  no external database needed. Collections: `scans`, `dishes`, `users`, `agent_log`
  (+ `agent_log_dlq` for failed jobs).
- **AI providers:** OpenRouter (primary) → Groq → … graceful fallback chain with
  per-model circuit breakers.
- **Images:** Unsplash, Pexels, Bing, Wikipedia, Openverse, MealDB — scored & filtered.
