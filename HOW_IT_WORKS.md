# How MenuLens Works — Complete Guide

This document explains **everything**: what the app does, how every feature
works internally, how data flows through the system, and how each subsystem is
implemented. It's written for anyone opening this codebase for the first time.

> For quick setup instructions see `README.md`. This file goes deeper.

---

## Table of Contents

1. [What is MenuLens?](#1-what-is-menulens)
2. [Tech stack](#2-tech-stack)
3. [Big-picture architecture](#3-big-picture-architecture)
4. [The scan flow, end to end](#4-the-scan-flow-end-to-end)
5. [OCR: reading the menu photo](#5-ocr-reading-the-menu-photo)
6. [Background enrichment agent](#6-background-enrichment-agent)
7. [Dish image search](#7-dish-image-search)
8. [AI provider layer](#8-ai-provider-layer)
9. [Feature tour (every page)](#9-feature-tour-every-page)
10. [API reference](#10-api-reference)
11. [Storage: the JSON database](#11-storage-the-json-database)
12. [Security](#12-security)
13. [Performance engineering](#13-performance-engineering)
14. [Configuration & environment variables](#14-configuration--environment-variables)
15. [Testing](#15-testing)

---

## 1. What is MenuLens?

MenuLens is an **AI menu scanner**. You point your phone at a restaurant menu,
take a photo, and within seconds you get:

- A structured list of dishes with names, prices, categories, and descriptions
- A food photo for every dish
- AI-generated deep dives per dish (ingredients, preparation, serving ideas, fun facts)
- Nutrition info and recipes
- An "AI food expert" that recommends what to order
- Translation into 8+ languages
- Dietary filters (vegetarian, vegan, gluten-free, halal, low-carb, keto)
- Side-by-side comparison of different scans

It works in two modes:

| Mode | What it uses | When |
|---|---|---|
| **AI mode** (default) | Local OCR racing cloud AI vision | Best accuracy, needs an API key |
| **Offline mode** | RapidOCR + Tesseract + optional local Ollama LLM | Zero API keys, fully local |

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS v4, shadcn/ui components, Framer Motion animations |
| OCR | Tesseract.js (WASM), Sharp (image preprocessing), Python subprocesses (RapidOCR / pytesseract) |
| AI | OpenRouter → Groq → Gemini → Ollama fallback chain (chat + vision) |
| Images | Unsplash, Pexels, Bing, Wikipedia, Openverse, TheMealDB, Pollinations, local DB |
| Auth | NextAuth v4 (credentials provider, bcrypt-hashed users) |
| Storage | File-backed MongoDB-style JSON collections in `data/` |
| Streaming | Server-Sent Events (SSE) with `eventsource-parser` on the client |
| Logging | pino structured logger |

---

## 3. Big-picture architecture

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  /scan page                                                          │
│    • picks file / camera / barcode                                   │
│    • compresses image client-side (canvas ≤1600px, JPEG q0.75)       │
│    • POSTs multipart form to /api/scan/new                           │
│    • reads SSE stream → live progress bar                            │
│                                                                      │
│  /results/[id] page                                                  │
│    • polls GET /api/scan/[id] every 4s while status = processing     │
│    • renders dish cards; tap → dialog with photos/details            │
│    • prefetches photo galleries for first 6 dishes in background     │
└──────────────┬───────────────────────────────┬───────────────────────┘
               │ HTTPS (CSRF token header)     │
┌──────────────▼───────────────────────────────▼───────────────────────┐
│                        Next.js server (Node)                         │
│                                                                       │
│  /api/scan/new                                                        │
│    1. validate CSRF, rate limit, size                                 │
│    2. run OCR pipeline          → src/lib/ocr/*                       │
│    3. persist scan + dishes     → src/lib/storage (data/*.json)       │
│    4. queue background job      → src/lib/agent/queue.ts              │
│    5. stream "complete" event                                         │
│                                                                       │
│  Background worker pool (in-process)                                  │
│    • image search per dish      → src/lib/images/*                    │
│    • writes results back to DB, marks scan "completed"                │
│                                                                       │
│  On-demand endpoints (called when you tap a dish)                     │
│    • /api/dishes/details   AI description (cached per dish)           │
│    • /api/nutrition        Open Food Facts / USDA                     │
│    • /api/recipes          recipe lookup                              │
│    • /api/images/[dish]    photo gallery (TTL-cached)                 │
│    • /api/translate        menu translation                           │
│    • /api/suggest          AI food-expert suggestions                 │
└──────────────────────────────────────────────────────────────────────┘
```

Key idea: **the scan returns as fast as possible** (OCR only). Everything
expensive — photos, AI descriptions — happens in the background or on demand,
so you see dishes in seconds and they get richer while you browse.

---

## 4. The scan flow, end to end

### Step by step

1. **Capture** — `/scan` accepts a file upload, phone camera (`CameraCapture`),
   or a barcode scan (`BarcodeScanner`, html5-qrcode). Barcode lookups skip
   OCR entirely and query nutrition databases by EAN.
2. **Client-side compression** — before upload the browser resizes the image
   to max 1600px and re-encodes at JPEG quality 0.75 (`src/lib/image-compress.ts`).
   A 5 MB photo becomes ~300 KB → much faster upload *and* faster OCR.
3. **Upload** — `POST /api/scan/new` (multipart). The server:
   - validates the CSRF token header
   - rate-limits by IP (scan bucket)
   - rejects images > 10 MB, and server-side compresses anything > 500 KB via Sharp
4. **OCR runs** — see section 5. Progress is streamed live over SSE
   (`event: status`, `progress: 10…50`).
5. **Persist** — scan doc saved to `data/scans.json`, dish docs batch-inserted
   to `data/dishes.json`. Scan marked `"processing"` so the results page keeps
   polling until enrichment finishes.
6. **Queue enrichment** — a background job is created (`data/agent_log.json`)
   and processed without blocking the response (section 6).
7. **Complete event** — SSE sends `complete` with the item list. AI scans then
   navigate to `/results/[id]`; offline scans render inline on `/scan`.
8. **Enrichment lands** — the results page polls every 4 s; when dietary tags
   and photos are written they appear without a manual reload. Status flips to
   `"completed"` when done.

### SSE events emitted by `/api/scan/new`

| Event | Meaning |
|---|---|
| `status` | progress updates: uploading → ocr_started → ocr_layer3 → ocr_complete → saved → enrichment_queued |
| `complete` | final payload: `scan_id`, items, layer used, confidence |
| `error` | human-readable failure message |

---

## 5. OCR: reading the menu photo

Two independent pipelines exist under `src/lib/ocr/`.

### 5.1 AI-mode pipeline (`engine.ts`)

Runs Tesseract.js and cloud AI vision **in parallel with an early-exit race**:

```
            ┌── Tesseract.js (+Sharp preprocessing variants) ──┐
image ──────┤                                                   ├── winner
            └── AI Vision (OpenRouter models → Gemini direct) ──┘
```

- If Tesseract finishes first with ≥2 clean, non-garbled items → it wins
  instantly and the AI vision call is **aborted mid-flight** (via
  `AbortSignal`), saving latency and API quota. This is the common path:
  scans typically complete in single-digit seconds.
- If Tesseract's output looks garbled (decorative fonts, embedded prices,
  noise suffixes — detected by `isGarbledResult()`), the pipeline waits for
  the higher-accuracy vision result instead.
- The vision layer has a hard total deadline (`ocr.visionTimeoutMs`, 25 s)
  across all provider attempts so a slow provider can never hang a scan past
  the client's timeout window.
- Every unique image hash result is cached in-memory for 5 minutes — rescanning
  the same photo is instant.

### 5.2 Offline pipeline (`local.ts`) — `mode=offline`

A heavier deterministic pipeline designed to work with zero cloud services:

1. **Preprocess** with Sharp: grayscale, resize to 2048px, estimate skew from
   RapidOCR output, deskew if tilted ≥2.5°, brightness-boost dark menus.
2. **Candidate pool** — runs several readers concurrently and scores them:
   - RapidOCR (PP-OCR neural reader, via Python subprocess)
   - pytesseract word-level pipeline (menu_ocr.py rescue)
   - Tesseract.js at PSM modes 6 / 4 / 11 on each preprocessed variant
   - best candidate picked by parse quality (`pickByParseQuality`)
3. **Deterministic parsing** — pure-TS modules clean and structure raw text:
   - `cleaner.ts` OCR-error corrections, `price.ts` currency-symbol aware price
     recovery (incl. misread rupee ₹ glyphs), `merged-split.ts` splitting fused
     rows like `Buffalo Wings $10.50 Mozzarella Sticks $4.00`,
     `validation.ts` junk/header rejection, `columns.ts` column detection,
     cross-candidate price recovery, cross-validation.
4. **Optional Ollama passes** (all skippable via env vars):
   - `OLLAMA_CLEAN` — LLM text cleaning, only when garbage signals exceed thresholds
   - `OLLAMA_REFINE` — dish name/price/category refinement when the parse is weak
   - `OLLAMA_VISION` — the vision model reads the raw image directly and its
     JSON replaces the deterministic parse when confident. This call is
     **started at the very beginning of the pipeline** so it overlaps all the
     deterministic work instead of adding latency at the end.
5. Results cached persistently by SHA-256 of the image (`data/cache.json`) —
   identical bytes never re-OCR.

---

## 6. Background enrichment agent

After a scan saves, `enqueueAndProcessInBackground()` creates a job document
and processes it with an in-process worker pool.

### What enrichment does per dish

- **Image search** (section 7) so every card has a photo immediately.
- **Dietary tag classification** (`dietary-tags.ts`).
- Deliberately does **NOT** generate AI descriptions here — those are produced
  on demand when you tap a dish (one AI call per viewed dish instead of 40
  calls for a 40-dish menu).

### Reliability model (`queue.ts`)

- Jobs move through `queued → processing → completed`.
- Failures retry with **exponential backoff** (`retry_at = now + base × 2^attempt`).
- Jobs that exhaust retries land in a **dead-letter queue**
  (`data/agent_log_dlq.json`) with full error details; admins can re-run them
  from the admin panel.
- Per-dish errors are recorded individually so one bad dish doesn't lose the
  rest of the enrichment.
- Enrichment writes are batched; the scan's status flips to `completed` at the
  end, which stops the results page polling.

---

## 7. Dish image search

`src/lib/images/index.ts` fans out one dish name to **8 sources in parallel**
(6-second timeout each):

| Source | Weight | Notes |
|---|---|---|
| Unsplash | 35 | high-quality food photography |
| Pexels | 25 | stock photos |
| Bing Images | 20 | web-scale results |
| Wikipedia | 18 | real photos of named dishes |
| Openverse | 15 | CC-licensed images |
| TheMealDB | 10 | curated dishes |
| Pollinations | 5 | AI-generated fallback (returns a URL instantly) |
| Local DB | 3 | previously-seen images |

Then results go through quality control:

- `isValidImageUrl` — must be a real image URL on a known-good domain
- `isFoodImage` — keyword filters reject non-food hits ("restaurant interior",
  cooking hands, ingredients-only shots)
- `scoreImage` — ranks by food keywords, URL-path overlap with the dish name
  (descriptive paths beat query params), source weight, and aspect-ratio
  penalties (banners/posters demoted)

### Caching layers

| Layer | TTL | Effect |
|---|---|---|
| In-flight dedup | duration of request | identical concurrent searches share one fan-out |
| TTL cache (`researchCache` config) | **7 days** for hits, 10 min for misses, 500 entries | repeat taps/prefetches return instantly with zero provider calls |

### Client-side loading experience

- `usePhotoPrefetch` hook warms galleries for the first 6 dishes (2 requests
  at a time, starting ~1 s after results appear) — tapping a card is instant.
- `ProgressiveImage` component shows a shimmer placeholder that fades out
  when the photo decodes (handles browser-cached images correctly, respects
  `prefers-reduced-motion`).
- Card thumbnails lazy-load; broken URLs hide themselves gracefully.

---

## 8. AI provider layer

`src/lib/ai/client.ts` exposes two main entry points:

### `chatCompletions(opts)` — text generation

Used by suggestions, translation, dish details, dietary classification, recipes.
Provider chain sorted by priority (OpenRouter → Groq → Gemini → SambaNova →
HuggingFace → GitHub Models → Cloudflare → local Ollama), with hardening:

- **Circuit breaker** per model — repeated transient failures open the circuit
  temporarily so dead providers aren't retried on every request.
- **Rate-limit short-circuit** — all OpenRouter free models share ONE daily
  quota, so one 429 blacklists the whole key for the process lifetime instead
  of marching through every model failing identically.
- **Dead-model registry** — a 404 permanently skips that model slug.
- Timeouts + bounded retries per provider.

### `callGeminiVision(buffer, prompt)` — vision OCR

Tries OpenRouter vision models, then Gemini direct, then a Python fallback.
Supports external cancellation (`AbortSignal`) so the OCR race can abort it,
and combines that signal with per-attempt timeouts via `AbortSignal.any`.

If no provider has quota, errors surface as clear messages ("rate-limited…
resets at midnight UTC") rather than silent failures.

---

## 9. Feature tour (every page)

### `/scan` — capture
- File upload, drag-drop, camera capture (mobile), live barcode scanner
- Mode toggle: AI scan vs Offline scan
- Live progress bar fed by SSE events; skeleton loaders while scanning

### `/results/[id]` — the main experience
- **Dish grid** — cards with photo thumbnail, name, price, category badges,
  confidence %, staggered entrance animation (capped so long menus don't wait)
- **Tap a dish** → dialog with:
  - AI-generated description: detailed_description, ingredients, preparation,
    serving suggestions, fun fact (generated once per dish, cached client- and
    server-side; supports forced regeneration, including "regenerate all")
  - Photo gallery (instant thanks to prefetch + server cache)
  - **Nutrition panel** — calories/macros via Open Food Facts + USDA FoodData
    Central, pre-warmed on first tap
  - **Recipe panel** — how to cook it yourself
- **AI Food Expert** (`/api/suggest`) — expert picks, pairings, allergen flags
- **Dietary filter pills** — vegetarian / vegan / gluten-free / halal /
  low-carb / keto; debounced so rapid toggles don't thrash re-renders
- **Translation** — translate the menu into 8+ languages

### `/history`
List of your previous scans; reopen any of them.

### `/compare`
Pick two scans → side-by-side dish comparison (`/api/scans/compare`), useful
for deciding between restaurants or spotting price changes over time.

### `/auth/login` · `/auth/register`
NextAuth credentials auth. Passwords bcrypt-hashed. Sessions carry the user id
so scans are attributed; anonymous scanning still works.

### `/admin` (admins only)
Operational dashboard backed by `/api/admin/stats`, `/api/admin/ai-health`,
and `/api/admin/agent`: scan counts, provider health, background-job monitoring,
dead-letter inspection and **job retry**. Users get `isAdmin` flags in
`data/users.json`.

---

## 10. API reference

All mutating endpoints require the CSRF header; nearly all are rate-limited
per IP **per bucket** (scans don't compete with gallery browsing).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/scan/new[?mode=offline]` | POST | Upload image, stream OCR + save + enqueue enrichment (SSE) |
| `/api/scan/[id]` | GET | Scan + dishes (polled during enrichment); POST triggers AI suggestions |
| `/api/dishes/[id]` | GET/PATCH | Single dish access/update |
| `/api/dishes/details` | POST | On-demand AI dish description (`regenerate: true` forces refresh) |
| `/api/images/[dish]` | GET/POST | Photo gallery search (TTL-cached, own rate bucket) |
| `/api/nutrition` | POST | Nutrition lookup by name/barcode |
| `/api/recipes` | POST | Recipe lookup |
| `/api/suggest` | POST | AI food-expert suggestions for a scan |
| `/api/translate` | POST | Menu translation |
| `/api/classify` | POST | Dietary classification |
| `/api/scans/compare` | POST | Compare two scans |
| `/api/csrf/token` | GET | Issue CSRF secret cookie + token |
| `/api/auth/*` | — | NextAuth handlers |
| `/api/auth/register` | POST | Account creation |
| `/api/admin/*` | GET/POST | Stats, AI health, agent jobs/retry (admin only) |
| `/api/health`, `/api/diagnostics` | GET | Liveness + system diagnostics |
| `/api/log` | POST | Client error log sink |

---

## 11. Storage: the JSON database

No external database required. `src/lib/storage` implements a MongoDB-style
API (`db.create`, `mongodb('collection').insertMany/updateOne/find`, etc.)
over JSON files in `data/`:

| File | Contents |
|---|---|
| `users.json` | accounts (bcrypt hashes, isAdmin flags) |
| `scans.json` | one doc per scan (status, counts, summary) |
| `dishes.json` | dish docs linked to scans (name, price, tags, image_url) |
| `agent_log.json` | enrichment job queue documents |
| `agent_log_dlq.json` | dead-lettered jobs |
| `cache.json` | persistent OCR cache (SHA-256 keyed) |
| `corrections.json` | learned OCR correction pairs |

Conventions worth knowing:

- Documents store `_id` ONLY (no parallel `id` field); `{ id }` queries are
  aliased to `_id` internally.
- Writes are batched where possible (one `insertMany` per scan, not N writes)
  because each write rewrites the collection file.
- State is per-process/instant-persist — good for single-instance deploys;
  swap in a real MongoDB via `MONGODB_URI` if you scale horizontally.

---

## 12. Security

| Concern | Implementation |
|---|---|
| CSRF | double-submit: secret cookie + `x-csrf-token` header checked on every mutation (`requireCsrf`) |
| Rate limiting | sliding-window per IP, **namespaced buckets** (`scans`, `images`, …) so one feature can't starve another; memory-pruned at 10k entries |
| Injection/output | error messages sanitized (`sanitizeErrorMessage`) before reaching clients |
| Passwords | bcrypt hashing, never stored or logged in plaintext |
| Secrets | `.env.local` gitignored; keys only read server-side |
| Uploads | type + size validation (10 MB cap), server-side re-compression |
| Admin surfaces | gated by session `isAdmin` role |

---

## 13. Performance engineering

Recent optimizations, and why they matter:

1. **Early-exit OCR race** — Tesseract (fast, local) and AI vision start
   together; the moment Tesseract produces clean text the vision call is
   aborted. Typical scans drop from "wait for the slowest engine" to
   "wait for the fastest good-enough engine".
2. **Overlapped Ollama vision (offline mode)** — the vision pass starts when
   the pipeline starts, not after it, hiding most of its latency.
3. **Vision deadline** — a 25 s cap across all vision attempts prevents
   pathological provider hangs from blowing the client's 120 s window.
4. **On-demand descriptions** — enrichment no longer burns one AI call per
   dish up-front; descriptions generate when a dish is tapped (then cached).
5. **Image TTL cache** — 7-day hit cache means a dish's gallery is computed
   once, ever (per server process). Prefetch makes first taps feel instant.
6. **Rate-limit buckets** — browsing many photo galleries no longer triggers
   spurious 429s on scan/detail endpoints.
7. **Progressive images** — shimmer placeholders + fade-in instead of layout
   pop-in; capped entrance-animation delays keep long menus snappy.
8. **Client compression** — images shrink ~90% before they ever hit the wire.

---

## 14. Configuration & environment variables

Copy `.env.example` → `.env.local`. Nothing is strictly required — OCR and
core scanning degrade gracefully without any keys.

| Variable | Used for |
|---|---|
| `OPENROUTER_API_KEY` | primary chat + vision provider |
| `GROQ_API_KEY` | fast fallback chat provider |
| `GEMINI_API_KEY` | Gemini chat + direct vision fallback |
| `OLLAMA_URL`, `OLLAMA_MODEL` | local LLM (offline refine/clean/vision + chat chain) |
| `OLLAMA_REFINE/CLEAN/VISION=0` | disable individual Ollama passes |
| `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `BING_API_KEY` | image sources |
| `USDA_API_KEY` | nutrition lookups |
| `PYTHON_CMD`, `TESSERACT_CMD` | offline OCR subprocess resolution |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | auth (required for login in production) |
| `LOG_LEVEL` | pino verbosity |

Central runtime tuning lives in `src/lib/config.ts` (timeouts, retries,
queue concurrency, cache TTLs, rate limits) — one place to adjust behavior.

---

## 15. Testing

```bash
npm run test          # full suite: units → splitter probes → OCR batch
npm run test:units    # parser/cleaner/price/validation unit tests
npm run test:splitter # fused-row splitter regressions
npm run test:ocr      # OCR batch vs synthetic ground-truth menus
npm run check         # eslint + tsc
npm run build         # production build (stop dev server first)
```

The harnesses compare OCR output against ground truth to catch regressions in
parsing, price recovery, and row-splitting logic.

---

*Generated August 2026 — reflects the codebase including the early-exit OCR
race, image TTL caching/prefetch, progressive image loading, and bucketed rate
limiting.*
