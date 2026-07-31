/** Local curated image URL database — reliable fallback per dish keyword. */
const LOCAL_DB: Record<string, string[]> = {
  pizza: ["https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400"],
  pasta: ["https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400"],
  burger: ["https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400"],
  salad: ["https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400"],
  steak: ["https://images.unsplash.com/photo-1600891964092-4316c288032e?w=400"],
  soup: ["https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400"],
  sushi: ["https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400"],
  dessert: ["https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400"],
  coffee: ["https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400"],
  tea: ["https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400"],
};

export async function searchLocalDB(query: string): Promise<{ url: string; source: string }[]> {
  const lower = query.toLowerCase();
  for (const [key, urls] of Object.entries(LOCAL_DB)) {
    if (lower.includes(key)) {
      return urls.map((url) => ({ url, source: "local" }));
    }
  }
  return [];
}
