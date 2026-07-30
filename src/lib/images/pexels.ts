import { FOOD_KEYWORDS } from "@/lib/images/keywords";
import { logger } from "@/lib/logger";

export async function searchPexels(query: string): Promise<{ url: string; source: string }[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query + " food")}&per_page=5`,
      { headers: { Authorization: apiKey } }
    );

    if (!res.ok) {
      if (res.status === 429) {
        logger.warn("[Pexels] Rate limited");
        return [];
      }
      return [];
    }

    const data = await res.json();
    const photos = data.photos || [];

    return photos
      .filter((img: { alt?: string }) => {
        const desc = (img.alt || "").toLowerCase();
        const foodHits = FOOD_KEYWORDS.filter((kw) => desc.includes(kw)).length;
        return foodHits >= 1;
      })
      .map((img: { src: { large: string }; photographer?: string }) => ({
        url: img.src.large,
        source: "pexels",
      }));
  } catch {
    return [];
  }
}
