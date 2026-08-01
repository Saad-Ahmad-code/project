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
  send('status', { status: 'ocr_layer4', progress: 65, message: 'Layer 4: AI Vision analysis...' });

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

      logger.info(`[OCR] Layer 4: ${items.length} items from AI Vision`);
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
    logger.warn(`[OCR] Layer 4 failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
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

  const errors: string[] = [];

  // Layer 1
  try {
    const result = await layer1TesseractJS(imageBuffer, send);
    if (result && result.items.length >= 2) {
      cacheSet(hash, result);
      return result;
    }
    errors.push('Layer1: insufficient items');
  } catch (e: any) { errors.push(`Layer1: ${e.message}`); }

  // Layer 2
  try {
    const result = await layer2SharpTesseract(imageBuffer, send);
    if (result && result.items.length >= 2) {
      cacheSet(hash, result);
      return result;
    }
    errors.push('Layer2: insufficient items');
  } catch (e: any) { errors.push(`Layer2: ${e.message}`); }

  // Layer 3 (AI Vision — final escalation)
  try {
    const result = await layer3AIVision(imageBuffer, send);
    if (result && result.items.length >= 1) {
      cacheSet(hash, result);
      return result;
    }
    errors.push('Layer3: no items');
  } catch (e: any) { errors.push(`Layer3: ${e.message}`); }

  // All layers failed — return best effort from layer 1 or empty
  logger.error(`[OCR] All layers failed: ${errors.join('; ')}`);
  send('error', { message: 'OCR processing failed: ' + errors.join('; ') });

  return { items: [], raw_text: '', layer: 'failed', confidence: 0 };
}
