/**
 * Pollinations.ai image generator — keyless fallback source.
 *
 * Generates an image from a text prompt (dish name), so it works for ANY
 * dish — including ones no stock-photo source covers.
 *
 * IMPORTANT: the URL is returned IMMEDIATELY without waiting for generation.
 * Pollinations generates on first GET, which can take 10-30s — awaiting it
 * here made every dish's enrichment block for that long (the #1 cause of
 * slow scan results). Returning instantly keeps cards fast; the <img> tag
 * loads the image when it's ready and DishCard's onError hides failures.
 *
 * Weighted low in the orchestrator: real photos beat generated ones, so this
 * only wins when the keyed sources (Unsplash/Pexels/Bing) are unset or fail.
 */
export async function searchPollinations(
  query: string
): Promise<{ url: string; source: string }[]> {
  const prompt = `${query}, food photography, plated dish`;
  const results: { url: string; source: string }[] = [];

  // Two seeds → variety for the scorer to pick between.
  for (const seed of [1, 2]) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      prompt
    )}?width=512&height=512&nologo=true&seed=${seed}`;
    results.push({ url, source: "pollinations" });
  }

  return results;
}
