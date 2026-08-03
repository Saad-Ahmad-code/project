/**
 * Dish image search orchestrator — queries all providers in parallel
 * (with timeouts), filters non-food results, scores, and ranks them.
 */
import { logger } from "@/lib/logger";
import { NON_FOOD_KEYWORDS, FOOD_PATTERNS } from "@/lib/images/keywords";
import { searchUnsplash } from "@/lib/images/unsplash";
import { searchPexels } from "@/lib/images/pexels";
import { searchBing } from "@/lib/images/bing";
import { searchWikipedia } from "@/lib/images/wikipedia";
import { searchOpenverse } from "@/lib/images/openverse";
import { searchMealDB } from "@/lib/images/mealdb";
import { searchLocalDB } from "@/lib/images/local-db";

interface ImageResult {
  url: string;
  source: string;
  score?: number;
}

const API_DOMAINS = [
  "image.pollinations.ai",
  "images.unsplash.com",
  "images.pexels.com",
  "upload.wikimedia.org",
];

function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (API_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith("." + d))) return true;
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isFoodImage(url: string, query: string): boolean {
  const lower = `${url} ${query}`.toLowerCase();
  const nonFoodHits = [...NON_FOOD_KEYWORDS].filter((kw) => lower.includes(kw)).length;
  return nonFoodHits < 3;
}

function scoreImage(url: string, query: string): number {
  let score = 50;
  const lower = `${url} ${query}`.toLowerCase();

  const nonFoodHits = [...NON_FOOD_KEYWORDS].filter((kw) => lower.includes(kw)).length;
  score -= nonFoodHits * 15;

  const foodPatternHits = FOOD_PATTERNS.filter((p) => p.test(lower)).length;
  score += foodPatternHits * 10;

  const queryWords = query.toLowerCase().split(/\s+/);
  const urlWords = url.toLowerCase().split(/[/\-_]+/);
  const overlap = queryWords.filter((w) => urlWords.some((uw) => uw.includes(w) || w.includes(uw))).length;
  if (overlap === 0) score -= 20;

  return Math.max(0, Math.min(100, score));
}

export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, context?: Record<string, unknown>): Promise<T> {
   const controller = new AbortController();
   const timer = setTimeout(() => controller.abort(), timeoutMs);
   try {
     const result = await Promise.race([
       fn(controller.signal),
       new Promise<never>((_, reject) => {
         controller.signal.addEventListener("abort", () => {
           reject(new Error(`Timeout after ${timeoutMs}ms${context?.name ? ` for "${context.name}"` : ""}`));
         });
       }),
     ]);
     return result;
   } finally {
     clearTimeout(timer);
   }
 }

interface ImageSource {
   name: string;
   weight: number;
   search: (query: string, signal?: AbortSignal) => Promise<{ url: string; source: string }[]>;
 }

const sources: ImageSource[] = [
  { name: "unsplash", weight: 35, search: searchUnsplash },
  { name: "pexels", weight: 25, search: searchPexels },
  { name: "bing", weight: 20, search: searchBing },
  { name: "wikipedia", weight: 18, search: searchWikipedia },
  { name: "openverse", weight: 15, search: searchOpenverse },
  { name: "mealdb", weight: 10, search: searchMealDB },
  { name: "local", weight: 3, search: searchLocalDB },
];

// In-flight dedup map for image search
const inFlightImages = new Map<string, Promise<ImageResult[]>>();

export async function searchDishImages(dishName: string): Promise<ImageResult[]> {
  const key = dishName.trim().toLowerCase();

  // In-flight dedup — share results across concurrent callers (e.g., the same
  // dish appearing in multiple scans processed by the 3-worker pool).
  if (inFlightImages.has(key)) {
    logger.info(`[Images] Dedup: reusing in-flight search for "${dishName}"`);
    return inFlightImages.get(key)!;
  }

  const promise = searchDishImagesImpl(dishName);
  inFlightImages.set(key, promise);

  try {
    return await promise;
  } finally {
    inFlightImages.delete(key);
  }
}

// Actual image search implementation (wrapped by searchDishImages for dedup)
async function searchDishImagesImpl(dishName: string): Promise<ImageResult[]> {
  const allResults: ImageResult[] = [];
  // Process sources in priority order (already sorted by weight desc).
  // Early-exit: if we find a high-quality food image (score ≥ 70) from a
  // top-weighted source, skip remaining sources to save API calls/time.
  const HIGH_SCORE_THRESHOLD = 70;

  const settled = await Promise.allSettled(
    sources.map((source) =>
      withTimeout(
        (signal: AbortSignal) => source.search(dishName, signal),
        10000,
        { name: `${source.name} search for "${dishName}"` }
      )
    )
  );

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status !== "fulfilled") {
      logger.warn(`[Images] ${sources[i].name} failed for "${dishName}": timed out`);
      continue;
    }
    const results = r.value;
    for (const img of results) {
      if (isValidImageUrl(img.url) && isFoodImage(img.url, dishName)) {
        const scored: ImageResult = {
          ...img,
          score: scoreImage(img.url, dishName) + sources[i].weight,
        };
        allResults.push(scored);
        // Early exit: a high-quality result from a top source is good enough
        if ((scored.score || 0) >= HIGH_SCORE_THRESHOLD && sources[i].weight >= 25) {
          logger.info(`[Images] Early exit: ${sources[i].name} returned score ${scored.score} for "${dishName}"`);
          allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
          return allResults.slice(0, 10);
        }
      }
    }
  }

  allResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  if (allResults.length > 0 && (allResults[0].score || 0) < 30) {
    logger.info(`[Images] Low quality results for "${dishName}" (best score: ${allResults[0].score})`);
  }

  return allResults.slice(0, 10);
}
