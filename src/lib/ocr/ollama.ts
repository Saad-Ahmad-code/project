// ═══════════════════════════════════════════════════════════════════
//  OLLAMA REFINEMENT LAYER — optional LLM cleanup of OCR output
//
//  The deterministic parsers in local.ts extract dishes from raw OCR
//  text. When Ollama is running (local or cloud models, default
//  http://localhost:11434), this module asks a model to re-read the raw
//  text and emit a clean structured dish list — it fixes garbled names,
//  recovers items the line parsers swallowed, and assigns categories.
//
//  Design rules:
//   - FAILS SOFT. Every failure path returns the input unchanged. A dead
//     Ollama, a timeout, a 400, or a nonsense response never degrades the
//     deterministic parse.
//   - ACCEPT GATE. The model's list replaces the deterministic one only
//     when it has AT LEAST as many priced items AND every name passes the
//     same real-word gate the parsers use. No gate, no replacement.
//   - NO SECRETS. The model URL/model come from env (OLLAMA_URL,
//     OLLAMA_MODEL) with sane defaults; nothing is logged.
//
//  Enabled in runLocalOCR unless OLLAMA_REFINE=0.
// ═══════════════════════════════════════════════════════════════════

import { isNoiseLine } from "./validation";
import { CATEGORY_KEYWORDS } from "./data/category-keywords";
import type { LocalOCRItem } from "./parsing";
import { OLLAMA_TIMEOUT_MS, MAX_RAW_TEXT } from "@/lib/config";

export interface OllamaRefineOptions {
  url?: string;
  model?: string;
  timeoutMs?: number;
}

export interface OllamaVisionResult {
   data: { text: string; words: string[] };
   wordCount: number;
   alphaWordCount: number;
   avgConf: number;
 }

const DEFAULT_URL = "http://localhost:11434";
/** Local refine brain — benchmarked 2026-08: gemma4:e2b matches the cloud
 *  model's output (perfect names/prices/categories + merged-row splitting)
 *  while running fully offline. Override with OLLAMA_MODEL (e.g. the cloud
 *  gpt-oss:120b-cloud). */
const DEFAULT_MODEL = "gemma4:e2b";
/** Free local vision model used for direct image OCR (read the menu photo). */
const DEFAULT_VISION_MODEL = "qwen2.5vl:3b";
/** Local models are slower than cloud (gemma4 refine ≈15-21s warm); the
 *  reachability probe keeps the dead-server case at ~2s, so the generous
 *  cap only bites on a genuinely hung generation. */
const DEFAULT_TIMEOUT_MS = OLLAMA_TIMEOUT_MS;

/** Mirror of the parser gate: ≥60% of words must have 3+ consecutive letters. */
function hasSufficientRealWords(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const real = words.filter((w) => /[a-zA-Z]{3,}/.test(w)).length;
  return real / words.length >= 0.6 && /[a-zA-Z]{3,}/.test(name);
}

/** Levenshtein distance — small strings only (menu words are short). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * No-invented-dishes gate: a candidate name is only accepted when ALL of
 * its words actually appear in the raw OCR text (allowing OCR-error fixes:
 * "Sandw1ch" matches "Sandwich" within edit distance 1). A hallucinating
 * model cannot inject names that were never on the menu. Every word must
 * be grounded — a 50% threshold let junk like "Hot Special" through when
 * one common word happened to be in the text.
 */
function nameGroundedInRaw(name: string, rawText: string): boolean {
  const rawWords = new Set(
    rawText
      .toLowerCase()
      .split(/[^a-z0-9&']+/i)
      .filter((w) => w.length >= 3)
  );
  const words = name.toLowerCase().split(/[^a-z0-9&']+/i).filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  let matched = 0;
  for (const w of words) {
    if (rawWords.has(w)) {
      matched++;
      continue;
    }
    for (const rw of rawWords) {
      if (Math.abs(rw.length - w.length) <= 1 && editDistance(rw, w) <= 1) {
        matched++;
        break;
      }
    }
  }
  return matched === words.length && matched >= 1;
}

/** Normalized name key for matching: lowercase, alnum words only. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Fuzzy name match used by the no-regression gate: true when `b` plausibly
 * IS `a` (OCR-error tolerant). Exact normalized equality, single-word
 * containment, or every word of the shorter name matching a word of the
 * longer within edit distance 1.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = na.split(" "), wb = nb.split(" ");
  if (wa.length === 1 || wb.length === 1) {
    const [single, multi] = wa.length === 1 ? [wa[0], wb] : [wb[0], wa];
    return multi.some(
      (w) => w === single || (Math.abs(w.length - single.length) <= 1 && editDistance(w, single) <= 1)
    );
  }
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.every(
    (w) => long.some((lw) => lw === w || (Math.abs(lw.length - w.length) <= 1 && editDistance(lw, w) <= 1))
  );
}

/**
 * A model entry is only a dish when its name is not a section header, venue
 * title, or operational noise line (TACOS, Casa Taquería, "Order Online").
 */
function isJunkDishName(name: string): boolean {
  const n = normName(name);
  if (!n) return true;
  if (CATEGORY_KEYWORDS.has(n)) return true;
  return isNoiseLine(name);
}

/**
 * Extract the first JSON array from the model's response. Models wrap the
 * array in prose or code fences; we take the outermost [...] block.
 */
export function parseDishArray(text: string, rawText = ""): LocalOCRItem[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: LocalOCRItem[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || !hasSufficientRealWords(name)) continue;
    // Reject names that are not dishes: section headers, venue titles,
    // operational noise ("Order Online", "Hours"), etc. A 5B local model
    // happily emits these as dishes when the OCR text is noisy.
    if (isJunkDishName(name)) continue;
    // No-invented-dishes gate: with raw text available, reject names that
    // are not grounded in it (a hallucinating model invents dishes that
    // were never on the menu). OCR-error fixes still pass (edit ≤1).
    if (rawText && !nameGroundedInRaw(name, rawText)) continue;

    let price: number | undefined;
    if (typeof r.price === "number" && Number.isFinite(r.price)) {
      price = r.price;
    } else if (typeof r.price === "string") {
      const p = r.price.trim().replace(/,/g, "");
      if (/^\d+(?:\.\d{1,2})?$/.test(p)) price = parseFloat(p);
    }
    // Unpriced entries are acceptable — single-word dishes like "Margherita"
    // legitimately carry no price. The grounding gate + junk-name gate above
    // already block venue titles/headers/hallucinations.

    const category =
      typeof r.category === "string" && r.category.trim() ? r.category.trim() : undefined;

    out.push({
      name: name.slice(0, 200),
      ...(price !== undefined ? { price } : {}),
      ...(category ? { category } : {}),
    });
  }
  return out;
}

/**
 * Ask Ollama's free local vision model to read a menu IMAGE directly
 * (true OCR: image in, text out). Shaped like a Tesseract candidate so
 * getBestResult and the parser pipeline consume it unchanged — text only,
 * no word boxes (vision models return plain text; positional parsing
 * simply falls through to the sequential parser).
 *
 * Returns null on any failure (no Ollama, model missing, timeout) — never
 * throws, so the candidate pool treats it as an unavailable engine.
 */
export async function ollamaVisionOCR(
  buffer: Buffer,
  opts: OllamaRefineOptions = {}
): Promise<OllamaVisionResult | null> {
  // Harness determinism: OLLAMA_VISION=0 removes the vision candidate from
  // the pool entirely (a live model would otherwise make every scan
  // non-deterministic and slow). The app leaves it enabled.
  if (process.env.OLLAMA_VISION === "0") return null;
  const url = opts.url ?? process.env.OLLAMA_URL ?? DEFAULT_URL;
  const model = opts.model ?? process.env.OLLAMA_VISION_MODEL ?? DEFAULT_VISION_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const probe = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!probe.ok) return null;
    // Cheap pre-flight: is this model actually installed? Pulling a missing
    // model mid-scan would block on a multi-GB download.
    const tags = (await probe.json()) as { models?: Array<{ name: string }> };
    const installed = (tags.models ?? []).some(
      (m) => m.name === model || m.name.startsWith(`${model}:`)
    );
    if (!installed) return null;
  } catch {
    return null;
  }

  const b64 = buffer.toString("base64");
  const prompt =
    "Please analyze this restaurant menu image. Extract all the food items, their prices, and any additional details such as descriptions or categories. Present the results in JSON format."

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        prompt,
        images: [b64],
        stream: false,
        options: { temperature: 0.0, num_predict: 2000 },
      }),
    });
    if (!res.ok) return null;

    const out = (await res.json()) as { response?: string };
    const text = (out.response ?? "").trim();
    if (!text) return null;

    const words = text.split(/\s+/).filter((w) => w.length > 2);
    const alphaWords = words.filter((w) => /[a-zA-Z]{3,}/.test(w)).length;
    return {
      data: { text, words: [] },
      wordCount: words.length,
      alphaWordCount: alphaWords,
      // Deliberately below RapidOCR (~99) so ties go to RapidOCR — the
      // proven best analyzer on this corpus. The vision model wins only
      // when it parses to MORE priced items (pickByParseQuality), i.e.
      // when it genuinely read the menu better.
      avgConf: 90,
    };
  } catch {
    return null;
  }
}

/**
 * Ask Ollama to clean OCR-extracted text — fix broken words, normalize
 * whitespace, merge fragmented lines, remove stray characters. Returns
 * plain text (not structured JSON). Fail-soft: returns input unchanged
 * on any failure.
 *
 * Enabled unless OLLAMA_CLEAN=0 (the regression harness sets this for
 * determinism). Chunks input when it exceeds MAX_RAW_TEXT; menu text is
 * line-oriented so chunk boundaries at newlines are safe.
 */
export async function cleanTextWithOllama(
  text: string,
  opts: OllamaRefineOptions = {}
): Promise<string> {
  if (process.env.OLLAMA_CLEAN === "0") return text;

  const url = opts.url ?? process.env.OLLAMA_URL ?? DEFAULT_URL;
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Reachability probe — same fail-fast pattern as refineWithOllama
  try {
    const probe = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!probe.ok) return text;
  } catch {
    return text;
  }

  // Chunk by newline when text exceeds the cap — menus are line-oriented
  // so chunk boundaries are safe.
  const chunks = text.length > MAX_RAW_TEXT
    ? text.split("\n").reduce<string[]>((acc, line) => {
        const last = acc[acc.length - 1];
        if (!last) { acc.push(line); return acc; }
        if ((last + "\n" + line).length <= MAX_RAW_TEXT) {
          acc[acc.length - 1] = last + "\n" + line;
        } else {
          acc.push(line);
        }
        return acc;
      }, [])
    : [text];

  const cleanedChunks: string[] = [];
  for (const chunk of chunks) {
    const prompt = `You are a careful text restorer. The input is OCR-extracted text from a restaurant menu. Fix OCR artifacts: join words broken across lines, remove stray characters, normalize whitespace, merge fragmented lines, but DO NOT invent or delete menu content. Return only the cleaned text.

Input text:
${chunk}`;

    try {
      const res = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.0, num_predict: Math.min(4000, chunk.length / 2) },
        }),
      });
      if (!res.ok) { cleanedChunks.push(chunk); continue; }
      const out = (await res.json()) as { response?: string };
      const cleaned = (out.response ?? "").trim();
      cleanedChunks.push(cleaned || chunk);
    } catch {
      cleanedChunks.push(chunk);
    }
  }

  return cleanedChunks.join("\n");
}

/**
 * Ask Ollama to turn raw OCR text into a clean dish list. Returns the
 * deterministic `items` unchanged on any failure or when the model's list
 * is not at least as complete (priced-item count).
 */
export async function refineWithOllama(
  rawText: string,
  items: LocalOCRItem[],
  opts: OllamaRefineOptions = {}
): Promise<LocalOCRItem[]> {
  const url = opts.url ?? process.env.OLLAMA_URL ?? DEFAULT_URL;
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Reachability probe: a running server answers /api/tags in milliseconds;
  // a dead one refuses the connection instantly. This keeps the no-Ollama
  // cost at ~10-50ms per scan instead of a full timeout.
  try {
    const probe = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!probe.ok) return items;
  } catch {
    return items;
  }

  const pricedCount = items.filter((i) => i.price !== undefined).length;
  const prompt = `You are a strict, lossless menu parser. Convert the raw OCR text below into a JSON array of dishes. Follow every rule — none are optional.

HARD RULES:
1. COMPLETENESS: Every dish with a price in the text MUST appear in the output. Never drop, merge, or skip an item.
2. NO INVENTION: Never add a dish, name, word, price, or category that is not present in the text. If a name is garbled ("Pulled Pork Sandw1ch"), fix ONLY the OCR error — never expand, decorate, translate, or "improve" the name.
3. PRICE FIDELITY: "price" is a number in USD with the EXACT decimal places shown: "$6.00" → 6.00, "$12.50" → 12.50, "77" → 77. Never drop or add a decimal point, never multiply or divide, never round. If no price is visible, omit "price" — never invent one.
4. CATEGORY FIDELITY: "category" is the EXACT section header text above the dish, case preserved ("APPETIZERS", "Desserts"). Omit it when there is no header. Never invent a header.
5. SPLIT MERGED ROWS: One line containing two dishes ("ICE MILK 77 BEAN", "Smoked Brisket $18.50 Pulled Pork Sandwich $14.00") becomes SEPARATE entries, each with its own name and price. Never combine two dishes into one entry.
6. IGNORE venue title and subtitle lines (restaurant name, "Est. 2011", address lines) — do not emit them as dishes.
7. EXACT OUTPUT CONTRACT: Respond with ONLY the JSON array. No prose, no explanations, no markdown code fences, no trailing text. The first character of your response is "[" and the last character is "]".

JSON schema — one object per dish:
[{"name": "<dish name, OCR errors fixed>", "price": <number, or omit the field>, "category": "<exact header, or omit the field>"}]

Raw OCR text:
${rawText.slice(0, MAX_RAW_TEXT)}`;

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.0, num_predict: 2000 },
      }),
    });
    if (!res.ok) return items;

    const out = (await res.json()) as { response?: string };
    const cleaned = parseDishArray(out.response ?? "", rawText);
    if (cleaned.length === 0) return items;
    if (cleaned.filter((i) => i.price !== undefined).length < pricedCount) return items;

    // No-regression gate: EVERY PRICED dish the deterministic parsers found
    // must survive in the model's list (fuzzy name match, OCR-error tolerant).
    // A model that dropped a real priced dish or rewrote it into random words
    // loses — keep the deterministic parse. Unpriced dishes are exempt (the
    // model may legitimately omit a price-less item). This is what stops
    // "random words as dish": the model can only ADD split rows and FIX
    // names, never replace the known-good priced set.
    const pricedItems = items.filter((it) => it.price !== undefined);
    if (!pricedItems.every((it) => cleaned.some((c) => namesMatch(it.name, c.name)))) return items;

    return cleaned;
  } catch {
    return items;
  }
}
