# MenuLens 🍽️

Scan a restaurant menu photo and get structured, AI-enriched dish data — descriptions,
images, nutrition, translations, and side-by-side comparisons.

Built with **Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Framer Motion**.

## Features

- 📸 **Menu scanning** — upload a photo; multi-layer OCR extracts dishes, prices,
  categories, and descriptions (Tesseract.js + Sharp preprocessing + Python pipeline + AI vision fallback)
- 🤖 **AI enrichment** — per-dish descriptions, origins, dietary tags, and food images
- 🥗 **Nutrition lookup** — Open Food Facts + USDA FoodData Central (by name or barcode)
- 🧾 **Smart suggestions** — expert picks, pairings, and allergen flags
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
| `npm run lint` | Lint |

## Project structure

```
src/
├── app/            # Pages + API route handlers (App Router)
│   ├── scan/       #   upload + live progress
│   ├── history/    #   past scans
│   ├── results/[id]#   scan results & dishes
│   ├── compare/    #   side-by-side comparison
│   ├── admin/      #   stats & agent queue
│   └── api/        #   REST + SSE endpoints
├── components/     # UI components (shadcn/ui + feature components)
├── hooks/          # Client hooks (useScan, SSE progress)
├── lib/
│   ├── ocr/        # local.ts (offline OCR) + engine.ts (online pipeline)
│   ├── ai/         # provider fallback chain, vision OCR, Python OCR runner
│   ├── agent/      # enrichment job queue
│   ├── images/     # multi-source dish-image search
│   ├── storage/    # JSON-file database wrapper
│   └── mongodb.ts  # local JSON database
├── scripts/        # menu_ocr.py (standalone Python OCR pipeline)
└── types/          # shared types
```

## How OCR works

1. **Tesseract.js** — instant, pure JS/WASM pass over the image.
2. **Tesseract + Sharp** — grayscale/normalize/sharpen preprocessing, multiple
   page-segmentation modes tried in parallel, best result picked.
3. **Python pipeline** — pytesseract with PIL/scipy enhancements (`src/scripts/menu_ocr.py`).
4. **AI vision** — falls back to a vision-capable model for difficult menus.

Each layer falls through to the next; results are streamed to the UI via SSE.
Dish parsing is layout-aware (paragraphs → columns → sequential blocks) with
validation gates that reject garbled OCR while accepting single-word dishes.

## Docs for agents & contributors

**Read [`AGENTS.md`](AGENTS.md) first** — it documents the architecture, file map,
hard rules (which files to modify, build discipline, storage conventions), and pitfalls
that have caused production bugs.

## Tech notes

- **Storage:** local JSON-file DB (`src/lib/mongodb.ts`) — no external database needed.
  Collections: `scans`, `dishes`, `users`, `agent_log`.
- **AI providers:** OpenRouter (primary) → Groq → Gemini → … graceful fallback chain.
- **Images:** Unsplash, Pexels, Bing, Wikipedia, Openverse, MealDB — scored & filtered.
