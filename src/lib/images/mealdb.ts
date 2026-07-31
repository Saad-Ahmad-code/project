/** TheMealDB image provider. */
export async function searchMealDB(query: string): Promise<{ url: string; source: string }[]> {
  try {
    const res = await fetch(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const meals = data.meals || [];

    return meals
      .filter((meal: { strMealThumb?: string }) => meal.strMealThumb)
      .map((meal: { strMealThumb: string }) => ({
        url: meal.strMealThumb,
        source: "mealdb",
      }));
  } catch {
    return [];
  }
}
