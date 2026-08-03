# MenuLens — Project-Wide Improvement Recommendations

Generated: 2026-08-03

---

## 1. OCR Pipeline — Decompose `local.ts` (2685 lines)

**Problem:** `local.ts` is a single monolithic file containing type definitions, data constants, utility functions, parser logic, column detection, price handling, merged-row splitting, name cleanup, OCR correction, validation gates, and the main `runLocalOCR` orchestrator. This makes it hard to navigate, test in isolation, and modify without regressions.

**Recommendations:**
- Split into focused modules under `src/lib/ocr/`:
  - `parsing.ts` — `parseColumn`, `groupIntoLines`, `smartParse`, `sequentialParse`, `basicExtract`
  - `validation.ts` — `hasSufficientRealWords`, `isNoiseLine`, `isFoodRelated`, `isHeaderLike`
  - `price.ts` — `normalizePrice`, `findPriceInText`, `findPriceInWord`, `PriceResult`
  - `name-cleanup.ts` — `cleanDishName`, `correctOCRErrors`, `OCR_CORRECTIONS`
  - `columns.ts` — `detectColumns`, `isCentered`
  - `merged-split.ts` — `splitMergedDishLine`, `splitMergedItemsFallback`, `DISH_PREFIX_WORDS`
  - `candidates.ts` — `OCRCandidate`, `tryRapidOCR`, `tryMenuOCR`, `getBestResult`, the candidate pool orchestration
- Move `CATEGORY_KEYWORDS`, `isFoodRelated` word list, and `OCR_CORRECTIONS` to data files (`src/lib/ocr/data/`) so they can be updated without touching logic code
- Keep `local.ts` as a thin re-export barrel that imports from the new modules

**Impact:** High — reduces cognitive load, enables targeted testing, makes parser logic easier to audit and modify.

**Risk:** Low — pure refactor, no behavior change if done carefully. Run `test_batch.ts` and `test_splitter.ts` after each module extraction to verify no regressions.

---

## 2. AI Client — Remove Dead `callOCRAI` Path & Strengthen Circuit Breaker

**Problem:** `callOCRAI` in `client.ts` (lines 58-124) is a legacy OpenRouter-based OCR fallback that is only invoked from `pythonOCR` when the Python pipeline returns low confidence. It uses the free `google/gemma-4-26b-a4b-it:free` model which shares a 50 req/day quota with all other free models. The function has no caching, no circuit breaker, and no retry logic — it burns quota on every low-quality scan.

**Recommendations:**
- Remove `callOCRAI` entirely. The Python OCR pipeline (`menu_ocr.py`) already has its own AI rescue path, and `engine.ts` layer 3 (Gemini Vision) provides a higher-quality fallback. The `callOCRAI` path is redundant and consumes the OpenRouter free quota that should be reserved for the vision models.
- Improve the circuit breaker in `chatCompletions` to be keyed per-model (not just per-API-key), so a dead OpenRouter free model doesn't block the Groq or Gemini fallbacks that use different keys.
- Add a short-circuit for when all OpenRouter free models are rate-limited: skip to Gemini direct immediately instead of trying each one sequentially (the current code does this partially with `openRouterRateLimited` but still iterates through remaining free models).

**Impact:** Medium — removes a redundant API path that wastes quota, improves fallback reliability.

**Risk:** Low — the Python OCR pipeline already handles the AI rescue case; removing `callOCRAI` just eliminates the duplicate.

---

## 3. Storage Layer — Add Indexing & Query Optimization

**Problem:** `LocalCollection` in `mongodb.ts` reads the entire JSON file into memory on every operation (`_read()`) and writes the full collection on every mutation (`_write()`). For collections with many documents, this becomes a performance bottleneck. There are no indexes — every `find` and `findOne` does a linear scan.

**Recommendations:**
- Add an in-memory index map per collection: `Map<string, number>` (key → array index) for the primary `_id` field, and secondary indexes for frequently queried fields like `scan_id`, `user_id`.
- On `insertOne`, update the index. On `updateOne`/`deleteOne`, use the index for O(1) lookup instead of `findIndex` linear scan.
- For `find` queries, use the index when the query targets an indexed field (e.g., `{ scan_id: "xxx" }`), and fall back to linear scan for unindexed queries.
- Add a `_indexes` metadata file per collection that persists index definitions, so new indexes can be added without code changes.

**Impact:** Medium — significant read/write performance improvement for larger datasets (50+ scans, 200+ dishes).

**Risk:** Low — the index is rebuilt on `_read()` from the persisted JSON, so it's always consistent with the file.

---

## 4. Agent Queue — Add Retry with Exponential Backoff & Better Error Reporting

**Problem:** `queue.ts` has retry logic (up to `max_retries: 3`) but when a job exhausts retries, the scan is marked with a generic error message and the dishes remain un-enriched. There's no visibility into WHY a job failed, and no dead-letter queue for inspecting failed jobs.

**Recommendations:**
- Add a `deadLetterQueue` collection: when a job fails after all retries, move it to `agent_log_dlq` with the full error stack, the scan_id, and the dish names that were being processed. This enables manual inspection and re-processing.
- Add per-dish error tracking in the job record: store which dishes succeeded and which failed, so partial enrichment results aren't lost.
- Implement exponential backoff between retries (currently retries immediately on the next poll cycle, which can hammer a temporarily-down AI provider).
- Add a `retryJob` admin endpoint that resets a failed job's status to `queued` so it can be re-processed.

**Impact:** Medium — improves reliability and observability of the enrichment pipeline.

**Risk:** Low — additive changes, no behavior change for successful paths.

---

## 5. Image Search — Expand Non-Food Filter & Add Quality Scoring

**Problem:** `keywords.ts` has 34 `NON_FOOD_KEYWORDS` and 7 `FOOD_PATTERNS`. The `scoreImage` function uses simple keyword overlap and pattern matching. The non-food filter (`isFoodImage`) uses a threshold of `< 3` non-food keyword hits, which can let through irrelevant images (e.g., a restaurant interior photo that mentions "restaurant" but isn't a food photo).

**Recommendations:**
- Expand `NON_FOOD_KEYWORDS` with more indoor/venue terms: "interior", "exterior", "building", "room", "table setting", "cutlery", "napkin", "menu board" (these are common in image search results for restaurant dishes).
- Add a `FOOD_EXCLUSION_KEYWORDS` set for terms that indicate a food photo is NOT of a dish (e.g., "cooking", "preparation", "kitchen", "chef hands", "plating").
- Improve `scoreImage` to weight URL path segments more heavily than query parameters (e.g `/photos/123456/grilled-salmon.jpg` should score higher than `/images?query=grilled+salmon&photo=123`).
- Add a `preferredAspectRatio` hint: dish photos tend to be roughly 4:3 or 1:1, while banner/hero images are 16:9. Penalize extreme aspect ratios.

**Impact:** Medium — better image quality for dish photos, fewer irrelevant results.

**Risk:** Low — heuristic improvements, no breaking changes.

---

## 6. Frontend — Extract Shared UI Patterns & Add Skeleton States

**Problem:** The scan page (`scan/page.tsx`) and results page (`results/[id]/page.tsx`) both contain duplicated AI Food Expert suggestion panels, translation UI, and dietary filter logic. The suggestion panel code is copy-pasted between the two pages with minor differences.

**Recommendations:**
- Extract the AI Food Expert suggestion panel into a shared `SuggestionPanel` component in `src/components/` that accepts `suggestions`, `loading`, `error`, and `onRegenerate` props.
- Extract the dietary filter logic into a reusable `DietaryFilter` component that accepts `dietPrefs`, `onToggle`, and `items` props and returns filtered items.
- Add skeleton loading states to the results page's dish grid (similar to the history page) instead of the current inline skeleton that only shows during initial load.
- Add a `useDebounce` hook for the dietary filter toggle to avoid rapid re-renders when clicking multiple filter buttons.

**Impact:** Medium — reduces code duplication, improves UX consistency.

**Risk:** Low — refactor of existing UI patterns.

---

## 7. Testing — Add Unit Tests for OCR Correction & Cleaner

**Problem:** The test suite currently covers the merged-row splitter (`test_splitter.ts`) and the full OCR pipeline via the batch harness (`test_batch.ts`). But there are no unit tests for:
- `cleanOCRText` / `classifyLine` in `cleaner.ts`
- `correctOCRErrors` / `OCR_CORRECTIONS` in `local.ts`
- `isNoiseLine` edge cases
- `isHeaderLike` with various input shapes
- `normalizePrice` with edge cases (European comma decimals, space-cents, etc.)
- `nameGroundedInRaw` and `namesMatch` in `ollama.ts`

**Recommendations:**
- Create `src/lib/ocr/cleaner.test.ts` with unit tests for `classifyLine` (noise, price, header, dish) and `cleanOCRText` (split-price merge, venue title dropping, line classification).
- Create `src/lib/ocr/name-cleanup.test.ts` (after the split) for `correctOCRErrors` with representative OCR error patterns.
- Create `src/lib/ocr/validation.test.ts` for `isNoiseLine`, `isHeaderLike`, `hasSufficientRealWords`, `isFoodRelated` edge cases.
- Create `src/lib/ocr/price.test.ts` for `normalizePrice` with European formats, space-cents, and boundary values.
- Create `src/lib/ocr/ollama.test.ts` for `nameGroundedInRaw`, `namesMatch`, `parseDishArray`, and `isJunkDishName`.
- Add these test files to the `test` script in `package.json` (e.g., `"test": "npm run test:splitter && npm run test:ocr && npx vitest run"`).

**Impact:** High — prevents regressions in parser logic, makes future changes safer.

**Risk:** Low — additive, no behavior change.

---

## 8. Configuration — Centralize Magic Numbers

**Problem:** Magic numbers are scattered across the codebase:
- `RATE_LIMIT_MAX = 10`, `RATE_LIMIT_WINDOW = 60_000` in `scan/new/route.ts`
- `MAX_IMAGE_SIZE = 10 * 1024 * 1024` in `scan/new/route.ts`
- `ENRICHMENT_CONCURRENCY = 3`, `WORKER_MAX_CONCURRENT = 3`, `WORKER_POLL_MS = 5000` in `queue.ts`
- `CONSECUTIVE_FAILURES = 3`, `COOLDOWN_MS = 60_000` in `client.ts`
- `DEFAULT_TIMEOUT_MS = 30000`, `MAX_RAW_TEXT = 6000` in `ollama.ts`
- `HIT_TTL_MS`, `MISS_TTL_MS`, `CACHE_MAX` in `dish-research.ts`
- `CACHE_TTL = 3600_000` in `nutrition/route.ts`

**Recommendations:**
- Create `src/lib/config.ts` with a single `APP_CONFIG` object containing all configurable constants, grouped by domain (rate limits, OCR, AI, caching, queue).
- Export individual typed constants from this file so existing imports can be updated incrementally.
- Add `NEXT_PUBLIC_` prefixed env var overrides for any values that should be configurable at build time.

**Impact:** Low effort, high maintainability — makes tuning parameters easier and prevents magic-number drift.

**Risk:** Low — additive, no behavior change.

---

## 9. Type Safety — Fix `any` Types in Agent & Storage Layers

**Problem:** Several files use `any` type extensively, reducing TypeScript's ability to catch errors:
- `queue.ts`: `db.findById<any>`, `db.findBy<any>`, `db.update<any>`, `agentResult.dishes` cast with `as any`
- `storage/index.ts`: `db` wrapper returns `T | null` but internal methods use `any`
- `client.ts`: `callProvider` returns `{ choices: { message: { content: string } }[] }` which is fragile
- `mongodb.ts`: `_match` accepts `query: any` and `item: any`

**Recommendations:**
- Define proper interfaces for all database documents (`ScanDoc`, `DishDoc`, `AgentJobDoc`) in `src/lib/mongodb.ts` or a new `src/lib/db-types.ts`.
- Replace `any` casts in `queue.ts` with the proper interfaces.
- Add a `Document` base type with `_id: string`, `created_at: string`, `updated_at: string` that all collection documents extend.

**Impact:** Medium — catches type errors at compile time, improves IDE autocompletion.

**Risk:** Medium — requires updating type annotations across several files, but no runtime behavior change.

---

## 10. Monitoring — Add Health Check for Ollama & AI Providers

**Problem:** The app has a `/api/diagnostics` endpoint but it doesn't check Ollama availability or AI provider health. When Ollama is running but a model is missing, the OCR pipeline silently falls through to the next layer. When an AI provider key is invalid, the circuit breaker catches it but there's no proactive alerting.

**Recommendations:**
- Extend `/api/diagnostics` to probe Ollama (`/api/tags`) and report which models are installed.
- Add a `/api/admin/ai-health` endpoint that checks each configured AI provider with a lightweight test call (e.g., a minimal chat completion) and reports latency and availability.
- Log Ollama model availability at server startup so it's visible in logs without hitting the diagnostics endpoint.

**Impact:** Low — improves operational visibility.

**Risk:** Low — additive, no behavior change.

---

## Implementation Order

1. **OCR decomposition** (highest impact, most work) — split `local.ts` into modules
2. **Remove dead `callOCRAI`** — quick win, removes redundant API path
3. **Add unit tests** — prevents regressions during refactoring
4. **Centralize config** — easy refactor, improves maintainability
5. **Fix `any` types** — improves type safety incrementally
6. **Storage indexing** — performance improvement for larger datasets
7. **Agent queue improvements** — reliability and observability
8. **Image search improvements** — better dish photo quality
9. **Frontend extraction** — reduces duplication
10. **Monitoring** — operational visibility

---

## Validation

After each improvement:
- Run `npm run test:splitter` — must print `ALL PROBES PASS`
- Run `npm run test:ocr` — must maintain 154/154 exact matches across 20 menus
- Run `npm run lint` — must pass with zero errors
- Run `npm run typecheck` — must pass with zero errors
- Run `npm run dev` — must start without errors
  