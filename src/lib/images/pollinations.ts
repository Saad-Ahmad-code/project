export async function searchPollinations(query: string): Promise<{ url: string; source: string }[]> {
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(query + " food dish restaurant quality")}`;
    return [{ url, source: "pollinations" }];
  } catch {
    return [];
  }
}
