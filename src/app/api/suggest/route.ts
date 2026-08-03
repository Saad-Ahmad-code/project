/**
 * AI Food Expert Suggestions (Offline-compatible)
 * POST /api/suggest
 * Body: { dishes: string[] }
 * Returns: Groq-powered food recommendations
 */

import { NextRequest, NextResponse } from "next/server";
import { chatCompletions } from "@/lib/ai/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/error-handler";
import { sanitizeErrorMessage } from "@/lib/utils";
import { requireCsrf } from "@/lib/csrf";

export async function POST(request: NextRequest) {
  try {
    const csrfError = requireCsrf(request);
    if (csrfError) return csrfError;

    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { dishes } = await request.json();

    if (!dishes || !Array.isArray(dishes) || dishes.length === 0) {
      return NextResponse.json({ error: "Provide at least one dish name" }, { status: 400 });
    }

    const dishList = dishes.join(", ");

    const result = await chatCompletions({
      messages: [
        {
          role: "system",
          content: `You are a world-class food expert and sommelier. Given a list of menu dishes, provide expert recommendations in valid JSON.

For each dish in top_picks, list potential allergens (gluten, dairy, nuts, soy, eggs, seafood, sesame). If the dish name suggests an allergen, flag it.

Return ONLY this JSON structure (no markdown, no code blocks):
{
  "top_picks": [
    { "name": "Dish Name", "reason": "Why this is a must-try (1 sentence)", "pairing": "Drink pairing suggestion", "allergens": ["gluten", "dairy"] }
  ],
  "must_try": "Single dish name that's the absolute best pick",
  "overview": "1-2 sentence summary of the menu's cuisine style and quality",
  "tips": ["Tip 1 about ordering", "Tip 2 about combinations", "Tip 3 about what to avoid or customize"]
}`,
        },
        {
          role: "user",
          content: `Here are the dishes available: ${dishList}. As a food expert, what should I order?`,
        },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const content = result.choices[0]?.message?.content || "";

    // Try to parse JSON, fallback to text
    try {
      const cleaned = content.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({ suggestions: parsed, raw: content });
    } catch {
      return NextResponse.json({ suggestions: null, raw: content });
    }
  } catch (err) {
    logError(err, { endpoint: "/api/suggest" });
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
