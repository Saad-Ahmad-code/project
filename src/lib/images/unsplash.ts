/** Unsplash image provider. */
import { FOOD_KEYWORDS } from "@/lib/images/keywords";
import { logger } from "@/lib/logger";

export async function searchUnsplash(query: string): Promise<{ url: string; source: string }[]> {
  const apiKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query + " food")}&per_page=5`,
      { headers: { Authorization: `Client-ID ${apiKey}` } }
    );

    if (!res.ok) {
      if (res.status === 403) {
        logger.warn("[Unsplash] Rate limited");
        return [];
      }
      return [];
    }

    const data = await res.json();
    const results = data.results || [];

    return results
      .filter((img: { description?: string; alt_description?: string }) => {
        const desc = ((img.description || "") + " " + (img.alt_description || "")).toLowerCase();
        const foodHits = FOOD_KEYWORDS.filter((kw) => desc.includes(kw)).length;
        return foodHits >= 1;
      })
      .map((img: { urls: { regular: string } }) => ({
        url: img.urls.regular,
        source: "unsplash",
      }));
  } catch {
    return [];
  }
}
