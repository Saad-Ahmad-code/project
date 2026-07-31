/** Wikipedia/Wikimedia Commons image provider. */
export async function searchWikipedia(query: string): Promise<{ url: string; source: string }[]> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(query)}&prop=pageimages&format=json&pithumbsize=500&origin=*`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const pages = data.query?.pages || {};
    const images: { url: string; source: string }[] = [];

    for (const pageId of Object.keys(pages)) {
      const page = pages[pageId];
      if (page.thumbnail?.source) {
        images.push({ url: page.thumbnail.source, source: "wikipedia" });
      }
    }

    return images;
  } catch {
    return [];
  }
}
