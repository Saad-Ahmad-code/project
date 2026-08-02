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
| `src/lib/ocr/local.ts` | **Offline OCR** (~2,400 lines). RapidOCR-first candidate pool + Tesseract multi-PSM + deskew; 4 parsers (paragraph-aware → smartParse → sequentialParse → basicExtract); Ollama refine wiring + vision rescue; name cleanup; OCR-correction table; category keyword list; `hasSufficientRealWords` gate. |
| `src/lib/ocr/ollama.ts` | Ollama integration: `refineWithOllama` (gemma4:e2b local default, fail-soft, grounding gate), `ollamaVisionOCR` (qwen2.5vl:3b, rescue-only, `OLLAMA_VISION=0` gate). |
| `src/lib/ocr/cleaner.ts` | Deterministic pre-parser: drops venue/noise lines, merges split prices onto names. |
| `src/lib/ocr/engine.ts` | **Online pipeline.** Do NOT modify. References `runLocalOCR` from local.ts. |
| `src/lib/ai/client.ts` | AI chat completions: provider fallback chain (`src/lib/ai/providers.ts`), vision OCR, `pythonOCR()` subprocess runner. |
| `src/lib/agent/queue.ts` | Background enrichment job queue (`agent_log` collection: queued → processing → completed/failed). |
| `src/lib/agent/index.ts` | `enrichScan` — runs `researchDish` + image search per dish, persists back by dish id. |
| `src/lib/mongodb.ts` | Local JSON-file database (replaces MongoDB). Collections: `scans`, `dishes`, `users`, `agent_log`. |
| `src/lib/storage/index.ts` | `db` wrapper (findById/findBy/findAll/create/update/deleteOne/count) + `LocalStorage`. |
| `src/lib/images/` | Dish-image search: `index.ts` (orchestrator, scoring, timeout), `keywords.ts`, per-source files. |
| `src/lib/auth/options.ts` | NextAuth config, local JSON user storage. |
| `src/lib/diagnostics.ts`, `src/lib/error-handler.ts` | Health checks / auto-diagnostic error handler. |
| `src/lib/rate-limit.ts` | Shared per-IP sliding-window rate limiter (`checkRateLimit`/`getClientIp`) — used by the scan endpoint and every AI-backed route. |
| `src/scripts/menu_ocr.py` | Standalone Python OCR script (extracted from client.ts template literal). |
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
- **Candidate pool order (RapidOCR is the PRIMARY reader — do not reorder):**
  straight page = `rapid` first, then PSM `{6,4,11}` on the preprocessed image;
  skewed page = deskewed RapidOCR first, then deskewed PSM modes, then raw RapidOCR,
  then straight PSM modes. Sharp-fallback = RapidOCR then PSM `{6,4,11}`.
  `getBestResult` also adds `rapidBonus = 2` when the candidate has RapidOCR's
  `rawLines` — RapidOCR wins near-ties. Ties otherwise break toward higher
  avgConf; candidates with avgConf < 40 are excluded (garbage OCR scores ~10 even
  when it produces *more* tokens than real text). RapidOCR output is shaped like
  Tesseract data (word tokens with char-proportional boxes) so the shared parser
  pipeline consumes it unchanged. (Online engine.ts uses `{6,4,3,11,12}` — untouched.)
- **Ollama vision models are NOT in the pool** (benchmarked 2026-08): on this 6GB
  machine `qwen2.5vl:3b` times out (19–47s, accurate when it answers) and
  `gemma4:e2b` HALLUCINATES an entire plausible fake menu ("SPRING ROLLS / FRIES /
  BREADSTICKS" for a menu that actually lists Smoked Brisket). Hallucinated text
  parses to priced items, so no downstream gate can catch it — the only safe move
  is to never let vision text win. `qwen2.5vl:3b` runs only as a **vision rescue**:
  when deterministic OCR yields 0 items (`OLLAMA_VISION=0` disables it for the
  harness). Cloud Ollama models (`gpt-oss:120b-cloud`, `gemini-3-flash`, …) are all
  text-only — none have vision.
- **Ollama refine (`src/lib/ocr/ollama.ts`):** default model is **`gemma4:e2b`**
  (local, benchmarked equal to the cloud `gpt-oss:120b-cloud` for names/prices/
  categories and merged-row splitting; override with `OLLAMA_MODEL`). Runs after
  `crossValidate` when `OLLAMA_REFINE !== "0"`. Fail-soft contract: returns the
  SAME array reference on every error/timeout (default 30s) — reference equality
  is the signal the local fallback splitter keys on. `parseDishArray` applies a
  **grounding gate** (`nameGroundedInRaw`): a model name is rejected unless ≥50%
  of its words (edit-distance ≤1) appear in the raw OCR text — a hallucinating
  model cannot invent dishes that were never on the menu.
- **Parser layering:** paragraph-aware (Tesseract `blocks[].paragraphs[]`) → positional
  (`smartParse`, word bounding boxes → columns) → sequential (blank-line blocks) →
  basic line filter. Word-confidence ≥25 filter runs before any parser.
- **Header detection (`isHeaderLike`):** category keyword (first/last/all words),
  OR short ALL-CAPS no-price line with no food word ("SMOKER", "SPECIALS") — this
  rule was added because single-word all-caps section headers silently lost their
  whole section's category, and the venue gate (STEEL & OAK + "Est. 2011" subtitle)
  only applies to lines that are already `isHeader`. The short-CENTERED title-case
  rule (venue titles like "The Golden Fork") carries the SAME food-word guard —
  a centered no-price line whose words are food-related ("Chicken Quesadilla",
  which can land mid-band because `imgWidth` = max word right-edge, not canvas
  width) is a DISH, and treating it as a header silently ate the dish.
  `isCentered` itself requires roughly symmetric left/right margins (asymmetry
  >20% of `imgWidth` = left-aligned), so short left-aligned lines aren't
  mislabeled centered.
- **Input handling (`runLocalOCR`):** accepts both `File` (uploads, harness) and
  `Buffer` (internal callers). A Buffer has no `.arrayBuffer()` in this Node
  runtime — passing one used to throw and silently fall to the low-quality
  single-Tesseract fallback.
- **Column detection (`detectColumns`):** splits on a wide vertical gap; rejects a side
  that is mostly price-only lines (degraded layouts push price boxes to their own
  column) and merges lines whose x-gap is small (venue title bridging two columns).
- **Price handling:** price-only lines are captured into `pendingPrice` BEFORE the
  `isNoiseLine` check — `$8.75` is 60% digits, so the digit-ratio rule would classify
  it as noise and eat it. Split-price layouts (price box above/below the name) are
  handled by pending-price capture + the 2-line and 3-line name/description/price
  patterns in `parseColumn`. A title-case line directly after a price is a priced
  dish even when it's a category keyword (Cheesecake, Tiramisu) — only all-caps
  lines keep header status there. A dish line with its OWN price clears any pending
  orphan price, so a stray price-only line can't leak onto a later no-price dish.
- **Merged-row splitting:** OCR fuses adjacent rows / two-column dishes at the same
  Y into one line ("Buffalo Wings $10.50 Mozzarella Sticks $4.00"). Three layers
  handle it: (1) `splitMultiPriceRow` in `groupIntoLines` re-segments a Y-row with
  2+ standalone price tokens at the column gutter (wide gap, add-on words and
  size-variant "/" rows are protected) BEFORE column detection; (2) the primary
  Ollama refine splitter; (3) `splitMergedItemsFallback` — an ITERATIVE deterministic
  splitter that re-runs `splitMergedDishLine` on every output until no embedded
  price remains (≤3 rounds). The mid-price regex accepts the space-cents form
  ("$18 50") because `cleanDishName` Stage 5f mangles embedded "$18.50" that way.
  False splits are blocked by requiring a mid price (nothing after a bare trailing
  number), `DISH_PREFIX_WORDS` (with/extra/add/serves), food-word/all-caps halves,
  and the size-variant guard.
- **Validation gates:** `/[a-zA-Z]{3,}/` + `hasSufficientRealWords` (≥60% words with 3+
  letters; multi-word names need ≥2 qualifying words) + `isNoiseLine` — quality is secured
  by these, not word-count floors. Adaptive threshold: single-word dishes need a strong
  confidence (they're dropped when just 0.006 below the median — `isFoodRelated` must
  cover them, e.g. `cheesecake`).
- **Category/keyword logic:** ~150 category keywords, 80+ OCR-correction table entries,
  noise filters (domains, order/delivery text, HOTEL/RESTAURANT headers, ©, page x of y).
  `isFoodRelated` (used by confidence) is a separate list from category keywords — keep
  dish-name foods like cheesecake/pavlova/éclair AND meats like ribs/wings/brisket there
  so they survive the adaptive threshold (Baby Back Ribs dropped at 0.50 < 0.5118 until
  `ribs` was added).

## Testing notes

- Real menu photos are hard to source (wiki/unsplash return food photos). The reliable
  method: PIL-generated synthetic menus (Pillow installed) → POST to `/api/scan`.
- **Offline regression corpus:** `corpus/` (gitignored) holds 20 PIL-generated menus
  (`menu_*.png`) + `ground_truth.json`; the harness is `test_batch.ts` at the repo ROOT
  (its imports and paths assume root CWD). Run `npx tsx test_batch.ts` — it runs every
  menu through the full local OCR pipeline and diffs against ground truth. Current
  state: **154/154 exact name+price+category across 20 menus (0 name/price diffs,
  0 missing, 0 extra), deterministic across runs** — first fully-green run was v12
  (2026-08); the 3 merged-row/price-leak menus were added 2026-08. The harness
  MUST run with `OLLAMA_REFINE=0 OLLAMA_VISION=0 OLLAMA_CLEAN=0` (live Ollama would
  make it non-deterministic and slow — and the clean layer can silently DROP lines,
  e.g. a price-less dish, while "restoring" text). Add a new menu PNG + truth entries
  when you change parser logic.
- **Splitter unit probes:** `test_splitter.ts` (root, gitignored) exercises
  `splitMergedDishLine`/`splitMergedItemsFallback` directly — fast, no OCR. Covers
  the fused-row shapes (2- and 3-dish rows, digit-start second halves, space-cents
  mid prices like "$5 25", Onion Rings-style word-boundary traps) and the
  never-split guards (size variants, add-ons, "Chicken 65", "1/2 lb Burger").
  Run `PYTHONPATH= npx tsx test_splitter.ts` — must print `ALL PROBES PASS`.
- Ad-hoc scripts: name them `test_*.py` / `test_*.js` / `test_*.ts` (gitignored) and
  delete after use. `test_probe*.ts` one-off probes are fine, just delete them.
- Parser helpers can be exercised directly with `node -e` snippets duplicating the logic,
  or `npx tsx` for imports.

## Conventions

- `@/` path alias → `src/`.
- Type-only imports: `import type { X }`.
- Tailwind v4 (`@import "tailwindcss"` in globals.css); shadcn/ui components in
  `src/components/ui` (Base UI primitives). Framer Motion for animations.
- `sonner` `toast()` for user feedback; `pino` logger (`src/lib/logger.ts`).
- Keep commits small, focused, and pushed. Test artifacts never enter git.
