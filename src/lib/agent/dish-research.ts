import { logger } from "@/lib/logger";
import { chatCompletions } from "@/lib/ai/client";

interface DishInfo {
  description: string;
  origin: string;
  dietary_tags: string[];
  images: { url: string; source: string }[];
}

export async function researchDish(dishName: string): Promise<DishInfo | null> {
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await chatCompletions({
        messages: [
          {
            role: "system",
            content: `You are a knowledgeable food expert and chef. Given a dish name, provide detailed information in valid JSON format. Be specific and accurate about ingredients and preparation.

Return ONLY a valid JSON object with these fields:
{
  "detailed_description": "2-3 sentence description of what the dish is, its flavors, and what makes it special",
  "ingredients": ["ingredient1", "ingredient2", ...],
  "preparation": "Brief description of how it's prepared (1-2 sentences)",
  "serving_suggestions": "How it's typically served, what to pair it with (1 sentence)",
  "fun_fact": "An interesting or surprising fact about this dish (1 sentence)"
}

No markdown, no code blocks, just the raw JSON.`,
          },
          {
            role: "user",
            content: `Tell me about: ${dishName}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const content = result.choices[0]?.message?.content;
      if (!content) {
        logger.warn(`[DishResearch] No content for "${dishName}"`);
        return null;
      }

      try {
        const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
        const data = JSON.parse(cleaned);
        return {
          description: data.detailed_description || content.slice(0, 300),
          origin: extractOrigin(data),
          dietary_tags: extractDietaryTags(data),
          images: [],
        };
      } catch {
        return {
          description: content.slice(0, 300),
          origin: "",
          dietary_tags: [],
          images: [],
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[DishResearch] Attempt ${attempt + 1} failed for "${dishName}": ${msg.slice(0, 100)}`);
      if (attempt === MAX_RETRIES - 1) return null;
    }
  }

  return null;
}

function extractOrigin(data: Record<string, unknown>): string {
  const desc = (data.detailed_description as string) || "";
  const originMatch = desc.match(/(?:from|originating in|native to|popular in)\s+([A-Za-z][A-Za-z\s]+?)(?:\.|,|$)/);
  return originMatch ? originMatch[1].trim() : "";
}

function extractDietaryTags(data: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const ingredients = (data.ingredients as string[]) || [];
  const desc = ((data.detailed_description as string) || "").toLowerCase();

  const vegetarian = ingredients.length > 0 && !ingredients.some((i) =>
    ["chicken", "beef", "pork", "fish", "shrimp", "meat", "lamb", "turkey", "duck", "bacon", "ham", "sausage"].includes(i.toLowerCase())
  );
  if (vegetarian) tags.push("vegetarian");

  if (desc.includes("vegan") || ingredients.every((i) => !["cheese", "cream", "butter", "milk", "egg", "yogurt", "honey"].some((d) => i.toLowerCase().includes(d)))) {
    if (vegetarian) tags.push("vegan");
  }

  if (desc.includes("gluten-free") || desc.includes("gluten free")) tags.push("gluten-free");
  if (desc.includes("dairy-free") || desc.includes("dairy free")) tags.push("dairy-free");
  if (desc.includes("nut-free") || desc.includes("nut free")) tags.push("nut-free");
  if (desc.includes("spicy") || desc.includes("hot")) tags.push("spicy");

  return tags;
}
