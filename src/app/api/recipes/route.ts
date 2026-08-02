/**
 * Recipe API — TheMealDB Integration
 *
 * Free, open recipe database. No API key needed.
 * GET /api/recipes?dish=<name>
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const MEALDB_URL = 'https://www.themealdb.com/api/json/v1/1/search.php';

export interface RecipeResult {
  name: string;
  image_url: string;
  category: string;
  area: string;
  instructions: string;
  ingredients: { name: string; measure: string }[];
  tags?: string[];
  source?: string;
}

export async function GET(request: NextRequest) {
  try {
    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ recipes: [], error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
    }

    const url = new URL(request.url);
    const dish = url.searchParams.get('dish')?.trim();

    if (!dish || dish.length < 2 || dish.length > 200) {
      return NextResponse.json({ error: 'dish parameter must be 2-200 characters' }, { status: 400 });
    }

    const res = await fetch(
      `${MEALDB_URL}?s=${encodeURIComponent(dish)}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      return NextResponse.json({ recipes: [], error: 'Recipe service unavailable' });
    }

    const data = await res.json();
    const meals = data.meals || [];

    if (meals.length === 0) {
      return NextResponse.json({ recipes: [] });
    }

    const recipes: RecipeResult[] = meals.slice(0, 3).map((meal: any) => {
      const ingredients: { name: string; measure: string }[] = [];
      for (let i = 1; i <= 20; i++) {
        const name = meal[`strIngredient${i}`];
        const measure = meal[`strMeasure${i}`];
        if (name && name.trim()) {
          ingredients.push({ name: name.trim(), measure: (measure || '').trim() });
        }
      }

      return {
        name: meal.strMeal,
        image_url: meal.strMealThumb || '',
        category: meal.strCategory || '',
        area: meal.strArea || '',
        instructions: meal.strInstructions || '',
        ingredients,
        tags: meal.strTags ? meal.strTags.split(',').map((t: string) => t.trim()) : undefined,
        source: meal.strSource || undefined,
      };
    });

    return NextResponse.json({ recipes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Recipes] API error: ${message}`);
    return NextResponse.json({ error: message, recipes: [] }, { status: 500 });
  }
}
