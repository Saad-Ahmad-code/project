/**
 * Shared AI dish-details generator — used by POST /api/dishes/details
 * (on-demand click) and the enrichment pre-warm (first N dishes per scan,
 * queue.ts). Generates once per dish doc, persists ai_details + a short
 * ai_description snippet, and returns the cached copy on later calls.
 *
 * Output is kept SHORT (max_tokens 200, one or two sentences per field) so
 * generation is fast on a local Ollama model — the original 500-token
 * prompt made each click take 10-20s.
 */
import { chatCompletions } from "@/lib/ai/client";
import { db } from "@/lib/storage";
import { logger } from "@/lib/logger";

export interface DishDetailsData {
  detailed_description: string;
  ingredients: string[];
  preparation: string;
  serving_suggestions: string;
  fun_fact: string;
}

export async function generateDishDetails(input: {
  dishName: string;
  category?: string;
  origin?: string;
  description?: string;
  id?: string;
  /** Skip the persistent cache read (used by "Regenerate descriptions") —
   *  fresh details are generated and re-persisted on the dish doc. */
  regenerate?: boolean;
}): Promise<DishDetailsData> {
  const { dishName, category, origin, description, id, regenerate } = input;

  // Persistent cache: generate once ever per dish doc, not once per click
  // or per server session — unless the caller explicitly asked for a
  // regeneration.
  if (id && !regenerate) {
    try {
      const dish = await db.findById("dishes", id);
      const existing = (dish as Record<string, unknown> | null)?.ai_details as DishDetailsData | undefined;
      if (existing?.detailed_description) return existing;
    } catch {
      // non-fatal: fall through to generation
    }
  }

  const context: string[] = [];
  if (category) context.push(`Category: ${category}`);
  if (origin) context.push(`Origin: ${origin}`);
  if (description) context.push(`Basic description: ${description}`);
  const contextStr = context.length > 0 ? `\n${context.join("\n")}` : "";

  const result = await chatCompletions({
    messages: [
      {
        role: "system",
        content: `You are a professional menu copywriter for a restaurant. Given a dish name, write an appetizing menu description.

Keep EVERY field short — this must generate fast:
- detailed_description: 1-2 mouth-watering sentences (write like a menu, not an encyclopedia)
- ingredients: at most 5 items
- preparation: one short sentence
- serving_suggestions: one short sentence (e.g. "Served hot with garlic naan")
- fun_fact: one short sentence

Return ONLY a valid JSON object:
{
  "detailed_description": "...",
  "ingredients": ["..."],
  "preparation": "...",
  "serving_suggestions": "...",
  "fun_fact": "..."
}
No markdown, no code blocks, just the raw JSON.`,
      },
      {
        role: "user",
        content: `Write an appetizing menu description for: ${dishName}${contextStr}`,
      },
    ],
    temperature: 0.6,
    max_tokens: 200,
  });

  const content = result.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  let data: DishDetailsData;
  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    data = JSON.parse(cleaned);
  } catch {
    data = {
      detailed_description: content.slice(0, 300),
      ingredients: [],
      preparation: "",
      serving_suggestions: "",
      fun_fact: "",
    };
  }

  if (id) {
    try {
      db.update("dishes", id, {
        ai_details: data,
        ai_description:
          typeof data.detailed_description === "string" ? data.detailed_description.slice(0, 300) : "",
      });
    } catch {
      // non-fatal: in-memory client cache still covers this session
      logger.warn(`[DishDetails] Failed to persist ai_details for dish ${id}`);
    }
  }

  return data;
}
