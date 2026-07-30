/**
 * 🥗 Nutrition API — Open Food Facts Integration
 *
 * Free, open food database. No API key needed.
 * Queries Open Food Facts by dish name and returns structured nutrition data.
 *
 * POST /api/nutrition
 *   Body: { dish_name: string }
 *   Returns: { name, calories, protein, fat, carbs, fiber, sugars, serving_size, image_url, source }
 */

import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const CACHE_TTL = 3600_000; // 1 hour
const cache = new Map<string, { data: NutritionResult[]; ts: number }>();

export interface NutritionResult {
  name: string;
  calories?: number;
  protein_g?: number;
  fat_g?: number;
  carbs_g?: number;
  fiber_g?: number;
  sugars_g?: number;
  serving_size?: string;
  image_url?: string;
  source: string;
  barcode?: string;
}

function getCached(key: string): NutritionResult[] | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: NutritionResult[]) {
  if (cache.size >= 200) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { data, ts: Date.now() });
}

function stripFoodDescription(name: string): string {
  // Remove common descriptors to get base food name for search
  return name
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\b(grilled|fried|roasted|baked|steamed|sautéed|sauteed|pan[-\s]fried|deep[-\s]fried|stir[-\s]fried)\b/gi, '')
    .replace(/\b(with|in|and|on|of|style)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .slice(0, 50);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dishName = (body.dish_name || '').trim();

    if (!dishName || dishName.length < 2) {
      return Response.json({ error: 'dish_name is required', results: [] }, { status: 400 });
    }

    // Check cache
    const cacheKey = dishName.toLowerCase().trim();
    const cached = getCached(cacheKey);
    if (cached) {
      return Response.json({ dish_name: dishName, results: cached, cached: true });
    }

    // Build search query — try exact first, then broad
    const searchTerm = stripFoodDescription(dishName);
    const url = `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(searchTerm)}&json=1&page_size=5&fields=product_name,nutriments,serving_size,image_front_small_url,code,categories`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'MenuLens - meal scanning app - 70186904@student.uol.edu.pk' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logger.warn(`[Nutrition] Open Food Facts returned ${res.status}`);
      return Response.json({ dish_name: dishName, results: [], error: 'Nutrition service unavailable' });
    }

    const data = await res.json();
    const products = data.products || [];

    const results: NutritionResult[] = products.slice(0, 5).map((p: any) => {
      const n = p.nutriments || {};
      return {
        name: p.product_name || searchTerm,
        calories: n['energy-kcal_100g'] ? Math.round(n['energy-kcal_100g']) : undefined,
        protein_g: n.proteins_100g ? Math.round(n.proteins_100g * 10) / 10 : undefined,
        fat_g: n.fat_100g ? Math.round(n.fat_100g * 10) / 10 : undefined,
        carbs_g: n.carbohydrates_100g ? Math.round(n.carbohydrates_100g * 10) / 10 : undefined,
        fiber_g: n.fiber_100g ? Math.round(n.fiber_100g * 10) / 10 : undefined,
        sugars_g: n.sugars_100g ? Math.round(n.sugars_100g * 10) / 10 : undefined,
        serving_size: p.serving_size || undefined,
        image_url: p.image_front_small_url || undefined,
        source: 'openfoodfacts',
        barcode: p.code || undefined,
      };
    });

    // Cache results
    setCache(cacheKey, results);

    return Response.json({ dish_name: dishName, results, cached: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Nutrition] API error: ${message}`);
    return Response.json({ error: message, results: [] }, { status: 500 });
  }
}
