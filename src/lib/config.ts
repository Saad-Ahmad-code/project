/**
 * Centralized application configuration.
 *
 * All tunable constants live here, grouped by domain, so they can be
 * adjusted in one place instead of scattered magic numbers across the
 * codebase (rate limits, upload limits, OCR/AI timeouts, cache TTLs,
 * queue tuning). Import the individual constants or the grouped object —
 * both are kept in sync.
 */

export const APP_CONFIG = {
  rateLimit: {
    /** Max scan requests per IP per window */
    maxRequests: 10,
    /** Sliding window for the scan rate limiter */
    windowMs: 60 * 1000,
  },
  upload: {
    /** Max accepted menu photo size */
    maxImageBytes: 10 * 1024 * 1024, // 10MB
  },
  ai: {
    /** Consecutive failures before the circuit breaker opens a provider */
    consecutiveFailures: 3,
    /** How long an open circuit stays open before a half-open trial */
    cooldownMs: 60_000,
    /** Per-request timeout for chat completions */
    requestTimeoutMs: 30_000,
    /** Transient-failure retries per provider call */
    maxRetries: 2,
    /** Base delay for exponential backoff between retries */
    baseDelayMs: 500,
    /** Python OCR result cache lifetime */
    ocrCacheTtlMs: 300_000,
    /** Python OCR result cache max entries */
    ocrCacheMaxEntries: 50,
  },
  ocr: {
    /** Ollama refine/vision timeout */
    ollamaTimeoutMs: 30_000,
    /** Max raw OCR text fed to Ollama per call */
    maxRawText: 6000,
  },
  queue: {
    /** Background worker poll interval */
    workerPollMs: 5000,
    /** Max jobs processed concurrently */
    workerMaxConcurrent: 3,
    /** Default retries per job before it lands in the dead-letter queue */
    maxRetries: 3,
    /** Backoff base (ms) between retries — grows exponentially with attempt */
    retryBaseDelayMs: 5_000,
    /** Dish research/image-search concurrency inside one job */
    enrichmentConcurrency: 3,
    /** First N dishes per scan get AI details pre-generated in the
     *  background (fire-and-forget) so the results page shows descriptions
     *  without waiting for clicks; the rest generate on demand. */
    prewarmDishLimit: 6,
  },
  researchCache: {
    /** Dish research cache TTL for successful lookups */
    hitTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    /** Dish research cache TTL for failed lookups */
    missTtlMs: 10 * 60 * 1000, // 10 min
    /** Max entries in the in-memory research cache */
    maxEntries: 500,
  },
  nutritionCache: {
    /** Nutrition lookup cache TTL — 7 days: per-dish nutrition is static,
     *  so re-fetching it daily (or worse, per click) wastes API calls. */
    ttlMs: 7 * 24 * 3600_000,
  },
} as const;

// ── Individual typed exports (import these directly where used) ──

export const RATE_LIMIT_MAX = APP_CONFIG.rateLimit.maxRequests;
export const RATE_LIMIT_WINDOW_MS = APP_CONFIG.rateLimit.windowMs;
export const MAX_IMAGE_SIZE = APP_CONFIG.upload.maxImageBytes;

export const AI_CONSECUTIVE_FAILURES = APP_CONFIG.ai.consecutiveFailures;
export const AI_COOLDOWN_MS = APP_CONFIG.ai.cooldownMs;
export const AI_REQUEST_TIMEOUT_MS = APP_CONFIG.ai.requestTimeoutMs;
export const AI_MAX_RETRIES = APP_CONFIG.ai.maxRetries;
export const AI_BASE_DELAY_MS = APP_CONFIG.ai.baseDelayMs;
export const OCR_CACHE_TTL_MS = APP_CONFIG.ai.ocrCacheTtlMs;
export const OCR_CACHE_MAX_ENTRIES = APP_CONFIG.ai.ocrCacheMaxEntries;

export const OLLAMA_TIMEOUT_MS = APP_CONFIG.ocr.ollamaTimeoutMs;
export const MAX_RAW_TEXT = APP_CONFIG.ocr.maxRawText;

export const WORKER_POLL_MS = APP_CONFIG.queue.workerPollMs;
export const WORKER_MAX_CONCURRENT = APP_CONFIG.queue.workerMaxConcurrent;
export const AGENT_MAX_RETRIES = APP_CONFIG.queue.maxRetries;
export const AGENT_RETRY_BASE_DELAY_MS = APP_CONFIG.queue.retryBaseDelayMs;
export const ENRICHMENT_CONCURRENCY = APP_CONFIG.queue.enrichmentConcurrency;
export const PREWARM_DISH_LIMIT = APP_CONFIG.queue.prewarmDishLimit;

export const RESEARCH_HIT_TTL_MS = APP_CONFIG.researchCache.hitTtlMs;
export const RESEARCH_MISS_TTL_MS = APP_CONFIG.researchCache.missTtlMs;
export const RESEARCH_CACHE_MAX = APP_CONFIG.researchCache.maxEntries;

export const NUTRITION_CACHE_TTL_MS = APP_CONFIG.nutritionCache.ttlMs;
