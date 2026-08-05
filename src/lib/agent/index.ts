/**
 * Scan enrichment — orchestrates dish research + image search for a scan
 * and persists enriched fields back to the dishes collection.
 */
import { logger } from "@/lib/logger";
import { searchDishImages } from "@/lib/images";
import { chatCompletions } from "@/lib/ai/client";
import { ENRICHMENT_CONCURRENCY } from "@/lib/config";
import type { DishResult } from "@/types/menu";

interface MenuItemInput {
  /** Stored dish id (from the dishes collection) — preserved so enrichment writes back to the same doc */
  id?: string;
  name: string;
  description?: string;
  price?: number;
  category?: string;
}
export type { MenuItemInput };

export async function runAgent(
  items: MenuItemInput[],
  scanId: string,
  onProgress?: (done: number, total: number, dish: string) => void
): Promise<{ summary: string; dishes: DishResult[]; dishErrors: Record<string, string> }> {
  // Bounded worker pool: research + image search per dish hits external APIs
  // (AI provider + up to 6 image sources); a 40-dish menu must not fire 80
  // concurrent requests. Results stay positional so output order matches
  // input order regardless of completion order.
  const results = new Array<DishResult>(items.length);
  const dishErrors: Record<string, string> = {};
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];

      try {
        // Descriptions are generated ON DEMAND when the user clicks a dish
        // (POST /api/dishes/details) — deliberately skipping the per-dish AI
        // research call here saves one AI call per dish and lets scans
        // complete in seconds instead of minutes (a 40-dish menu previously
        // cost 40 AI calls before any dish was even viewed). Image search
        // still runs so cards have photos immediately.
        onProgress?.(index + 1, items.length, item.name);

        let images: string[] = [];
        try {
          const imageResults = await searchDishImages(item.name);
          images = imageResults.map((img) => img.url);
        } catch (err) {
          logger.warn(`[Agent] Image search failed for "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
        }

        results[index] = {
          id: item.id || `${scanId}-${index}-${Date.now().toString(36)}`,
          name: item.name,
          description: item.description,
          ai_description: "",
          price: item.price,
          category: item.category || "other",
          origin: "",
          dietary_tags: [],
          images,
          confidence: 0.9,
        } as DishResult;
      } catch (err) {
        logger.warn(`[Agent] Research failed for "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
        dishErrors[item.name] = err instanceof Error ? err.message : String(err);
        // Same failure shape as the old Promise.allSettled path: a random id
        // makes the queue's write-back (db.update by id) a no-op, so the
        // original dish doc stays untouched.
        results[index] = {
          id: `${scanId}-${Math.random().toString(36).slice(2, 8)}`,
          name: "Unknown Dish",
          description: "",
          price: undefined,
          category: "other",
          origin: "",
          dietary_tags: [],
          images: [],
          confidence: 0.5,
        } as DishResult;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ENRICHMENT_CONCURRENCY, items.length) }, () => worker())
  );

  const dishes = results;

  let summary = "";
  try {
    const result = await chatCompletions({
      messages: [
        {
          role: "system",
          content: "You are a food writer. Create a very brief 1-2 sentence summary of the following restaurant menu dishes.",
        },
        {
          role: "user",
          content: `Menu items: ${dishes.map((d) => d.name).join(", ")}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 150,
    });
    summary = result.choices[0]?.message?.content || "";
  } catch {
    summary = `Menu with ${dishes.length} items`;
  }

  return { summary, dishes, dishErrors };
}
