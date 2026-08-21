// Persistent OCR cache using a local JSON file stored at src/lib/ocr/.ocrCache.json
// Provides async get/set functions with TTL handling.

import { promises as fs } from 'fs';
import path from 'path';

const CACHE_FILE = path.resolve(__dirname, '.ocrCache.json');
const MAX_ENTRIES = 60;
const DEFAULT_TTL_MS = (parseInt(process.env.OCR_CACHE_TTL_SECONDS ?? '600')) * 1000;

interface CacheEntry {
  result: { raw_text: string; items: any[] };
  ts: number; // timestamp in ms
}

let cacheMap: Map<string, CacheEntry> | null = null;

async function loadCache(): Promise<void> {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    const obj = JSON.parse(data) as Record<string, CacheEntry>;
    cacheMap = new Map(Object.entries(obj));
  } catch (e) {
    cacheMap = new Map();
  }
}

async function saveCache(): Promise<void> {
  if (!cacheMap) return;
  const obj = Object.fromEntries(cacheMap);
  await fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
}

export async function getCache(key: string, ttlMs = DEFAULT_TTL_MS): Promise<{ raw_text: string; items: any[] } | null> {
  if (!cacheMap) await loadCache();
  const entry = cacheMap?.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) {
    return entry.result;
  }
  if (entry) cacheMap?.delete(key);
  return null;
}

export async function setCache(key: string, result: { raw_text: string; items: any[] }, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  if (!cacheMap) await loadCache();
  if ((cacheMap?.size ?? 0) >= MAX_ENTRIES) {
    const oldestKey = cacheMap?.keys().next().value;
    if (oldestKey) cacheMap?.delete(oldestKey);
  }
  cacheMap?.set(key, { result, ts: Date.now() });
  await saveCache();
}

export async function clearCache(): Promise<void> {
  cacheMap = new Map();
  await saveCache();
}
