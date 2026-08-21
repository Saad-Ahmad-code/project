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
import { logger } from "@/lib/logger";
import { cleanOCRText } from "./cleaner";
import { cleanTextWithOllama, ollamaVisionOCR, parseDishArray, refineWithOllama } from "./ollama";
import { splitMergedItemsFallback } from "./merged-split";
import { parseResultData, crossValidate, paragraphAwareParse, smartParse, sequentialParse, basicExtract } from "./parsing";
import { rejectJunkDish, hasSufficientRealWords } from "./validation";
import { tryRapidOCR, tryTesseractOnBuffer, getBestResult, pickByParseQuality, menuOCRRescue, estimateSkewDegrees, OCRCandidate } from "./candidates";
import { CURRENCY_SYMBOLS, normalizePrice, findPriceInText } from "./price";
import { cleanDishName } from "./name-cleanup";

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════

export type { LocalOCRItem } from "./parsing";
import type { LocalOCRItem } from "./parsing";
import { getCache, setCache } from "./persistentCache";
import { ocrSuccess, ocrFailure } from "./metrics";
import fs from "fs";

interface WordPos {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

/**
 * Cross-candidate price recovery + missing item rescue.
 *
 * When the winning candidate produces garbled text (e.g. "Fruit Salad 0012"
 * where the ₹ symbol was dropped and digits scrambled), but a sibling candidate
 * (e.g. brightness-boosted) read the same line as "Fruit Salad 100" (symbol
 * dropped but digits intact), this function cross-references all candidate outputs:
 *
 * Phase 1 — Price fixup: for items whose price is garbled by き-fusion
 *   (e.g. "き50"→"250", "き100"→"0012", "き90"→"092"), adopt the price from
 *   another candidate's reading of the same dish. Uses majority vote across
 *   all candidates — the most commonly read price wins.
 *
 * Phase 2 — Missing item rescue: for dishes that were dropped entirely by
 *   the winner's parser (e.g. cleaner.ts dropped a line as noise, or the
 *   positional parser couldn't place it), re-add them from sibling candidates
 *   that read them with a valid price.
 *
 * Both currency-symbol prices (き→₹, g→₹, Z→₹) and digit-only prices are
 * trusted — digit-only prices from Tesseract are often correct when the き
 * glyph is simply dropped (not fused) with the digits intact.
 *
 * Name matching is fuzzy (edit-distance ≤1 per word) so garbled variants
 * like "oy Fruit Salad" still match "Fruit Salad".
 */
function crossCandidatePriceRecovery(
  items: LocalOCRItem[],
  candidates: Array<OCRCandidate | null>
): LocalOCRItem[] {
  if (items.length === 0) return items;

  const normName = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  // Fuzzy name match: word-by-word edit-distance ≤1 on normal length,
  // exact match on short words. Handles OCR noise like "oy" → "" or
  // "Vik" → "" prefix garbling that affects single-word names.
  const namesMatch = (a: string, b: string): boolean => {
    const na = normName(a), nb = normName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const wa = na.split(" "), wb = nb.split(" ");
    if (wa.length === 0 || wb.length === 0) return false;
    // If either side is a single word, match against any word in the other
    if (wa.length === 1 || wb.length === 1) {
      const [single, multi] = wa.length === 1 ? [wa[0], wb] : [wb[0], wa];
      return multi.some(
        (w) => w === single || (Math.abs(w.length - single.length) <= 1 &&
          editDistance(w, single) <= 1)
      );
    }
    // Both multi-word: match each short side word against any long side word
    const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    return short.every(
      (w) => long.some((lw) => lw === w || (Math.abs(lw.length - w.length) <= 1 &&
        editDistance(lw, w) <= 1))
    );
  };

  // Track whether each candidate price came from a currency-symbol reading
  // (strategy a, more trustworthy) vs digit-only (strategy b, less so).
  interface CandidatePrice {
    name: string;
    price: number;
    hasSymbol: boolean;  // true if a currency symbol/glyph was present
  }
  const candidateItems: Array<CandidatePrice[]> = [];
  for (const c of candidates) {
    if (!c?.data?.text) continue;
    const cleanResult = cleanOCRText(c.data.text);
    // Combine classified lines + dropped lines + raw text — dropped lines
    // may carry digit-only or currency prices the classifier rejected as noise.
    const allRawLines = [
      ...cleanResult.lines.map(l => l.text),
      ...cleanResult.dropped,
    ];
    // Also include lines from the raw cleaned text (catches anything the
    // line-by-line classification missed, e.g. mid-line junk splits).
    const cleanedTextLines = cleanResult.text.split(/\n/).map(l => l.trim()).filter(Boolean);
    const allLines = [...new Set([...allRawLines, ...cleanedTextLines])];
    const priceLines: CandidatePrice[] = [];
    for (const lineText of allLines) {
      // (a) Currency-symbol price: "Dish ₹200"
      const m = lineText.match(new RegExp(`([${CURRENCY_SYMBOLS}])\\s*(\\d{1,4}(?:[.,]\\d{1,2})?)`));
      if (m) {
        const price = normalizePrice(m[0]);
        if (price !== null && price >= 5 && price < 2000) {
          const symIdx = lineText.indexOf(m[1]);
          const namePart = lineText.slice(0, symIdx).trim();
          if (namePart && /[a-zA-Z]/.test(namePart)) {
            const cleanName = cleanDishName(namePart.split(/[^a-zA-Z]+/).filter(Boolean).join(" "));
            if (cleanName.length >= 3 && hasSufficientRealWords(cleanName)) {
              priceLines.push({ name: cleanName, price, hasSymbol: true });
            }
          }
        }
      } else {
        // (b) Digit-only price (currency glyph dropped but digits intact):
        // "Dish 100" or "Dish 60 p : >" (trailing OCR junk after the price).
        // Strip trailing non-digit junk, then use findPriceInText.
        const trimmedLine = lineText.replace(/[^\d\s.₹]*$/g, "").trim();
        const priceResult = findPriceInText(trimmedLine);
        if (priceResult !== null && priceResult.price >= 5 && priceResult.price < 2000) {
          const namePart = lineText.slice(0, lineText.indexOf(priceResult.raw)).trim();
          if (namePart && /[a-zA-Z]{3,}/.test(namePart)) {
            const cleanName = cleanDishName(namePart.split(/[^a-zA-Z]+/).filter(Boolean).join(" "));
            if (cleanName.length >= 3 && hasSufficientRealWords(cleanName)) {
              priceLines.push({ name: cleanName, price: priceResult.price, hasSymbol: false });
            }
          }
        }
      }
    }
    candidateItems.push(priceLines);
  }

  if (candidateItems.length === 0) return items;

  let changed = false;

  // Phase 1: Fix garbled prices on existing items.
  // When き fuses with digits, the resulting number is often wrong (e.g.
  // "き50"→"250", "き100"→"0012", "き90"→"092"). The winner's price is garbled
  // but a sibling candidate may have read the same dish with a correct price
  // (either with a currency symbol, or with the right digits).
  // Priority: currency-symbol prices > digit-only prices > current item price.
  for (const item of items) {
    // Collect all prices for this dish across all candidates
    const symbolPrices: number[] = [];
    const digitPrices: number[] = [];
    for (const candItems of candidateItems) {
      for (const cand of candItems) {
        if (namesMatch(item.name, cand.name)) {
          if (cand.hasSymbol) {
            symbolPrices.push(cand.price);
          } else {
            digitPrices.push(cand.price);
          }
        }
      }
    }
    if (symbolPrices.length === 0 && digitPrices.length === 0) continue;
    // Prefer currency-symbol prices — they're more trustworthy
    const allPriced = symbolPrices.length > 0 ? symbolPrices : digitPrices;
    // Find most common price (mode)
    const priceCounts = new Map<number, number>();
    for (const p of allPriced) {
      priceCounts.set(p, (priceCounts.get(p) || 0) + 1);
    }
    let bestPrice = allPriced[0];
    let bestCount = 1;
    for (const [price, count] of priceCounts) {
      if (count > bestCount) {
        bestPrice = price;
        bestCount = count;
      }
    }
    // Adopt the recovered price if it differs from the current one
    if (bestPrice !== item.price) {
      item.price = bestPrice;
      changed = true;
    }
  }

  // Phase 2: Recover missing items
  const existingNames = new Set(items.map((i) => normName(i.name)));
  const newItems: LocalOCRItem[] = [];
  for (const candItems of candidateItems) {
    for (const cand of candItems) {
      const candNorm = normName(cand.name);
      if (existingNames.has(candNorm)) continue;
      const alreadyPresent = items.some((i) => namesMatch(i.name, cand.name));
      if (alreadyPresent) continue;
      if (cand.price >= 5) {
        // Infer category from the item name if we have enough context
        const categoryMatch = items.find((i) => namesMatch(i.name, cand.name));
        newItems.push({
          name: cand.name,
          price: cand.price,
          category: categoryMatch?.category,
        });
        changed = true;
      }
    }
  }

  if (newItems.length > 0) {
    items.push(...newItems);
  }

  return items;
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
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

// ═══════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — with Sharp preprocessing + multi-PSM
// ═══════════════════════════════════════════════════════════════════

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

async function ocrCacheGet(hash: string): Promise<{ raw_text: string; items: LocalOCRItem[] } | null> {
  const cached = await getCache(hash);
  return cached || null;
}

async function ocrCacheSet(hash: string, result: { raw_text: string; items: LocalOCRItem[] }): Promise<void> {
  await setCache(hash, result);
}

export async function runLocalOCR(
  file: File
): Promise<{ raw_text: string; items: LocalOCRItem[] }> {
  let resultData: any;
  let inputBuffer: Buffer | null = null;
  let hash = "";
  let candidateResults: Array<OCRCandidate | null> = [];
  // Ollama vision call, started early inside the try below and awaited at the
  // merge point after it — runs concurrently with the deterministic pipeline.
  let visionPromise: ReturnType<typeof ollamaVisionOCR> | null = null;

  try {
    inputBuffer = Buffer.isBuffer(file as unknown)
      ? (file as unknown as Buffer)
      : Buffer.from(await (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());

    // Identical bytes → cached result (no re-OCR, no Ollama calls).
    hash = createHash("sha256").update(inputBuffer).digest("hex").slice(0, 32);
    const cached = await ocrCacheGet(hash);
    if (cached) return cached;

    // Kick off Ollama vision IMMEDIATELY — it reads the raw image directly
    // and doesn't depend on any deterministic work below, so run it
    // concurrently with the Tesseract/clean/parse pipeline. Awaited at the
    // merge point near the end of this function.
    visionPromise =
      process.env.OLLAMA_VISION !== "0"
        ? ollamaVisionOCR(inputBuffer).catch((e: unknown) => {
            logger.warn(`[OCR] Vision error: ${e}`);
            return null;
          })
        : null;

    try {
      const sharp = await loadSharp();
      if (!sharp) {
        const psmModes = [6, 4, 11];
        const results = await Promise.all([
          tryRapidOCR(inputBuffer),
          ...psmModes.map(psm => tryTesseractOnBuffer(inputBuffer!, psm)),
        ]);
        resultData = getBestResult(results);
        candidateResults = results;
      } else {
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
            .rotate(skewDeg, { background: { r: 255, b: 255, g: 255 } })
            .toBuffer();
          const deskewedRaw = await sharp(inputBuffer)
            .rotate(skewDeg, { background: { r: 255, g: 255, b: 255 } })
            .toBuffer();
          if (Math.abs(skewDeg) >= 2.5) deskewedCount = 4;
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
          const [t6, t4, t11] = await Promise.all(psmModes.map(psm => tryTesseractOnBuffer(preprocessed, psm)));
          results.push(rapid, t6, t4, t11);
        }
        if (meanLum < 100) {
          const boosted = await sharp(preprocessed).modulate({ brightness: 1.7 }).toBuffer();
          results.push(...(await Promise.all(psmModes.map(psm => tryTesseractOnBuffer(boosted, psm)))));
          // Brightness + histogram-equalisation normalise — especially effective
          // on dark-background menus where the ₹ glyph is orange/low-contrast.
          // Boost alone sometimes misses the contrast stretch needed to
          // separate the symbol from the digit stream.
          const boostedNorm = await sharp(preprocessed).modulate({ brightness: 1.7 }).normalise().toBuffer();
          results.push(...(await Promise.all(psmModes.map(psm => tryTesseractOnBuffer(boostedNorm, psm)))));
        }
        const fastWinner = pickByParseQuality(getBestResult(results, deskewedCount), results);
        resultData = await menuOCRRescue(inputBuffer, fastWinner, results, deskewedCount);
        candidateResults = results;
      }
    } catch (e) {
      const psmModes = [6, 4, 11];
      const results = await Promise.all([
        tryRapidOCR(inputBuffer!),
        ...psmModes.map(psm => tryTesseractOnBuffer(inputBuffer!, psm)),
      ]);
      resultData = getBestResult(results);
      candidateResults = results;
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

  // Feed the (deterministically + optionally Ollama) CLEANED text into the
  // parsers, not the raw OCR text. This is the fix for "the cleaner runs
  // but the output is never used": the sequential/basic parsers now see the
  // tidy text, so garbage lines and split prices are already handled.
  items = parseResultData(resultData, parseText);
  
  // Cross-candidate price recovery: BEFORE crossValidate strips items with
  // implausible prices (e.g. "0012"→12). When the symbol is dropped and digits
  // are garbled, the price looks like 12, which crossValidate removes. By
  // recovering the correct price from sibling candidates first, we save the
  // item from being dropped.
  if (candidateResults.length > 0 && items.length > 0) {
    items = crossCandidatePriceRecovery(items, candidateResults);
  }

  items = crossValidate(items);

  // Ollama refine is the single most expensive step (~15-21s warm), but the
  // user wants it to actually run. Gate: run whenever the deterministic parse
  // is NOT clearly excellent (<6 dishes OR <4 priced OR any merged-row signal),
  // so normal menus still get name/price/category refinement while very clean
  // ones skip the LLM round-trip.
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

  // Ollama vision — reads the menu IMAGE directly (true OCR: image in, text out).
  // Vision is the PRIMARY reader. When it returns items, ALWAYS use them —
  // a vision model reading the actual image is more accurate than Tesseract
  // garbling decorative fonts. The call was started at the top of this
  // function so it overlaps the deterministic pipeline; here we only collect.
  if (visionPromise) {
    try {
      logger.info(`[OCR] Collecting parallel ollamaVisionOCR result...`);
      const vis = await visionPromise;
      logger.info(`[OCR] Vision returned: ${vis ? `alphaWordCount=${vis.alphaWordCount}` : 'null'}`);
      if (vis && vis.alphaWordCount >= 3) {
        const visText = vis.data.text.trim();
        logger.info(`[OCR] Vision text (first 300): ${visText.slice(0, 300)}`);

        // Extract items from vision JSON — handles flat arrays AND nested
        // structures like {"food_items": [{"category":"...", "items":[...]}]}
        let visItems: LocalOCRItem[] = [];
        try {
          // Strip markdown code fences if present
          const cleaned = visText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          const parsed = JSON.parse(cleaned);

          // Flatten all items from any JSON structure
          const extractItems = (obj: any): any[] => {
            if (Array.isArray(obj)) {
              // Array of items — each may have {name, price} directly
              // or {item, price}, or may be a category wrapper {category, items: [...]}
              const result: any[] = [];
              for (const el of obj) {
                if (el && typeof el === "object") {
                  // Check if this is a direct item (has name or item key)
                  const dishName = el.name || el.item || el.dish || el.dish_name || el.title;
                  if (dishName && typeof dishName === "string") {
                    // Parse price: number, or string like "$70", "70", "$70.00"
                    let price: number | undefined;
                    const rawPrice = el.price ?? el.cost ?? el.amount;
                    if (typeof rawPrice === "number" && Number.isFinite(rawPrice)) {
                      price = rawPrice;
                    } else if (typeof rawPrice === "string") {
                      const cleaned = rawPrice.replace(/[^0-9.]/g, "");
                      if (/^\d+(\.\d{1,2})?$/.test(cleaned)) price = parseFloat(cleaned);
                    }
                    result.push({ name: dishName, price, category: el.category || el.section || el.type });
                  } else if (Array.isArray(el.items)) {
                    // Category wrapper: {category: "...", items: [...]}
                    const cat = el.category || el.section || el.name || "";
                    for (const item of el.items) {
                      if (item && typeof item === "object") {
                        const innerName = item.name || item.item || item.dish || item.dish_name || item.title;
                        if (innerName && typeof innerName === "string") {
                          let price: number | undefined;
                          const rawPrice = item.price ?? item.cost ?? item.amount;
                          if (typeof rawPrice === "number" && Number.isFinite(rawPrice)) {
                            price = rawPrice;
                          } else if (typeof rawPrice === "string") {
                            const cleaned = rawPrice.replace(/[^0-9.]/g, "");
                            if (/^\d+(\.\d{1,2})?$/.test(cleaned)) price = parseFloat(cleaned);
                          }
                          result.push({ name: innerName, price, category: item.category || item.section || cat });
                        }
                      }
                    }
                  }
                }
              }
              return result;
            }
            if (obj && typeof obj === "object") {
              // Object with a nested array — try common keys
              for (const key of ["food_items", "items", "dishes", "menu_items", "menu", "results", "data"]) {
                if (Array.isArray(obj[key])) return extractItems(obj[key]);
              }
              // Try the first array value we find
              for (const val of Object.values(obj)) {
                if (Array.isArray(val) && val.length > 0) return extractItems(val);
              }
            }
            return [];
          };

          const rawItems = extractItems(parsed);
          logger.info(`[OCR] Vision extracted ${rawItems.length} raw items from JSON`);
          visItems = rawItems
            .filter((r: any) => r && typeof r === "object" && r.name)
            .map((r: any) => {
              // Normalize name: trim, remove surrounding quotes
              let name = String(r.name || "").trim().replace(/^["']|["']$/g, "");
              // Normalize price: already parsed by extractItems, but handle edge cases
              let price: number | undefined;
              if (typeof r.price === "number" && Number.isFinite(r.price)) {
                price = r.price;
              } else if (typeof r.price === "string") {
                const cleaned = r.price.replace(/[^0-9.]/g, "");
                if (/^\d+(\.\d{1,2})?$/.test(cleaned)) price = parseFloat(cleaned);
              }
              // Normalize category
              let category = typeof r.category === "string" ? r.category.trim().replace(/^["']|["']$/g, "") : undefined;
              return { name, price, category };
            })
            .filter((i) => i.name.length >= 2 && /[a-zA-Z]{2,}/.test(i.name));
          logger.info(`[OCR] Vision parsed ${visItems.length} clean items`);
        } catch (e) {
          logger.info(`[OCR] Vision JSON parse failed: ${e}`);
        }

        if (visItems.length === 0) {
          visItems = sequentialParse(cleanOCRText(visText).text);
        }

        if (visItems.length > 0) {
          logger.info(`[OCR] Ollama vision: ${visItems.length} items — REPLACING deterministic parse`);
          items = visItems;
        } else {
          logger.info(`[OCR] Vision produced 0 parseable items`);
        }
      }
    } catch (e) {
      logger.warn(`[OCR] Vision error: ${e}`);
    }
  }

  const result = { raw_text, items: items.slice(0, 50) };
  if (hash) await ocrCacheSet(hash, result);
  ocrSuccess('local');
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
  // Garbled name signals: words with embedded numbers, special chars
  const garbledWords = words.filter((w) => /[=|\\\/{}()[\]<>]/.test(w) || /\d+[a-zA-Z]|[a-zA-Z]+\d{2,}/.test(w)).length;
  // Relaxed thresholds so the cleaner actually triggers on real OCR garbage:
  return shortWords / words.length > 0.2 || nonAlphaWords / words.length > 0.12 || garbledWords / words.length > 0.15;
}

/** True when the parse needs Ollama refinement — either weak quantity,
 *  garbled names, or suspicious prices. */
function needsOllamaRefine(items: LocalOCRItem[]): boolean {
  if (items.length === 0) return false;
  const priced = items.filter((i) => i.price !== undefined).length;

  // Always refine when the parse is weak (< 6 dishes OR < 4 priced)
  if (items.length < 6 || priced < 4) return true;

  // Garbled name signal: non-alpha chars, embedded numbers, noise suffixes
  const garbledRe = /[=|\\\/{}()[\]<>]|\d{2,}|\b(ais|yet|No)\b|^[a-z]{1,2}\s/i;
  const garbledCount = items.filter((i) => garbledRe.test(i.name)).length;
  if (garbledCount / items.length > 0.2) return true;

  // Merged-row signal
  if (items.some((i) => /\$\s*\d+\s+\d{2}\b|\b\d{1,3}[.,]\d{1,2}\b/.test(i.name))) return true;

  // Suspicious price signal
  const prices = items.filter((i) => i.price !== undefined).map((i) => i.price as number);
  if (prices.some((p) => p < 100) && prices.some((p) => p > 200)) return true;

  return false;
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