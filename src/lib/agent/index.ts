import { logger } from "@/lib/logger";
import { researchDish } from "@/lib/agent/dish-research";
import { searchDishImages } from "@/lib/images";
import { chatCompletions } from "@/lib/ai/client";
import { DishResult } from "@/types/menu";

interface MenuItemInput {
  name: string;
  description?: string;
  price?: number;
  category?: string;
}

export async function runAgent(
  items: MenuItemInput[],
  scanId: string,
  onProgress?: (done: number, total: number, dish: string) => void
): Promise<{ summary: string; dishes: DishResult[] }> {
  const results = await Promise.allSettled(
    items.map(async (item, index) => {
      const info = await researchDish(item.name);
      onProgress?.(index + 1, items.length, item.name);

      let images: string[] = [];
      try {
        const imageResults = await searchDishImages(item.name);
        images = imageResults.map((img) => img.url);
      } catch (err) {
        logger.warn(`[Agent] Image search failed for "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
      }

      return {
        id: `${scanId}-${index}-${Date.now().toString(36)}`,
        name: item.name,
        description: item.description,
        ai_description: info?.description || "",
        price: item.price,
        category: item.category || "other",
        origin: info?.origin || "",
        dietary_tags: info?.dietary_tags || [],
        images,
        confidence: 0.9,
      } as DishResult;
    })
  );

  const dishes: DishResult[] = results.map((r) =>
    r.status === "fulfilled" ? r.value : {
      id: `${scanId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Unknown Dish",
      description: "",
      price: undefined,
      category: "other",
      origin: "",
      dietary_tags: [],
      images: [],
      confidence: 0.5,
    }
  );

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

  return { summary, dishes };
}
