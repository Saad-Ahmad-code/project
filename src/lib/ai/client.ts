/**
 * AI client — chat completion with a multi-provider fallback chain
 * (see providers.ts), vision-based OCR, and the Python OCR subprocess runner.
 */
import { logger } from "@/lib/logger";
import { providers, getCloudflareBaseURL, VISION_MODELS } from "@/lib/ai/providers";
import {
  AI_CONSECUTIVE_FAILURES,
  AI_COOLDOWN_MS,
  AI_REQUEST_TIMEOUT_MS,
  AI_MAX_RETRIES,
  AI_BASE_DELAY_MS,
  OCR_CACHE_TTL_MS,
  OCR_CACHE_MAX_ENTRIES,
} from "@/lib/config";

// Node builtins are resolved at runtime via eval('require') so webpack does
// not statically trace them when this module is pulled into bundles such as
// the instrumentation hook (queue → agent → client) — without this, the
// instrumentation bundle fails with "Module not found: Can't resolve 'os'".
// Same pattern as src/lib/mongodb.ts (AGENTS.md rule #3).
const _require = eval('require') as NodeRequire;
const { tmpdir } = _require('os') as typeof import('os');
const { join } = _require('path') as typeof import('path');
const { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } = _require('fs') as typeof import('fs');
const { execSync } = _require('child_process') as typeof import('child_process');
const { createHash } = _require('crypto') as typeof import('crypto');

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
}

const OCR_TEMP_DIR = join(tmpdir(), "menulens-ocr");

// ── Python OCR Cache ──
const ocrCache = new Map<string, { result: string; ts: number }>();

function cacheGet(key: string): string | null {
  const entry = ocrCache.get(key);
  if (entry) {
    if (Date.now() - entry.ts > OCR_CACHE_TTL_MS) {
      ocrCache.delete(key);
      return null;
    }
    return entry.result;
  }
  return null;
}

function cacheSet(key: string, result: string): void {
  if (ocrCache.size >= OCR_CACHE_MAX_ENTRIES) {
    const first = ocrCache.entries().next().value;
    if (first) ocrCache.delete(first[0]);
  }
  ocrCache.set(key, { result, ts: Date.now() });
}

// ── Python OCR Pipeline ──
async function pythonOCR(imageBuffer: ArrayBuffer): Promise<string> {
  const hash = createHash("sha256").update(Buffer.from(imageBuffer)).digest("hex").slice(0, 32);
  const cached = cacheGet(hash);
  if (cached) {
    logger.info(`[PythonOCR] Cache hit: ${hash.slice(0, 8)}`);
    return cached;
  }

  if (!existsSync(OCR_TEMP_DIR)) {
    mkdirSync(OCR_TEMP_DIR, { recursive: true });
  }

  const inputPath = join(OCR_TEMP_DIR, `input-${hash.slice(0, 8)}.png`);
  const scriptPath = join(OCR_TEMP_DIR, "ocr.py");

  writeFileSync(inputPath, Buffer.from(imageBuffer));

  // The OCR script lives as a real .py file (src/scripts/menu_ocr.py) so it's
  // readable and maintainable. Placeholders are substituted at runtime.
  // NOTE: /g on every placeholder — they appear in both the docstring and the
  // code (e.g. __IMG_PATH__). Path values use forward slashes: backslashes in
  // a plain (non-raw) docstring would break Python parsing (truncated \U escape),
  // while the r"..." strings keep them verbatim; "/" works in both.
  const repoScript = join(process.cwd(), "src", "scripts", "menu_ocr.py");
  const slash = (p: string) => p.replace(/\\/g, "/");
  const pythonScript = readFileSync(repoScript, "utf8")
    .replace(/__PYTHON_SITE_PACKAGES__/g, slash(process.env.PYTHON_SITE_PACKAGES || ""))
    .replace(/__TESSERACT_CMD__/g, slash(process.env.TESSERACT_CMD || "tesseract"))
    .replace(/__IMG_PATH__/g, slash(inputPath));

  writeFileSync(scriptPath, pythonScript);

  logger.info("[PythonOCR] Menu-specific pipeline (word-level + confidence + spatial)...");

  try {
    // Prefer the project venv Python (has pytesseract/numpy/scipy), matching
    // engine.ts layer 3. PYTHONPATH must be cleared: when the app is spawned
    // from an agent/editor shell, PYTHONPATH may point at that shell's own
    // venv, and the OCR subprocess would import its (possibly broken or
    // wrong-version) numpy instead of this venv's.
    const venvPython = join(process.cwd(), '.venv', 'Scripts', 'python.exe');
    const pythonCmd = process.env.MENULENS_PYTHON || (
      existsSync(venvPython) ? venvPython : (process.env.PYTHON_CMD || 'python')
    );
    const raw = execSync(
      `"${pythonCmd}" "${scriptPath}"`,
      { timeout: 180000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONPATH: '' } }
    ).toString().trim();

    let result: { menu_name?: string; items?: { name?: string; description?: string; price?: number; category?: string; confidence?: number }[]; raw_text?: string; strategy?: string; avg_confidence?: number };
    try {
      result = JSON.parse(raw);
    } catch {
      result = { menu_name: "", items: [], raw_text: raw, strategy: "parse-fallback", avg_confidence: 0 };
    }

    const itemCount = result.items?.length || 0;
    const avgConf = result.avg_confidence || 0;

    logger.info(`[PythonOCR] ${itemCount} items (conf=${avgConf}, strat=${result.strategy || "?"})`);

    // NOTE: no AI extraction from raw text here — the legacy callOCRAI path
    // was removed (it burned the shared OpenRouter free quota on every
    // low-quality scan). Low-quality Python OCR results are returned as-is;
    // the OCR engine's vision layer (engine.ts L4 / callGeminiVision) is the
    // higher-quality rescue path.

    if (!result.items || result.items.length === 0) {
      const fallback = JSON.stringify({ menu_name: "", items: [] });
      cacheSet(hash, fallback);
      return fallback;
    }

    const output = JSON.stringify({
      menu_name: result.menu_name || "",
      items: result.items.map((item) => ({
        name: item.name?.slice(0, 200) || "Menu Item",
        description: item.description?.slice(0, 500) || "",
        price: item.price,
        category: item.category || "menu",
        confidence: item.confidence || 0.5,
      })),
    });

    cacheSet(hash, output);
    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[PythonOCR] Failed: ${msg.slice(0, 200)}`);
    throw new Error(`PythonOCR: ${msg.slice(0, 100)}`);
  } finally {
    try { unlinkSync(inputPath); } catch { /* ignore */ }
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

// ── Circuit breaker ──
// Tracks per-model failures. After CONSECUTIVE_FAILURES failures (default 3),
// the model's circuit opens for COOLDOWN_MS (default 60s): the provider is
// skipped entirely instead of burning a 30s timeout per attempt. After the
// cooldown, a single trial (half-open) decides whether to close the circuit
// (success) or reopen it (another failure).
//
// Keyed by model name (not apiKeyEnv): a dead OpenRouter free model opens
// its own circuit without blocking Groq/Gemini providers that use different
// keys. Two providers sharing a model slug share the circuit, which is the
// desired behavior (same upstream endpoint).
const CONSECUTIVE_FAILURES = AI_CONSECUTIVE_FAILURES;
const COOLDOWN_MS = AI_COOLDOWN_MS;

interface CircuitState {
  failures: number;
  openedAt: number;
  /** true = skip all calls; false = allow (closed or half-open trial) */
  open: boolean;
}

const circuitStore = new Map<string, CircuitState>();

function circuitOpen(model: string): boolean {
  const state = circuitStore.get(model);
  if (!state || !state.open) return false;
  // Cooldown elapsed → half-open: allow one trial call.
  if (Date.now() - state.openedAt >= COOLDOWN_MS) return false;
  return true;
}

function circuitRecordFailure(model: string): void {
  const state = circuitStore.get(model) || { failures: 0, openedAt: 0, open: false };
  state.failures += 1;
  if (state.failures >= CONSECUTIVE_FAILURES) {
    state.open = true;
    state.openedAt = Date.now();
    logger.warn(`[AI] Circuit breaker OPENED for ${model} (${state.failures} consecutive failures)`);
  }
  circuitStore.set(model, state);
}

function circuitRecordSuccess(model: string): void {
  const state = circuitStore.get(model);
  if (!state) return;
  if (state.open) {
    logger.info(`[AI] Circuit breaker CLOSED for ${model} after cooldown`);
  }
  state.failures = 0;
  state.open = false;
  circuitStore.set(model, state);
}

/** Errors worth opening the circuit for: transient/upstream problems that
 *  may clear within the cooldown. Permanent config errors (401/404/400) are
 *  not recorded — they'd only reopen the circuit on every call. */
function isTransientFailure(msg: string): boolean {
  return /timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|\b429\b|rate limit|quota|5\d\d|internal|unavailable|overloaded|busy/i.test(msg);
}

// ── Call a single AI provider ──
// Retries on transient failures (5xx, 429, network errors) with exponential
// backoff. Non-retryable errors (401, 404) fail immediately.
async function callProvider(provider: { name: string; baseURL: string; model: string; apiKeyEnv: string; headers?: Record<string, string> }, opts: ChatOptions): Promise<{ choices: { message: { content: string } }[] }> {
  // Local Ollama needs no API key (its /v1 endpoint is unauthenticated).
  const apiKey = provider.name === "ollama" ? "" : process.env[provider.apiKeyEnv];
  if (!apiKey && provider.name !== "ollama") throw new Error(`No API key for ${provider.name}`);

  const MAX_RETRIES = AI_MAX_RETRIES;
  const BASE_DELAY_MS = AI_BASE_DELAY_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const body: Record<string, unknown> = {
        model: provider.model,
        messages: opts.messages,
      };
      if (opts.temperature !== undefined) body.temperature = opts.temperature;
      if (opts.max_tokens !== undefined) body.max_tokens = opts.max_tokens;
      if (opts.response_format) body.response_format = opts.response_format;

      const res = await fetch(`${provider.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.name === "ollama" ? {} : { Authorization: `Bearer ${apiKey}` }),
          ...provider.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const msg = `${provider.name} returned ${res.status}: ${text.slice(0, 200)}`;

        // Retry on 5xx and 429 (rate limiting / service unavailable)
        if (attempt < MAX_RETRIES && (res.status >= 500 || res.status === 429)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.info(`[AI] ${provider.name} returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(msg);
      }

      return res.json();
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof Error && /timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(err.message)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        logger.info(`[AI] ${provider.name} network error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`${provider.name} failed after ${MAX_RETRIES + 1} attempts`);
}

// ── Gemini Direct Vision ──
async function callGeminiDirect(imageBuffer: ArrayBuffer, prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const base64 = Buffer.from(imageBuffer).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: base64 } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini Vision returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Gemini Vision returned empty content");
  return content;
}

// ── OpenRouter Vision ──
async function callOpenRouterVision(imageBuffer: ArrayBuffer, prompt: string, model: string, timeout = 90000): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const base64 = Buffer.from(imageBuffer).toString("base64");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://menulens.app",
              "X-Title": "MenuLens",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      }],
      temperature: 0.1,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${model} returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${model} returned empty content`);
  return content;
}

// ── Exported: callGeminiVision (multi-provider fallback) ──
export async function callGeminiVision(imageBuffer: ArrayBuffer, prompt: string): Promise<string> {
  const errors: string[] = [];

  // Try OpenRouter vision models
  // OpenRouter free models share a single daily quota (50 req/day) — once
  // one model returns 429/rate-limited, the rest will too. Short-circuit to
  // avoid hammering the API with redundant requests that all fail identically.
  if (process.env.OPENROUTER_API_KEY) {
    let openRouterRateLimited = false;
    for (const model of VISION_MODELS) {
      if (openRouterRateLimited) {
        logger.warn({ message: `Vision model ${model} skipped: OpenRouter already rate-limited` });
        continue;
      }
      try {
        logger.info({ message: "Trying vision model", model });
        return await callOpenRouterVision(imageBuffer, prompt, model);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${msg}`);
        logger.warn({ message: `Vision model ${model} failed`, error: msg });
        // Detect rate-limiting (429 / quota / rate limit) — all remaining
        // OpenRouter free models share the same quota, so skip them.
        if (/429|quota|rate limit|free-models-per-day/i.test(msg)) {
          openRouterRateLimited = true;
          logger.warn({ message: "OpenRouter rate-limited, skipping remaining vision models" });
        }
      }
    }
  }

  // Try Gemini direct
  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGeminiDirect(imageBuffer, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Gemini: ${msg}`);
    }
  }

  // Try Python OCR
  try {
    logger.info({ message: "Trying Python OCR fallback" });
    const result = await pythonOCR(imageBuffer);
    if (result && result.length > 10) return result;
    throw new Error("PythonOCR result too short");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`PythonOCR: ${msg}`);
  }

  // Build final error
  const hasRateLimit = errors.some((e) => e.includes("429") || e.includes("quota") || e.includes("rate limit"));
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (hasRateLimit && !hasGemini) {
    throw new Error(
      "All AI vision models are currently rate-limited due to daily free tier limits. They reset at midnight UTC. Please try again tomorrow, or add a Gemini API key to bypass OpenRouter rate limits."
    );
  }

  if (hasRateLimit && hasGemini) {
    throw new Error(
      "All AI vision models failed. The Gemini fallback also failed — check that your Gemini API key is valid and has quota remaining. OpenRouter free models are rate-limited until midnight UTC."
    );
  }

  throw new Error(`All vision providers failed. ${errors.join("; ")}`);
}

// ── Exported: chatCompletions (multi-provider fallback) ──
export async function chatCompletions(opts: ChatOptions): Promise<{ choices: { message: { content: string } }[] }> {
  const available = providers
    .filter((p) =>
      (p.name === "ollama" ? true : !!process.env[p.apiKeyEnv]) &&
      (p.name !== "cloudflare" || !!process.env.CLOUDFLARE_ACCOUNT_ID)
    )
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) {
    throw new Error("No AI providers configured. Add at least one API key to .env.local");
  }

  let lastError: Error | null = null;

  // Short-circuit state. OpenRouter free tier is ONE shared daily quota
  // (50 req/day) across all :free models — once one model 429s, the rest of
  // that key's models will too. Skipping them avoids the previous death
  // march: 30s timeout on one provider, then 429 after 429 after 429 before
  // finally reaching a paid/other key. 404 means a dead model slug — also
  // skipped so repeated calls stop probing it (it won't come back this run).
  const rateLimitedKeys = new Set<string>();
  const deadModels = new Set<string>();

  for (const provider of available) {
    if (circuitOpen(provider.model)) {
      logger.warn(`AI provider ${provider.name} skipped: circuit open for ${provider.model}`);
      continue;
    }
    if (rateLimitedKeys.has(provider.apiKeyEnv)) {
      logger.warn(`AI provider ${provider.name} skipped: ${provider.apiKeyEnv} already rate-limited`);
      continue;
    }
    if (deadModels.has(provider.model)) {
      logger.warn(`AI provider ${provider.name} skipped: model ${provider.model} already 404'd`);
      continue;
    }
    try {
      const providerWithURL = provider.name === "cloudflare"
        ? { ...provider, baseURL: getCloudflareBaseURL() }
        : provider.name === "ollama"
          ? { ...provider, baseURL: `${process.env.OLLAMA_URL || "http://localhost:11434"}/v1` }
          : provider;
      const result = await callProvider(providerWithURL, opts);
      if (!result?.choices?.[0]?.message?.content) {
        throw new Error(`${provider.name} returned empty content`);
      }
      circuitRecordSuccess(provider.model);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;
      if (/\b429\b|rate limit|quota/i.test(msg)) {
        rateLimitedKeys.add(provider.apiKeyEnv);
      } else if (msg.includes("404")) {
        deadModels.add(provider.model);
      }
      if (isTransientFailure(msg)) {
        circuitRecordFailure(provider.model);
      }
      logger.warn(`AI provider ${provider.name} failed: ${lastError.message}`);
    }
  }

  throw new Error(`All AI providers failed. Last error: ${lastError?.message || "unknown"}`);
}

// ── Exported: callVisionOCR (for raw OCR text extraction) ──
export async function callVisionOCR(imageBuffer: ArrayBuffer, prompt: string): Promise<string> {
  return callGeminiVision(imageBuffer, prompt);
}

// ── Exported: pythonOCR (for use by OCR engine layer 3) ──
export { pythonOCR };
