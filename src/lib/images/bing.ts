import { logger } from "@/lib/logger";

export async function searchBing(query: string): Promise<{ url: string; source: string }[]> {
  const apiKey = process.env.BING_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(query + " food dish")}&count=5`,
      { headers: { "Ocp-Apim-Subscription-Key": apiKey } }
    );

    if (!res.ok) return [];

    const data = await res.json();
    const results = data.value || [];

    return results.map((img: { contentUrl: string }) => ({
      url: img.contentUrl,
      source: "bing",
    }));
  } catch {
    return [];
  }
}
