/**
 * Multi-Layer OCR Engine
 *
 * Tries 3 layers in sequence, falling through on failure:
 *   Layer 1 — Tesseract.js (pure JS/WASM, instant)
 *   Layer 2 — Tesseract + Sharp preprocessing (higher quality)
 *   Layer 3 — AI Vision API (OpenRouter → Gemini)
 *
 * The former Layer 3 (EasyOCR subprocess) was retired: runLocalOCR's pool
 * already includes RapidOCR (PP-OCRv6) — the stronger neural reader — plus a
 * word-level pytesseract pipeline (menu_ocr.py); see src/lib/ocr/local.ts.
 *
 * Each layer reports progress via callback for SSE streaming.
 */

import { logger } from '@/lib/logger';

// ── Types ──

export interface OCRItem {
  name: string;
  description?: string;
  price?: number;
  category?: string;
  confidence?: number;
}

export interface OCRResult {
  items: OCRItem[];
  raw_text: string;
  layer: string;
  confidence: number;
  menu_name?: string;
}

type ProgressCallback = (event: string, data: Record<string, unknown>) => void;

// ── Image hash cache ──

const resultCache = new Map<string, { result: OCRResult; ts: number }>();

function cacheGet(hash: string): OCRResult | null {
  const entry = resultCache.get(hash);
  if (entry && Date.now() - entry.ts < 300_000) return entry.result;
  resultCache.delete(hash);
  return null;
}

function cacheSet(hash: string, result: OCRResult) {
  if (resultCache.size >= 50) {
    const first = resultCache.entries().next().value;
    if (first) resultCache.delete(first[0]);
  }
  resultCache.set(hash, { result, ts: Date.now() });
}

function imageHash(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hash = 0;
  for (let i = 0; i < Math.min(bytes.length, 4096); i += 4) {
    hash = ((hash << 5) - hash) + bytes[i];
    hash = hash & hash;
  }
  return (hash >>> 0).toString(36);
}

// ── Layer 1: Tesseract.js (fastest, pure JS) ──

async function layer1TesseractJS(
  imageBuffer: ArrayBuffer,
  send: ProgressCallback
): Promise<OCRResult | null> {
  send('status', { status: 'ocr_layer1', progress: 20, message: 'Layer 1: Tesseract.js scanning...' });

  try {
    const Tesseract = require('tesseract.js');
    const { runLocalOCR } = require('./local');

    // Create a File-like object from buffer
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    const file = new File([blob], 'menu.jpg', { type: 'image/jpeg' });

    const result = await runLocalOCR(file);

    if (!result.items || result.items.length === 0) {
      logger.info('[OCR] Layer 1: No items found');
      return null;
    }

    logger.info(`[OCR] Layer 1: ${result.items.length} items from Tesseract.js`);
    return {
      items: result.items.map((i: any) => ({ ...i, confidence: 0.5 })),
      raw_text: result.raw_text,
      layer: 'tesseract.js',
      confidence: 50,
    };
  } catch (err: any) {
    logger.warn(`[OCR] Layer 1 failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

// ── Layer 2: Sharp preprocessing + Tesseract retry ──

async function layer2SharpTesseract(
  imageBuffer: ArrayBuffer,
  send: ProgressCallback
): Promise<OCRResult | null> {
  send('status', { status: 'ocr_layer2', progress: 35, message: 'Layer 2: Enhanced OCR with preprocessing...' });

  try {
    const sharp = require('sharp');
    const Tesseract = require('tesseract.js');

    // Preprocess with Sharp: convert to grayscale, increase contrast, resize
    const processed = await sharp(Buffer.from(imageBuffer))
      .grayscale()
      .normalize()        // auto contrast
      .sharpen()           // sharpen edges
      .resize({ width: 2048, withoutEnlargement: true })
      .toBuffer();

    // Try multiple PSM modes
    const psmModes = [6, 4, 3, 11, 12];
    let bestText = '';
    let bestWordCount = 0;

    for (const psm of psmModes) {
      const { data } = await Tesseract.recognize(processed, 'eng', {
        tessedit_pageseg_mode: String(psm),
        logger: () => {},
      });

      const text = (data.text || '').trim();
      const words = text.split(/\s+/).filter((w: string) => w.length > 2);
      const alphaWords = words.filter((w: string) => /[a-zA-Z]{3,}/.test(w));

      if (alphaWords.length > bestWordCount) {
        bestWordCount = alphaWords.length;
        bestText = text;
      }
    }

    if (!bestText || bestWordCount < 3) {
      logger.info('[OCR] Layer 2: Insufficient text quality');
      return null;
    }

    // Extract dishes using the same extraction logic from local.ts
    const { runLocalOCR } = require('./local');
    const blob = new Blob([processed], { type: 'image/png' });
    const file = new File([blob], 'menu_enhanced.png', { type: 'image/png' });
    const result = await runLocalOCR(file);

    if (!result.items || result.items.length === 0) {
      logger.info('[OCR] Layer 2: No items after extraction');
      return null;
    }

    logger.info(`[OCR] Layer 2: ${result.items.length} items (sharp + psm modes)`);
    return {
      items: result.items.map((i: any) => ({ ...i, confidence: 0.6 })),
      raw_text: bestText,
      layer: 'sharp+tesseract',
      confidence: 60,
    };
  } catch (err: any) {
    logger.warn(`[OCR] Layer 2 failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

// ── Layer 3: AI Vision API (OpenRouter → Gemini) ──

async function layer3AIVision(
  imageBuffer: ArrayBuffer,
  send: ProgressCallback
): Promise<OCRResult | null> {
  send('status', { status: 'ocr_layer3', progress: 65, message: 'Layer 3: AI Vision analysis...' });

  const visionPrompt = `Extract all menu items from this restaurant menu image. Return ONLY valid JSON:
{"menu_name":"restaurant name if visible","items":[{"name":"dish name","description":"brief description if available","price":12.99,"category":"appetizer|entree|dessert|drink|side|soup|salad|other"}]}

Rules:
- Include every visible menu item
- Price should be numeric, no currency symbol
- If a field is not visible, omit it
- If no dishes are identifiable, return {"items":[],"error":"reason"}`;

  try {
    const { callGeminiVision } = require('@/lib/ai/client');
    const response = await callGeminiVision(imageBuffer, visionPrompt);

    if (!response || response.length < 10) return null;

    try {
      const parsed = JSON.parse(response);
      const items: OCRItem[] = (parsed.items || []).map((i: any) => ({
        name: i.name || 'Unknown',
        description: i.description || '',
        price: i.price || undefined,
        category: i.category || 'menu',
        confidence: 0.9,
      }));

      if (items.length === 0) return null;

      logger.info(`[OCR] Layer 3: ${items.length} items from AI Vision`);
      return {
        items,
        raw_text: '',
        layer: 'ai-vision',
        confidence: 85,
        menu_name: parsed.menu_name,
      };
    } catch {
      return null;
    }
  } catch (err: any) {
    logger.warn(`[OCR] Layer 3 failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

/**
 * Detect garbled OCR text — names with non-alpha noise, embedded prices,
 * or other signs that the OCR struggled with decorative/stylized fonts.
 * Returns true when the result quality is poor enough to warrant AI Vision.
 */
function isGarbledResult(result: OCRResult): boolean {
  if (!result.items || result.items.length === 0) return true;

  let garbledCount = 0;
  for (const item of result.items) {
    const name = item.name || '';
    // Garbled signals: non-alpha characters in name, price embedded in name,
    // very short names, or names that look like category headers
    if (/[=|\\\/{}()[\]<>]/.test(name)) { garbledCount++; continue; }
    if (/\d{2,}/.test(name) && !/^\d/.test(name)) { garbledCount++; continue; }
    if (name.length < 3) { garbledCount++; continue; }
    if (/^[A-Z]{3,}$/.test(name.trim())) { garbledCount++; continue; } // ALL CAPS header
    if (/^\w+\s+(ais|yet|No)\b/.test(name)) { garbledCount++; continue; } // noise suffixes
  }

  // Escalate if >30% of items look garbled
  return garbledCount / result.items.length > 0.3;
}

// ── Main orchestrator ──

export async function runOCRPipeline(
  imageBuffer: ArrayBuffer,
  send: ProgressCallback = () => {}
): Promise<OCRResult> {
  // Check cache
  const hash = imageHash(imageBuffer);
  const cached = cacheGet(hash);
  if (cached) {
    logger.info(`[OCR] Cache hit: ${hash}`);
    send('status', { status: 'cached', progress: 100, message: 'Using cached OCR result' });
    return cached;
  }

  send('status', { status: 'ocr_started', progress: 10, message: 'Starting OCR analysis…' });

  // Run Tesseract and AI Vision in PARALLEL — whichever finishes first with
  // good results wins. This cuts scan time from ~20-60s (sequential) to
  // ~8-15s (whichever completes last is the only wait).
  const tesseractPromise = layer1TesseractJS(imageBuffer, send).catch((e: any) => {
    logger.warn(`[OCR] Tesseract layer failed: ${e.message?.slice(0, 100)}`);
    return null as OCRResult | null;
  });

  const visionPromise = layer3AIVision(imageBuffer, send).catch((e: any) => {
    logger.warn(`[OCR] Vision layer failed: ${e.message?.slice(0, 100)}`);
    return null as OCRResult | null;
  });

  // Fire both concurrently
  const [tesseractResult, visionResult] = await Promise.all([tesseractPromise, visionPromise]);

  // Prefer Tesseract if it got clean, non-garbled results (fast + local)
  if (tesseractResult && tesseractResult.items.length >= 2 && !isGarbledResult(tesseractResult)) {
    logger.info(`[OCR] Tesseract won: ${tesseractResult.items.length} items`);
    cacheSet(hash, tesseractResult);
    return tesseractResult;
  }

  // AI Vision result is always usable if it found anything (higher accuracy)
  if (visionResult && visionResult.items.length >= 1) {
    logger.info(`[OCR] Vision won: ${visionResult.items.length} items`);
    cacheSet(hash, visionResult);
    return visionResult;
  }

  // Both had issues — prefer whichever found more items
  const fallback = (tesseractResult?.items.length ?? 0) >= (visionResult?.items.length ?? 0)
    ? tesseractResult : visionResult;

  if (fallback && fallback.items.length >= 1) {
    logger.info(`[OCR] Fallback: ${fallback.layer} with ${fallback.items.length} items`);
    cacheSet(hash, fallback);
    return fallback;
  }

  logger.error(`[OCR] Both layers failed — Tesseract: ${tesseractResult?.items.length ?? 0}, Vision: ${visionResult?.items.length ?? 0}`);
  send('error', { message: 'OCR processing failed — could not identify any dishes' });

  return { items: [], raw_text: '', layer: 'failed', confidence: 0 };
}
