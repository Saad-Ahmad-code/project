import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Tesseract from "tesseract.js";
import { cleanOCRText } from "./cleaner";
import { cleanTextWithOllama, ollamaVisionOCR, parseDishArray, refineWithOllama } from "./ollama";
import { parseResultData } from "./parsing";
import { correctOCRErrors } from "./data/ocr-corrections";
import { CURRENCY_SYMBOLS } from "./price";
import type { LocalOCRItem } from "./parsing";

const RAPIDOCR_SCRIPT = join(process.cwd(), "src", "scripts", "rapidocr_scan.py");
const MENU_OCR_SCRIPT = join(process.cwd(), "src", "scripts", "menu_ocr.py");

function resolvePythonCmd(): string {
  if (process.env.MENULENS_PYTHON) return process.env.MENULENS_PYTHON;
  const venv = join(process.cwd(), ".venv", "Scripts", "python.exe");
  if (existsSync(venv)) return venv;
  return process.env.PYTHON_CMD || "python";
}

function runPythonScript(script: string, args: string[], timeoutMs = 45000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePythonCmd(), [script, ...args], {
      env: { ...process.env, PYTHONPATH: "" },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`python ${script} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`python ${script} exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}

export interface OCRCandidate {
  data: any;
  wordCount: number;
  alphaWordCount: number;
  avgConf: number;
}

async function tryRapidOCR(
  buffer: Buffer
): Promise<OCRCandidate | null> {
  const tmp = join(tmpdir(), `menulens-rapidocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    writeFileSync(tmp, buffer);
    const out = await runPythonScript(RAPIDOCR_SCRIPT, [tmp]);
    const parsed = JSON.parse(out.trim());
    const lines: Array<{ text: string; conf: number; box: number[] }> = parsed.lines || [];
    const text: string = parsed.raw_text || "";

    const words = lines
      .filter((l) => l.text && Array.isArray(l.box) && l.box.length === 4)
      .flatMap((l) => {
        const tokens = l.text.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return [];
        const [x0, y0, x1, y1] = l.box;
        const lineW = Math.max(x1 - x0, 1);
        const totalChars = l.text.length || 1;
        const conf = Math.round((l.conf ?? 0) * 100);
        let cx = x0;
        return tokens.map((tok) => {
          const w = Math.max((tok.length / totalChars) * lineW, 2);
          const word = {
            text: tok,
            confidence: conf,
            bbox: { x0: cx, y0, x1: cx + w, y1 },
          };
          cx += w + 2;
          return word;
        });
      });

    const splitWords = text.split(/\s+/).filter((w: string) => w.length > 2);
    const alphaWords = splitWords.filter((w: string) => /[\p{L}]{3,}/u.test(w));
    const avgConf = lines.length
      ? (lines.reduce((a, l) => a + (l.conf ?? 0), 0) / lines.length) * 100
      : 0;
    return { data: { text, words, rawLines: lines }, wordCount: splitWords.length, alphaWordCount: alphaWords.length, avgConf };
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function tryMenuOCR(buffer: Buffer): Promise<OCRCandidate | null> {
  const tmpDir = join(tmpdir(), `menulens-menuocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inputPath = join(tmpDir, "menu.png");
  const scriptPath = join(tmpDir, "menu_ocr.py");
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(inputPath, buffer);
    const slash = (p: string) => p.replace(/\\/g, "/");
    const script = readFileSync(MENU_OCR_SCRIPT, "utf8")
      .replace(/__PYTHON_SITE_PACKAGES__/g, slash(process.env.PYTHON_SITE_PACKAGES || ""))
      .replace(/__TESSERACT_CMD__/g, slash(process.env.TESSERACT_CMD || "tesseract"))
      .replace(/__IMG_PATH__/g, slash(inputPath));
    writeFileSync(scriptPath, script);

    const out = await runPythonScript(scriptPath, [], 120000);
    const parsed = JSON.parse(out.trim());
    const text: string = parsed.raw_text || "";

    const words = (parsed.words || [])
      .filter((w: any) => w && typeof w.word === "string" && w.word.trim().length > 0)
      .map((w: any) => {
        const x = w.x ?? 0;
        const y = w.y ?? 0;
        return {
          text: w.word as string,
          confidence: Math.round(w.conf ?? 0),
          bbox: { x0: x, y0: y, x1: x + (w.w ?? 0), y1: y + (w.h ?? 0) },
        };
      });

    if ((parsed.items || []).length === 0 && words.length === 0) return null;

    const splitWords = text.split(/\s+/).filter((w: string) => w.length > 2);
    const alphaWords = splitWords.filter((w: string) => /[\p{L}]{3,}/u.test(w));
    return {
      data: { text, words },
      wordCount: splitWords.length,
      alphaWordCount: alphaWords.length,
      avgConf: typeof parsed.avg_confidence === "number" ? parsed.avg_confidence : 0,
    };
  } catch {
    return null;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function tryTesseractOnBuffer(
  buffer: Buffer,
  psm: number
): Promise<OCRCandidate> {
  const result = await Tesseract.recognize(buffer, "eng", {
    tessedit_pageseg_mode: String(psm),
    logger: () => {},
  } as any);
  const text = (result.data.text || "").trim();
  const words = text.split(/\s+/).filter((w: string) => w.length > 2);
  const alphaWords = words.filter((w: string) => /[\p{L}]{3,}/u.test(w));
  return {
    data: result.data,
    wordCount: words.length,
    alphaWordCount: alphaWords.length,
    avgConf: result.data.confidence ?? 0,
  };
}

function countPriceLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const line of text.split("\n")) {
    if (new RegExp(`[${CURRENCY_SYMBOLS}]\\s*\\d|\\b\\d{1,3}[.,]\\d{1,2}\\b`).test(line)) n++;
  }
  return n;
}

function estimateSkewDegrees(rawLines: Array<{ box: number[] } | null | undefined>): number {
  const boxes = (rawLines ?? [])
    .filter((l): l is { box: number[] } => !!l && Array.isArray(l.box) && l.box.length === 4)
    .map((l) => l.box as [number, number, number, number]);
  if (boxes.length < 6) return 0;

  let h = 30;
  let theta = 0;
  for (let iter = 0; iter < 4; iter++) {
    const rad = (theta * Math.PI) / 180;
    const narrow = boxes.filter(([x0, , x1]) => x1 - x0 < 90);
    if (narrow.length < 2) break;
    const hs = narrow
      .map(([x0, y0, x1, y1]) => (y1 - y0) - (x1 - x0) * Math.sin(rad))
      .sort((a, b) => a - b);
    h = hs[Math.floor(hs.length / 2)];

    const wide = boxes.filter(([x0, , x1]) => x1 - x0 >= 120);
    if (wide.length < 3) break;
    const angles = wide
      .map(([x0, y0, x1, y1]) => {
        const w = x1 - x0;
        const num = (y1 - y0) - h * Math.cos(rad);
        return (Math.asin(Math.max(-0.35, Math.min(0.35, num / w))) * 180) / Math.PI;
      })
      .sort((a, b) => a - b);
    theta = angles[Math.floor(angles.length / 2)];
  }
  return Math.abs(theta) >= 1.0 && Math.abs(theta) <= 14 ? theta : 0;
}

function getBestResult(results: Array<OCRCandidate | null>, deskewedCount = 0): any {
  let best: any = null;
  let bestScore = -1;
  for (const [index, r] of results.entries()) {
    if (!r || !r.data) continue;
    if (r.alphaWordCount < 3 || (r.avgConf ?? 0) < 40) continue;
    const hasWords = Array.isArray(r.data.words) && r.data.words.length > 0;
    const alphaWords = ((r.data.text ?? "").split(/\s+/)).filter((w: string) => /[a-zA-Z]{3,}/.test(w)).length;
    const priceLines = countPriceLines(r.data.text ?? "");
    const bonus = index < deskewedCount ? 1 : 0;
    const rapidBonus = Array.isArray(r.data?.rawLines) ? 2 : 0;
    const score = alphaWords * 10 + r.wordCount + (r.avgConf ?? 0) / 10 + (hasWords ? 25 : 0) + priceLines * 4 + bonus + rapidBonus;
    if (score > bestScore) {
      bestScore = score;
      best = r.data;
    }
  }
  return best ?? (results.find((r) => r && r.data)?.data ?? null);
}

function pickByParseQuality(base: any, results: Array<OCRCandidate | null>): any {
  const quality = (data: any) => {
    try {
      // Clean the text first so currency-symbol substitutions (き→₹,
      // g→₹, Z→₹, etc.) are reflected in the parse quality score.
      // Without this, a candidate with "g100" scores LOW (g not a currency
      // symbol → price lost) while a candidate with "き100" scores HIGH
      // (き→₹ via cleaner → price found), even though both should be
      // treated equally after cleaning.
      const cleaned = cleanOCRText(data.text || "").text;
      const items = parseResultData({ ...data, text: cleaned });
      const priced = items.filter(i => i.price !== undefined).length;
      // Bonus: count price lines in cleaned text that have a recognisable
      // currency symbol — this rewards candidates where the ₹ glyph survived
      // OCR (whether read as き, g, Z, #, £, ¥, F, E). A candidate preserving
      // more currency symbols produces fewer garbled digit-only prices,
      // which matters because the Ollama refine gate trusts the cleaned text.
      const cleanPriceLines = cleaned.split("\n").filter(l =>
        new RegExp(`[${"₹" + CURRENCY_SYMBOLS}]\\s*\\d`).test(l)
      ).length;
      return { priced, total: items.length, cleanPriceLines };
    } catch {
      return { priced: -1, total: -1, cleanPriceLines: 0 };
    }
  };
  let best = base;
  let bestQ = quality(base);
  for (const r of results) {
    if (!r?.data) continue;
    const q = quality(r.data);
    // Rank by: more priced items first, then more clean price lines
    // (currency symbols preserved), then more total items.
    // A candidate with fewer priced items but MORE currency-symbol prices
    // is preferred — those prices are recoverable, while digit-only prices
    // (0012, 092) are likely garbled beyond repair.
    const bestScore = bestQ.priced * 100 + bestQ.cleanPriceLines * 10 + bestQ.total;
    const qScore = q.priced * 100 + q.cleanPriceLines * 10 + q.total;
    if (qScore > bestScore) {
      bestQ = q;
      best = r.data;
    }
  }
  return best;
}

async function menuOCRRescue(
  buffer: Buffer,
  base: any,
  results: Array<OCRCandidate | null>,
  deskewedCount: number
): Promise<any> {
  let fastItems: LocalOCRItem[];
  try {
    fastItems = parseResultData(base);
  } catch {
    fastItems = [];
  }
  const priced = fastItems.filter((i) => i.price !== undefined).length;
  if (fastItems.length >= 3 && priced >= 2) return base;

  const menuOcr = await tryMenuOCR(buffer);
  if (!menuOcr) return base;
  results.push(menuOcr);
  return pickByParseQuality(getBestResult(results, deskewedCount), results);
}

export {
  tryRapidOCR,
  tryMenuOCR,
  tryTesseractOnBuffer,
  getBestResult,
  pickByParseQuality,
  menuOCRRescue,
  estimateSkewDegrees,
  runPythonScript,
  resolvePythonCmd,
  RAPIDOCR_SCRIPT,
  MENU_OCR_SCRIPT,
};