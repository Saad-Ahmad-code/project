import { NextRequest, NextResponse } from "next/server";
import { chatCompletions } from "@/lib/ai/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { dishName, category, origin, description } = await request.json();

    if (!dishName?.trim()) {
      return NextResponse.json({ error: "Dish name is required" }, { status: 400 });
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
          content: `You are a knowledgeable food expert and chef. Given a dish name, provide detailed information in valid JSON format.

Return ONLY a valid JSON object with these fields:
{
  "detailed_description": "2-3 sentence description",
  "ingredients": ["ingredient1", ...],
  "preparation": "Brief description",
  "serving_suggestions": "How it's served",
  "fun_fact": "Interesting fact"
}

No markdown, no code blocks, just the raw JSON.`,
        },
        {
          role: "user",
          content: `Tell me about: ${dishName}${contextStr}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = result.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let data: Record<string, unknown>;
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

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get dish details";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
