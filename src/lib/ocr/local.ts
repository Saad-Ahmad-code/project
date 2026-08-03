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
import { cleanOCRText } from "./cleaner";
import { cleanTextWithOllama, ollamaVisionOCR, parseDishArray, refineWithOllama } from "./ollama";
import { splitMergedItemsFallback } from "./merged-split";
import { parseResultData, crossValidate, paragraphAwareParse, smartParse, sequentialParse, basicExtract } from "./parsing";
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

export async function runLocalOCR(
  file: File
): Promise<{ raw_text: string; items: LocalOCRItem[] }> {
  let resultData: any;
  let inputBuffer: Buffer | null = null;

  try {
    inputBuffer = Buffer.isBuffer(file as unknown)
      ? (file as unknown as Buffer)
      : Buffer.from(await (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());

    try {
      const sharp = eval('require')('sharp');
      const preprocessed = await sharp(inputBuffer)
        .grayscale()
        .normalize()
        .sharpen()
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
        results.push(
          await tryRapidOCR(deskewedRaw),
          ...(await Promise.all(psmModes.map((psm) => tryTesseractOnBuffer(deskewedPrep, psm)))),
          rapid,
          await tryTesseractOnBuffer(preprocessed, 6),
          await tryTesseractOnBuffer(preprocessed, 4),
          await tryTesseractOnBuffer(preprocessed, 11),
        );
      } else {
        results.push(
          rapid,
          await tryTesseractOnBuffer(preprocessed, 6),
          await tryTesseractOnBuffer(preprocessed, 4),
          await tryTesseractOnBuffer(preprocessed, 11),
        );
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
    const result = await Tesseract.recognize(file, "eng", {
      logger: () => {},
    });
    resultData = result.data;
  }

  const raw_text = resultData.text || "";
  const rawWords: any[] = resultData.words || [];

  const cleaned = cleanOCRText(raw_text);
  let parseText = cleaned.text;
  if (process.env.OLLAMA_CLEAN !== "0") {
    parseText = await cleanTextWithOllama(parseText);
  }

  const words: WordPos[] = rawWords
    .filter((w: any) => (w.confidence ?? 0) >= 25)
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

  if (process.env.OLLAMA_REFINE !== "0") {
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

  return { raw_text, items: items.slice(0, 50) };
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