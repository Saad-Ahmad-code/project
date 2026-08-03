/**
 * Pollinations.ai image generator — keyless fallback source.
 *
 * Generates an image from a text prompt (dish name), so it works for ANY
 * dish — including ones no stock-photo source covers. Generation is cached
 * server-side; the returned URL is a direct image link.
 *
 * Weighted low in the orchestrator: real photos beat generated ones, so this
 * only wins when the keyed sources (Unsplash/Pexels/Bing) are unset or fail.
 */
export async function searchPollinations(
  query: string,
  signal?: AbortSignal
): Promise<{ url: string; source: string }[]> {
  try {
    const prompt = `${query}, food photography, plated dish`;
    const results: { url: string; source: string }[] = [];

    // Two seeds → variety for the scorer to pick between.
    for (const seed of [1, 2]) {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        prompt
      )}?width=512&height=512&nologo=true&seed=${seed}`;

      // Hit the URL once to trigger (and verify) generation before returning it.
      const res = await fetch(url, { signal });
      if (res.ok && (res.headers.get("content-type") || "").includes("image")) {
        results.push({ url, source: "pollinations" });
      }
    }

    return results;
  } catch {
    return [];
  }
}
