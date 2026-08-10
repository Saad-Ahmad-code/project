/**
 * Smart Menu Structure Analyzer — Multi-Layer OCR Extraction
 *
 * Reads a menu image via Tesseract.js and extracts structured dish data
 * by understanding the menu's visual layout and logical structure.
 *
 * Three layers of extraction, tried in order:
 *   Layer 1 — Positional (word bounding boxes → columns → blocks → dishes)
 *   Layer 2 — Sequential (blank-line paragraphs → block analysis)
 *   Layer 3 — Basic line filter (fallback for garbled OCR)
 *
 * Post-processing applies to all layers: name cleanup, OCR correction,
 * adaptive confidence thresholding, cross-validation.
 */

import Tesseract from "tesseract.js";
import { createHash } from "crypto";
import { cleanOCRText } from "./cleaner";
import { cleanTextWithOllama, ollamaVisionOCR, parseDishArray, refineWithOllama } from "./ollama";
import { splitMergedItemsFallback } from "./merged-split";
import { parseResultData, crossValidate, paragraphAwareParse, smartParse, sequentialParse, basicExtract } from "./parsing";
import { rejectJunkDish } from "./validation";
import { tryRapidOCR, tryTesseractOnBuffer, getBestResult, pickByParseQuality, menuOCRRescue, estimateSkewDegrees, OCRCandidate } from "./candidates";

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export type { LocalOCRItem } from "./parsing";
import type { LocalOCRItem } from "./parsing";

interface WordPos {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — with Sharp preprocessing + multi-PSM
// ═══════════════════════════════════════════════════════════════════

// ── Result cache (image-hash keyed) ──
// Scanning the same image twice (retry, re-upload, identical test corpus
// image) is pure waste: every run costs multi-reader OCR + possibly two
// Ollama calls. Cache the final result for a short TTL so identical bytes
// resolve instantly. 60 entries ≈ 60 distinct menu photos in a 10-minute
// window — ample for a single-user dev box and most prod sessions.
const OCR_RESULT_CACHE = new Map<string, { result: { raw_text: string; items: LocalOCRItem[] }; ts: number }>();
const OCR_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const OCR_RESULT_CACHE_MAX = 60;

function ocrCacheGet(hash: string): { raw_text: string; items: LocalOCRItem[] } | null {
  const entry = OCR_RESULT_CACHE.get(hash);
  if (entry && Date.now() - entry.ts < OCR_RESULT_CACHE_TTL_MS) return entry.result;
  if (entry) OCR_RESULT_CACHE.delete(hash);
  return null;
}

function ocrCacheSet(hash: string, result: { raw_text: string; items: LocalOCRItem[] }): void {
  if (OCR_RESULT_CACHE.size >= OCR_RESULT_CACHE_MAX) {
    const first = OCR_RESULT_CACHE.entries().next().value;
    if (first) OCR_RESULT_CACHE.delete(first[0]);
  }
  OCR_RESULT_CACHE.set(hash, { result, ts: Date.now() });
}

export async function runLocalOCR(
  file: File
): Promise<{ raw_text: string; items: LocalOCRItem[] }> {
  let resultData: any;
  let inputBuffer: Buffer | null = null;
  let hash = "";

  try {
    inputBuffer = Buffer.isBuffer(file as unknown)
      ? (file as unknown as Buffer)
      : Buffer.from(await (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());

    // Identical bytes → cached result (no re-OCR, no Ollama calls).
    hash = createHash("sha256").update(inputBuffer).digest("hex").slice(0, 32);
    const cached = ocrCacheGet(hash);
    if (cached) return cached;

    try {
      const sharp = eval('require')('sharp');
      // NOTE: normalize()+sharpen() were measured ~8x SLOWER in Tesseract
      // (10s vs 1.2s per PSM on the same image) with no corpus-quality gain —
      // high-contrast sharpened input makes the LSTM segment far harder.
      // Grayscale + resize keeps ~full quality at ~1/8th the cost; the
      // meanLum<60 boosted path below handles genuinely dark images.
      const preprocessed = await sharp(inputBuffer)
        .grayscale()
        .resize({ width: 2048, withoutEnlargement: true })
        .toBuffer();
      const meanLum = (await sharp(preprocessed).stats()).channels[0].mean;

      const psmModes = [6, 4, 11];
      const results: Array<OCRCandidate | null> = [];

      const rapid = await tryRapidOCR(inputBuffer);
      const skewDeg = estimateSkewDegrees(rapid?.data?.rawLines);
      let deskewedCount = 0;

      if (skewDeg !== 0) {
        const deskewedPrep = await sharp(preprocessed)
          .rotate(skewDeg, { background: { r: 255, g: 255, b: 255 } })
          .toBuffer();
        const deskewedRaw = await sharp(inputBuffer)
          .rotate(skewDeg, { background: { r: 255, g: 255, b: 255 } })
          .toBuffer();
        if (Math.abs(skewDeg) >= 2.5) deskewedCount = 4;
        // All 6 Tesseract runs in parallel (they were sequential before).
        const [d6, d4, d11, s6, s4, s11] = await Promise.all([
          tryTesseractOnBuffer(deskewedPrep, 6),
          tryTesseractOnBuffer(deskewedPrep, 4),
          tryTesseractOnBuffer(deskewedPrep, 11),
          tryTesseractOnBuffer(preprocessed, 6),
          tryTesseractOnBuffer(preprocessed, 4),
          tryTesseractOnBuffer(preprocessed, 11),
        ]);
        results.push(await tryRapidOCR(deskewedRaw), d6, d4, d11, rapid, s6, s4, s11);
      } else {
        // RapidOCR first (needed for skew), then all 3 PSM modes in parallel.
        const [t6, t4, t11] = await Promise.all(psmModes.map((psm) => tryTesseractOnBuffer(preprocessed, psm)));
        results.push(rapid, t6, t4, t11);
      }

      if (meanLum < 60) {
        const boosted = await sharp(preprocessed)
          .modulate({ brightness: 1.7 })
          .toBuffer();
        results.push(...(await Promise.all(psmModes.map((psm) => tryTesseractOnBuffer(boosted, psm)))));
      }

      const fastWinner = pickByParseQuality(getBestResult(results, deskewedCount), results);
      resultData = await menuOCRRescue(inputBuffer, fastWinner, results, deskewedCount);
    } catch (e) {
      const psmModes = [6, 4, 11];
      const results = await Promise.all([
        tryRapidOCR(inputBuffer!),
        ...psmModes.map(psm => tryTesseractOnBuffer(inputBuffer!, psm)),
      ]);
      resultData = getBestResult(results);
    }
  } catch (e) {
    // Last resort: plain Tesseract on the raw file.
    const result = await Tesseract.recognize(file, "eng", {
      logger: () => {},
    });
    resultData = result.data;
  }

  const raw_text = resultData.text || "";
  const rawWords: any[] = resultData.words || [];

  const cleaned = cleanOCRText(raw_text);
  let parseText = cleaned.text;
  // Ollama clean is expensive — only run it when the text shows real
  // OCR-garbage signals (low letter ratio / lots of short fragments).
  if (process.env.OLLAMA_CLEAN !== "0" && needsOllamaClean(parseText)) {
    parseText = await cleanTextWithOllama(parseText);
  }

  const words: WordPos[] = rawWords
    .filter((w: any) => (w.confidence ?? 0) >= 10)
    .map((w: any) => ({
      text: w.text || "",
      x: w.bbox?.x0 ?? 0,
      y: w.bbox?.y0 ?? 0,
      w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
      h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
      confidence: w.confidence ?? 0,
    }));

  let items: LocalOCRItem[];

  items = parseResultData(resultData);

  items = crossValidate(items);

  // Ollama refine is the single most expensive step (~15-21s warm). The
  // deterministic parsers are already strong — only spend the call when the
  // parse looks weak (<3 dishes or <2 priced), i.e. when the model could
  // genuinely add value (split merged rows / fix garbled names). Clean
  // menus skip it entirely.
  if (process.env.OLLAMA_REFINE !== "0" && needsOllamaRefine(items)) {
    try {
      const refined = await refineWithOllama(parseText, items);
      if (refined !== items) {
        items = refined;
      }
    } catch {
      // refineWithOllama never throws by design; belt-and-braces.
    }
  }

  items = splitMergedItemsFallback(items);

  // Final junk gate AFTER merging: rejects venue taglines, K-price leftovers,
  // fused-price remnants, junk suffixes — garbage the parsers let through.
  // Runs post-split so legit fused rows ("Buffalo Wings $10.50 Mozzarella
  // Sticks $4.00") split into clean items BEFORE the gate sees them.
  items = items.filter((i) => !rejectJunkDish(i.name));

  if (items.length === 0 && process.env.OLLAMA_VISION !== "0" && inputBuffer) {
    try {
      const vis = await ollamaVisionOCR(inputBuffer);
      if (vis && vis.alphaWordCount >= 3) {
        const visText = vis.data.text.trim();
        if (visText.startsWith("[")) {
          const parsedItems = parseDishArray(visText, visText);
          if (parsedItems.length > 0) {
            items = parsedItems;
          }
        } else {
          const visClean = cleanOCRText(visText);
          const visItems = sequentialParse(visClean.text);
          const visRefined =
            process.env.OLLAMA_REFINE !== "0"
              ? await refineWithOllama(visClean.text, visItems)
              : visItems;
          if (visRefined !== visItems) {
            items = visRefined;
          } else {
            items = splitMergedItemsFallback(visItems);
          }
        }
      }
    } catch {
      // Vision rescue never throws; belt-and-braces.
    }
  }

  const result = { raw_text, items: items.slice(0, 50) };
  if (hash) ocrCacheSet(hash, result);
  return result;
}

/** True when OCR text shows enough REAL garbage to justify the Ollama clean
 *  call: many ≤2-char fragments or many non-letter words (pure numbers,
 *  symbols). Addresses/phone numbers ("123 Main Street") do NOT trigger it —
 *  they're dropped by cleaner.ts anyway and don't need an LLM round-trip. */
function needsOllamaClean(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false; // tiny menus: not worth an LLM call
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 8) return false; // too few words to judge
  const shortWords = words.filter((w) => w.length <= 2).length;
  const nonAlphaWords = words.filter((w) => !/[A-Za-z]/.test(w)).length;
  // Real OCR noise: lots of 1-2 char fragments OR lots of pure-number/symbol
  // tokens. Normal menus with an address line have neither.
  return shortWords / words.length > 0.4 || nonAlphaWords / words.length > 0.25;
}

/** True when the deterministic parse is weak enough to justify the expensive
 *  Ollama refine (~15-21s). Same "good enough" bar menuOCRRescue uses:
 *  ≥3 dishes with ≥2 priced means the reader+parsers did their job. */
function needsOllamaRefine(items: LocalOCRItem[]): boolean {
  const priced = items.filter((i) => i.price !== undefined).length;
  return items.length < 3 || priced < 2;
}

// ═══════════════════════════════════════════════════════════════════
//  OFFLINE OCR PIPELINE
// ═══════════════════════════════════════════════════════════════════

export interface OfflineOCRResult {
  items: LocalOCRItem[];
  raw_text: string;
  layer: string;
  confidence: number;
  menu_name?: string;
}

export async function runOfflineOCRPipeline(
  arrayBuffer: ArrayBuffer,
  send?: (event: string, data: Record<string, unknown>) => void
): Promise<OfflineOCRResult> {
  send?.("status", { status: "ocr_started", progress: 10, message: "Running local OCR…" });
  const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
  const file = new File([blob], "menu.jpg", { type: "image/jpeg" });
  const result = await runLocalOCR(file);
  send?.("status", {
    status: "ocr_complete",
    progress: 50,
    message: `Found ${result.items.length} items via offline`,
    layer: "offline",
    confidence: 85,
  });
  return {
    items: result.items,
    raw_text: result.raw_text,
    layer: "offline",
    confidence: 85,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  RE-EXPORTS FROM SUB-MODULES
// ═══════════════════════════════════════════════════════════════════

export { isNoiseLine } from "./validation";
export { CATEGORY_KEYWORDS } from "./data/category-keywords";
export { correctOCRErrors, OCR_CORRECTIONS } from "./data/ocr-corrections";
export { normalizePrice, findPriceInText, findPriceInWord, countPriceLines } from "./price";
export type { PriceResult } from "./price";
export { cleanDishName } from "./name-cleanup";
export { detectColumns, isCentered } from "./columns";
export { splitMergedDishLine, splitMergedItemsFallback, DISH_PREFIX_WORDS, splitMultiPriceRow } from "./merged-split";
export { hasSufficientRealWords, isFoodRelated, isHeaderLike, isDescriptionLine, nameTableEntry, classifyMenu, classifyMenuText, computeConfidence, dynamicThreshold, guessCategory } from "./validation";
export { parseColumn, groupIntoLines, smartParse, sequentialParse, basicExtract, paragraphAwareParse, extractParagraphs, parseResultData, crossValidate } from "./parsing";
export { tryRapidOCR, tryMenuOCR, tryTesseractOnBuffer, getBestResult, pickByParseQuality, menuOCRRescue, estimateSkewDegrees, resolvePythonCmd, runPythonScript, RAPIDOCR_SCRIPT, MENU_OCR_SCRIPT } from "./candidates";
export type { OCRCandidate } from "./candidates";