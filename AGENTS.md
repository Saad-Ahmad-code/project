# MenuLens — Agent & Contributor Guide

MenuLens is a Next.js (App Router) menu-scanning app: take a photo of a restaurant menu,
extract structured dishes with OCR, enrich them with AI (descriptions, images, nutrition),
and let users compare scans. TypeScript, Tailwind CSS v4, shadcn/ui (Base UI), Framer Motion.

> Read this file before changing anything. It contains hard rules that have burned us before.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Production build. **NEVER run while the dev server is active** — see Pitfalls. |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) |

## Hard rules (do not violate)

1. **`src/lib/ocr/engine.ts` is the ONLINE scan pipeline — DO NOT MODIFY it.**
   All OCR quality improvements go into `src/lib/ocr/local.ts` (offline path) only.
   The user is explicit about this scope.
2. **Never run `npm run build` while the dev server is running.** The build wipes the dev
   server's routes manifest (shared `.next` folder) → HTTP 500 "internal server error" on
   every page. The only fix is: `taskkill -f -im node.exe` → `rm -rf .next` → fresh `npm run dev`.
   If you need to verify a build, kill the dev server first, then rebuild it after.
3. **`sharp` is a native module** and must be hidden from webpack's static analysis.
   Always load it with `const sharp = eval('require')('sharp')` inside a try/catch —
   a direct `require('sharp')` breaks the build. Same pattern as `src/lib/mongodb.ts`.
4. **Dark-theme token trap:** `text-muted` resolves to `#27272a` (near-black) on the
   `#09090b` background — effectively invisible. Gray text MUST use `text-muted-foreground`
   (`#a1a1aa`). See `src/app/globals.css` for tokens.
5. **Storage convention:** docs are persisted with `_id` only (no `id` field).
   Queries by `{ id }` work via an alias in `mongodb.ts` `_match()` — never store both.
   Use the `src/lib/storage` wrapper (`db.findById / db.update / db.create`) for CRUD.
6. **Python OCR script is a real file:** `src/scripts/menu_ocr.py`, with
   `__PYTHON_SITE_PACKAGES__` / `__TESSERACT_CMD__` / `__IMG_PATH__` placeholders that
   `pythonOCR()` in `src/lib/ai/client.ts` substitutes at runtime. Edit the `.py` file,
   not a string in `client.ts`.
7. **Single-word dish names are valid** (Margherita, Espresso). Garbled OCR is rejected by
   `hasSufficientRealWords()` (≥60% of words must have 3+ consecutive letters), NOT by
   word-count floors — do not reintroduce `wordCount < 2`-style gates.
8. **Secrets live in `.env.local`** — never print, commit, or read values into docs.
9. **Windows shell notes:** the terminal is git-bash. `del file 2>nul` creates a literal
   file named `nul` that breaks `git add -A` (exit 128) — use `rm -f`. Pillow is installed
   in the Python env for generating synthetic test menus.
10. **PYTHONPATH pollution:** the Hermes agent shell exports `PYTHONPATH` pointing at its
   own venv (Python 3.11). Every python/pip invocation in the terminal must clear it
   (`PYTHONPATH= .venv/Scripts/python.exe …`). Running `pip install` WITHOUT clearing it
   makes pip see deps "already satisfied" in the agent venv and skip installing them into
   the project venv. The app's own spawns already clear it (`PYTHONPATH: ''` in spawn env).

## Architecture & data flow

```
User uploads menu photo (src/app/scan)
  → POST /api/scan/new (SSE stream: status → ocr → enrich → done)
  → ONLINE: src/lib/ocr/engine.ts — 4 layers, falls through on failure:
       L1 Tesseract.js (pure JS, via runLocalOCR)
       L2 Tesseract + Sharp preprocessing (grayscale/normalize/sharpen/resize, multi-PSM)
       L3 Python subprocess (src/scripts/menu_ocr.py — pytesseract + PIL + scipy)
       L4 AI Vision API (OpenRouter → Gemini, via src/lib/ai/client.ts)
  → dishes + scan persisted via src/lib/storage (JSON-file DB, src/lib/mongodb.ts)
  → agent job queued (src/lib/agent/queue.ts) → enrich each dish:
       AI description/tags (src/lib/agent/dish-research.ts)
       Images (src/lib/images — multi-source: Unsplash/Pexels/Bing/Wikipedia/Openverse/MealDB)
  → results page (src/app/results/[id]) reads scan by id
```

### File map

| Path | Purpose |
|---|---|
| `src/lib/ocr/local.ts` | **Offline OCR** (~1,550 lines). Tesseract + Sharp + multi-PSM; 4 parsers (paragraph-aware → smartParse → sequentialParse → basicExtract); name cleanup; OCR-correction table; category keyword list; `hasSufficientRealWords` gate. |
| `src/lib/ocr/engine.ts` | **Online pipeline.** Do NOT modify. References `runLocalOCR` from local.ts. |
| `src/lib/ai/client.ts` | AI chat completions: provider fallback chain (`src/lib/ai/providers.ts`), vision OCR, `pythonOCR()` subprocess runner. |
| `src/lib/agent/queue.ts` | Background enrichment job queue (`agent_log` collection: queued → processing → completed/failed). |
| `src/lib/agent/index.ts` | `enrichScan` — runs `researchDish` + image search per dish, persists back by dish id. |
| `src/lib/mongodb.ts` | Local JSON-file database (replaces MongoDB). Collections: `scans`, `dishes`, `users`, `agent_log`. |
| `src/lib/storage/index.ts` | `db` wrapper (findById/findBy/findAll/create/update/deleteOne/count) + `LocalStorage`. |
| `src/lib/images/` | Dish-image search: `index.ts` (orchestrator, scoring, timeout), `keywords.ts`, per-source files. |
| `src/lib/auth/options.ts` | NextAuth config, local JSON user storage. |
| `src/lib/diagnostics.ts`, `src/lib/error-handler.ts` | Health checks / auto-diagnostic error handler. |
| `src/scripts/menu_ocr.py` | Standalone Python OCR script (extracted from client.ts template literal). |
| `src/scripts/easyocr_scan.py` | EasyOCR scan script (engine.ts layer 3). |
| `src/scripts/rapidocr_scan.py` | RapidOCR scan script (PP-OCRv6 models on ONNX Runtime) — an extra candidate in `runLocalOCR`'s engine pool (local.ts). |
| `src/app/api/…` | Route handlers (see API list below). |
| `src/app/{scan,history,results,compare,admin,auth}` | Pages. |

### API surface

- `POST /api/scan/new` — upload + OCR + persist, SSE progress stream
- `GET /api/scan/[id]` — scan detail (dishes embedded)
- `GET /api/scans` — list; `GET /api/scans/compare?ids=…` — compare scans
- `GET /api/dishes/[id]` — dish detail; `POST /api/dishes/details` — AI dish info
- `POST /api/nutrition` — Open Food Facts + USDA nutrition (barcode or name)
- `POST /api/recipes`, `POST /api/suggest`, `POST /api/translate` — AI features
- `POST /api/classify`, `GET /api/diagnostics`, `GET /api/log` — utilities
- `GET/POST /api/admin/stats`, `/api/admin/agent` — admin (session-gated)
- `POST /api/images/[dish]` — image search; `GET /api/images/[dish]` — fetch/proxy
- NextAuth: `/api/auth/[...nextauth]`, `POST /api/auth/register`

## OCR internals (offline path — local.ts)

- **Preprocessing:** Sharp grayscale + normalize + sharpen + resize(2048) inside
  `runLocalOCR()` (fallback to raw image if Sharp unavailable).
- **PSM trial:** runs PSM modes `{6, 4, 11}` in parallel **plus RapidOCR** (`rapidocr_scan.py`
  via subprocess, PP-OCRv6 on ONNX Runtime, gets the RAW buffer — Sharp's sharpen amplifies
  noise on degraded photos and made it detect nothing), picks the result with the most
  alpha words. **Confidence gate:** candidates with avgConf < 40 are excluded (garbage OCR
  scores ~10 even when it produces *more* tokens than real text); ties break toward the
  higher-confidence engine. RapidOCR output is shaped like Tesseract data (word tokens with
  char-proportional boxes) so the shared parser pipeline consumes it unchanged. (Online
  engine.ts uses `{6,4,3,11,12}` — untouched.)
- **Parser layering:** paragraph-aware (Tesseract `blocks[].paragraphs[]`) → positional
  (`smartParse`, word bounding boxes → columns) → sequential (blank-line blocks) →
  basic line filter. Word-confidence ≥25 filter runs before any parser.
- **Validation gates:** `/[a-zA-Z]{3,}/` + `hasSufficientRealWords` (≥60% words with 3+
  letters; multi-word names need ≥2 qualifying words) + `isNoiseLine` — quality is secured
  by these, not word-count floors.
- **Category/keyword logic:** ~150 category keywords, 80+ OCR-correction table entries,
  noise filters (domains, order/delivery text, HOTEL/RESTAURANT headers, ©, page x of y).

## Testing notes

- Real menu photos are hard to source (wiki/unsplash return food photos). The reliable
  method: PIL-generated synthetic menus (Pillow installed) → POST to `/api/scan`.
- Ad-hoc scripts: name them `test_*.py` / `test_*.js` (gitignored) and delete after use.
- Parser helpers can be exercised directly with `node -e` snippets duplicating the logic,
  or `npx tsx` for imports.

## Conventions

- `@/` path alias → `src/`.
- Type-only imports: `import type { X }`.
- Tailwind v4 (`@import "tailwindcss"` in globals.css); shadcn/ui components in
  `src/components/ui` (Base UI primitives). Framer Motion for animations.
- `sonner` `toast()` for user feedback; `pino` logger (`src/lib/logger.ts`).
- Keep commits small, focused, and pushed. Test artifacts never enter git.
