/**
 * Nutrition API — Open Food Facts Integration
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
  nutri_score?: string;
}

/** Simplified Nutri-Score calculation based on EU regulation */
function calculateNutriScore(n: { calories?: number; fiber_g?: number; protein_g?: number; fat_g?: number; sugars_g?: number }): string {
  // Negative points (N) — based on energy, saturated fat, sugar, sodium per 100g
  let N = 0;

  // Energy points
  const kcal = n.calories ?? 0;
  if (kcal > 275) N += 10;
  else if (kcal > 200) N += 7;
  else if (kcal > 150) N += 5;
  else if (kcal > 100) N += 3;
  else if (kcal > 50) N += 1;

  // Saturated fat — estimate from total fat (~30%)
  const satFat = (n.fat_g ?? 0) * 0.3;
  if (satFat > 10) N += 10;
  else if (satFat > 7) N += 7;
  else if (satFat > 5) N += 5;
  else if (satFat > 3) N += 3;
  else if (satFat > 1) N += 1;

  // Sugar points
  const sugar = n.sugars_g ?? 0;
  if (sugar > 15) N += 10;
  else if (sugar > 10) N += 7;
  else if (sugar > 7) N += 5;
  else if (sugar > 4) N += 3;
  else if (sugar > 2) N += 1;

  // Sodium — estimate from calories (~0.3g per 100kcal)
  const sodium = kcal * 0.003;
  if (sodium > 0.9) N += 10;
  else if (sodium > 0.7) N += 7;
  else if (sodium > 0.5) N += 5;
  else if (sodium > 0.3) N += 3;
  else if (sodium > 0.1) N += 1;

  // Positive points (P)
  let P = 0;

  // Fiber
  const fiber = n.fiber_g ?? 0;
  if (fiber > 4.7) P += 5;
  else if (fiber > 3.0) P += 3;
  else if (fiber > 1.5) P += 2;
  else if (fiber > 0.7) P += 1;

  // Protein
  const protein = n.protein_g ?? 0;
  if (protein > 8) P += 5;
  else if (protein > 5) P += 3;
  else if (protein > 3) P += 2;
  else if (protein > 1.5) P += 1;

  const score = N - P;
  if (score <= -1) return "A";
  if (score <= 2) return "B";
  if (score <= 10) return "C";
  if (score <= 18) return "D";
  return "E";
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

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

interface USDAFood {
  description: string;
  foodNutrients: { nutrientName: string; value: number }[];
  servingSize?: number;
  servingSizeUnit?: string;
  foodCategory?: string;
}

async function searchUSDA(query: string): Promise<NutritionResult[]> {
  const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY';
  try {
    const res = await fetch(
      `${USDA_SEARCH_URL}?query=${encodeURIComponent(query)}&api_key=${apiKey}&pageSize=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.foods || []).slice(0, 5).map((f: USDAFood) => {
      const nutrients: Record<string, number> = {};
      (f.foodNutrients || []).forEach((n) => {
        const name = n.nutrientName?.toLowerCase() || '';
        if (name.includes('energy')) nutrients.calories = Math.round(n.value);
        if (name.includes('protein')) nutrients.protein = Math.round(n.value * 10) / 10;
        if (name.includes('total fat')) nutrients.fat = Math.round(n.value * 10) / 10;
        if (name.includes('carbohydrate')) nutrients.carbs = Math.round(n.value * 10) / 10;
        if (name.includes('fiber')) nutrients.fiber = Math.round(n.value * 10) / 10;
        if (name.includes('sugars')) nutrients.sugars = Math.round(n.value * 10) / 10;
      });
      const result: NutritionResult = {
        name: f.description || query,
        calories: nutrients.calories,
        protein_g: nutrients.protein,
        fat_g: nutrients.fat,
        carbs_g: nutrients.carbs,
        fiber_g: nutrients.fiber,
        sugars_g: nutrients.sugars,
        source: 'usda',
      };
      result.nutri_score = calculateNutriScore(result);
      return result;
    });
  } catch {
    return [];
  }
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
    const barcode = (body.barcode || '').trim();

    // Barcode lookup — direct product API
    if (barcode) {
      const productUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
      const res = await fetch(productUrl, {
        headers: { 'User-Agent': 'MenuLens - meal scanning app - 70186904@student.uol.edu.pk' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return Response.json({ results: [], error: 'Product not found' });
      }
      const data = await res.json();
      if (data.status !== 1 || !data.product) {
        return Response.json({ results: [], error: 'Product not found' });
      }
      const p = data.product;
      const n = p.nutriments || {};
      const result: NutritionResult = {
        name: p.product_name || 'Unknown Product',
        calories: n['energy-kcal_100g'] ? Math.round(n['energy-kcal_100g']) : undefined,
        protein_g: n.proteins_100g ? Math.round(n.proteins_100g * 10) / 10 : undefined,
        fat_g: n.fat_100g ? Math.round(n.fat_100g * 10) / 10 : undefined,
        carbs_g: n.carbohydrates_100g ? Math.round(n.carbohydrates_100g * 10) / 10 : undefined,
        fiber_g: n.fiber_100g ? Math.round(n.fiber_100g * 10) / 10 : undefined,
        sugars_g: n.sugars_100g ? Math.round(n.sugars_100g * 10) / 10 : undefined,
        serving_size: p.serving_size || undefined,
        image_url: p.image_front_small_url || undefined,
        source: 'openfoodfacts',
        barcode: p.code || barcode,
      };
      result.nutri_score = calculateNutriScore(result);
      return Response.json({ dish_name: result.name, results: [result], cached: false });
    }

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
      const result: NutritionResult = {
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
      result.nutri_score = calculateNutriScore(result);
      return result;
    });

    // Fallback: if OFF returned nothing, try USDA Food Data Central
    if (results.length === 0) {
      logger.info(`[Nutrition] No OFF results for "${searchTerm}", trying USDA...`);
      const usdaResults = await searchUSDA(searchTerm);
      if (usdaResults.length > 0) {
        setCache(cacheKey, usdaResults);
        return Response.json({ dish_name: dishName, results: usdaResults, cached: false, source: 'usda' });
      }
    }

    // Cache results
    setCache(cacheKey, results);

    return Response.json({ dish_name: dishName, results, cached: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Nutrition] API error: ${message}`);
    return Response.json({ error: message, results: [] }, { status: 500 });
  }
}
