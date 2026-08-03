/**
 * Dish image search orchestrator — queries all providers in parallel
 * (with timeouts), filters non-food results, scores, and ranks them.
 */
import { logger } from "@/lib/logger";
import { NON_FOOD_KEYWORDS, FOOD_EXCLUSION_KEYWORDS, FOOD_PATTERNS } from "@/lib/images/keywords";
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

/**
 * Split a URL into path segments (descriptive, e.g. /photos/grilled-salmon)
 * and query params (boilerplate, e.g. ?query=grilled+salmon&w=800). Query
 * params are weaker signals: they usually echo the search terms (and often
 * the auto-generated alt text) rather than describing the actual image.
 */
function splitUrlParts(url: string): { path: string; query: string } {
  try {
    const parsed = new URL(url);
    return { path: parsed.pathname, query: parsed.search };
  } catch {
    return { path: url, query: "" };
  }
}

/** Penalize extreme aspect ratios (banner/hero 16:9, vertical posters) —
 *  dish photos are typically ~4:3, 3:4, or square. Returns 0 when the URL
 *  doesn't carry dimensions (no penalty applied by caller). */
function aspectRatioPenalty(url: string): number {
  try {
    const parsed = new URL(url);
    const w = parseInt(parsed.searchParams.get("w") || parsed.searchParams.get("width") || "", 10);
    const h = parseInt(parsed.searchParams.get("h") || parsed.searchParams.get("height") || "", 10);
    if (!w || !h) return 0;
    const ratio = w / h;
    if (ratio > 2.1 || ratio < 0.45) return 15; // banner/hero or tall poster
    if (ratio > 1.8 || ratio < 0.55) return 8; // noticeably wide/tall
    return 0;
  } catch {
    return 0;
  }
}

function isFoodImage(url: string, query: string): boolean {
  const lower = `${url} ${query}`.toLowerCase();
  const nonFoodHits = [...NON_FOOD_KEYWORDS].filter((kw) => lower.includes(kw)).length;
  if (nonFoodHits >= 3) return false;
  // A food-exclusion term (cooking/ingredients/plating/hands) outweighs a
  // single non-food hit: these are food-adjacent but not a finished dish.
  // Word-boundary match — "cook" must not hit "cookies", "hand" not
  // "handcrafted" (which is a food keyword).
  const exclusionHits = [...FOOD_EXCLUSION_KEYWORDS].filter((kw) =>
    new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)
  ).length;
  if (exclusionHits > 0) return false;
  return true;
}

function scoreImage(url: string, query: string): number {
  let score = 50;
  const lower = `${url} ${query}`.toLowerCase();
  const { path, query: queryPart } = splitUrlParts(url);
  const pathLower = path.toLowerCase();

  const nonFoodHits = [...NON_FOOD_KEYWORDS].filter((kw) => lower.includes(kw)).length;
  score -= nonFoodHits * 15;

  const foodPatternHits = FOOD_PATTERNS.filter((p) => p.test(lower)).length;
  score += foodPatternHits * 10;

  const queryWords = query.toLowerCase().split(/\s+/);
  const pathWords = pathLower.split(/[/\-_]+/);
  // URL-path segments are descriptive ("/grilled-salmon.jpg") — weight them
  // MORE than query params, which echo the search query by construction.
  const pathOverlap = queryWords.filter((w) => pathWords.some((uw) => uw.includes(w) || w.includes(uw))).length;
  score += pathOverlap * 6;

  const queryWordsUrl = queryPart.toLowerCase().split(/[?&=+/\-_]+/);
  const queryOverlap = queryWords.filter((w) => queryWordsUrl.some((uw) => uw.includes(w) || w.includes(uw))).length;
  score += queryOverlap * 2;

  if (pathOverlap === 0 && queryOverlap === 0) score -= 20;

  score -= aspectRatioPenalty(url);

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
