export async function searchOpenverse(query: string): Promise<{ url: string; source: string }[]> {
  try {
    const res = await fetch(
      `https://api.openverse.engineering/v1/images/?q=${encodeURIComponent(query + " food")}&page_size=5`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const results = data.results || [];

    return results.map((img: { url: string }) => ({
      url: img.url,
      source: "openverse",
    }));
  } catch {
    return [];
  }
}
