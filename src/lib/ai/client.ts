/**
 * AI client — chat completion with a multi-provider fallback chain
 * (see providers.ts), vision-based OCR, and the Python OCR subprocess runner.
 */
import { logger } from "@/lib/logger";
import { providers, getCloudflareBaseURL, VISION_MODELS } from "@/lib/ai/providers";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { createHash } from "crypto";

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
    if (Date.now() - entry.ts > 300000) {
      ocrCache.delete(key);
      return null;
    }
    return entry.result;
  }
  return null;
}

function cacheSet(key: string, result: string): void {
  if (ocrCache.size >= 50) {
    const first = ocrCache.entries().next().value;
    if (first) ocrCache.delete(first[0]);
  }
  ocrCache.set(key, { result, ts: Date.now() });
}

// ── OpenRouter AI OCR (fallback) ──
async function callOCRAI(rawText: string): Promise<{ name: string; price: number | null; description: string }[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || rawText.length < 10) return null;

  logger.info("[OCRAI] Asking free model to extract dishes from raw OCR...");

  const prompt = `You are a menu OCR processor. Below is the RAW OCR text from a restaurant menu photo. Extract ONLY the actual dish items (food/drink items the restaurant sells).

Rules:
- Return ONLY a JSON array (no markdown, no explanation)
- Each item: { "name": "Dish Name", "price": 12.99|null, "description": "brief description or empty string" }
- Extract price if visible (number, no $)
- IGNORE: restaurant name, phone numbers, addresses, hours, tax/tip info, payment info, allergens, "our menu" headers, "specials" titles
- IGNORE: garbled/nonsense text lines
- If you cannot identify ANY real dishes, return empty array []
- Be honest — don't invent dishes that aren't there

RAW OCR TEXT:
"""
${rawText.slice(0, 3000)}
"""`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://menulens.app",
                "X-Title": "MenuLens",
      },
      body: JSON.stringify({
        model: "google/gemma-4-26b-a4b-it:free",
        messages: [
          { role: "system", content: "You extract dish items from menu OCR text. Return only valid JSON arrays." },
          { role: "user", content: prompt },
        ],
        temperature: 0.05,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      logger.warn(`[OCRAI] Model returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const items = JSON.parse(match[0]).filter(
      (item: { name: string }) => item.name && typeof item.name === "string" && item.name.length > 2
    );

    logger.info(`[OCRAI] Extracted ${items.length} dishes from raw OCR`);
    return items.length > 0 ? items : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[OCRAI] Failed: ${msg.slice(0, 100)}`);
    return null;
  }
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

    if (itemCount === 0 || avgConf < 35) {
      logger.info("[PythonOCR] Low quality — trying AI extraction from raw text...");
      const aiResult = await callOCRAI(result.raw_text || "");
      if (aiResult && aiResult.length > 0) {
        result.items = aiResult as { name?: string; description?: string; price?: number; category?: string; confidence?: number }[];
      }
    }

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

// ── Call a single AI provider ──
async function callProvider(provider: { name: string; baseURL: string; model: string; apiKeyEnv: string; headers?: Record<string, string> }, opts: ChatOptions): Promise<{ choices: { message: { content: string } }[] }> {
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) throw new Error(`No API key for ${provider.name}`);

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
      Authorization: `Bearer ${apiKey}`,
      ...provider.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${provider.name} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
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
  if (process.env.OPENROUTER_API_KEY) {
    for (const model of VISION_MODELS) {
      try {
        logger.info({ message: "Trying vision model", model });
        return await callOpenRouterVision(imageBuffer, prompt, model);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${msg}`);
        logger.warn({ message: `Vision model ${model} failed`, error: msg });
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

  // Try local OCR (Tesseract.js - not available in Next.js)
  try {
    logger.info({ message: "Trying local Tesseract OCR fallback" });
    throw new Error("Tesseract.js not available in Next.js context");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`LocalOCR: ${msg}`);
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
    .filter((p) => !!process.env[p.apiKeyEnv] && (p.name !== "cloudflare" || !!process.env.CLOUDFLARE_ACCOUNT_ID))
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) {
    throw new Error("No AI providers configured. Add at least one API key to .env.local");
  }

  let lastError: Error | null = null;

  for (const provider of available) {
    try {
      const providerWithURL = provider.name === "cloudflare"
        ? { ...provider, baseURL: getCloudflareBaseURL() }
        : provider;
      const result = await callProvider(providerWithURL, opts);
      if (!result?.choices?.[0]?.message?.content) {
        throw new Error(`${provider.name} returned empty content`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
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
