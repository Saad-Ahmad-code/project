/**
 * Recipe API — TheMealDB Integration
 *
 * Free, open recipe database. No API key needed.
 * GET /api/recipes?dish=<name>
 */

import { logger } from '@/lib/logger';

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dish = url.searchParams.get('dish')?.trim();

    if (!dish || dish.length < 2) {
      return Response.json({ error: 'dish parameter is required' }, { status: 400 });
    }

    const res = await fetch(
      `${MEALDB_URL}?s=${encodeURIComponent(dish)}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      return Response.json({ recipes: [], error: 'Recipe service unavailable' });
    }

    const data = await res.json();
    const meals = data.meals || [];

    if (meals.length === 0) {
      return Response.json({ recipes: [] });
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

    return Response.json({ recipes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Recipes] API error: ${message}`);
    return Response.json({ error: message, recipes: [] }, { status: 500 });
  }
}
