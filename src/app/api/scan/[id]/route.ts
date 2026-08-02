import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { chatCompletions } from "@/lib/ai/client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const database = await getDatabase();
    const scan = await database.collection("scans").findOne({ _id: id });
    const items = await database.collection("dishes").find({ scan_id: id }).toArray();
    // Stored docs carry `_id` only (storage convention); the frontend (DishCard,
    // keys) expects `id` — normalize here so both old and new scans work.
    const normalizedItems = items.map((i: any) => ({ ...i, id: i._id || i.id }));
    return NextResponse.json({ scan, items: normalizedItems });
  } catch {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
}

/**
 * POST /api/scan/[id] — AI Food Expert Suggestions
 * Takes the scanned dishes and returns Groq-powered food recommendations
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const database = await getDatabase();
    const items = await database.collection("dishes").find({ scan_id: id }).toArray();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No dishes found for this scan" }, { status: 404 });
    }

    const dishList = items.map((i: any) => i.name).join(", ");

    const prompt = {
      messages: [
        {
          role: "system" as const,
          content: `You are a world-class food expert and sommelier. Given a list of menu dishes, provide expert recommendations in valid JSON.

Return ONLY this JSON structure (no markdown):
{
  "top_picks": [
    { "name": "Dish Name", "reason": "Why this is a must-try (1 sentence)", "pairing": "Drink pairing suggestion" }
  ],
  "must_try": "Single dish name that's the absolute best pick",
  "overview": "1-2 sentence summary of the menu's cuisine style and quality",
  "tips": ["Tip 1 about ordering", "Tip 2 about combinations", "Tip 3 about what to avoid or customize"]
}`,
        },
        {
          role: "user" as const,
          content: `Here are the dishes available: ${dishList}. As a food expert, what should I order?`,
        },
      ],
      temperature: 0.7,
      max_tokens: 800,
    };

    const result = await chatCompletions(prompt);
    const content = result.choices[0]?.message?.content || "";

    // Try to parse JSON, fallback to text
    try {
      const cleaned = content.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({ suggestions: parsed, raw: content });
    } catch {
      return NextResponse.json({ suggestions: null, raw: content });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to get suggestions" }, { status: 500 });
  }
}
