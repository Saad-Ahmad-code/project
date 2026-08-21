import { NextRequest, NextResponse } from "next/server";
import { chatCompletions } from "@/lib/ai/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/error-handler";
import { sanitizeErrorMessage } from "@/lib/utils";
import { requireCsrf } from "@/lib/csrf";
import { db } from "@/lib/storage";

/** Shape of the AI-generated dish details, persisted on the dish doc. */
interface DishDetailsData {
  detailed_description: string;
  ingredients: string[];
  preparation: string;
  serving_suggestions: string;
  fun_fact: string;
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = requireCsrf(request);
    if (csrfError) return csrfError;

    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { dishName, category, origin, description, id, regenerate } = await request.json();

    if (!dishName?.trim()) {
      return NextResponse.json({ error: "Dish name is required" }, { status: 400 });
    }

    // Persistent cache: if this dish's details were already generated
    // (and stored on its doc), return them — generate once ever, not once
    // per server session or per click.
    if (id && !regenerate) {
      try {
        const dish = await db.findById("dishes", id);
        const existing = (dish as Record<string, unknown> | null)?.ai_details as DishDetailsData | undefined;
        if (existing?.detailed_description) {
          return NextResponse.json(existing);
        }
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
          content: `You are a professional menu copywriter for a restaurant. Given a dish name, write mouth-watering, appetizing menu descriptions in valid JSON format.

The description must read like it appears on a restaurant menu — evocative, flavorful, and enticing, describing what makes the dish delicious and how it's plated or served. Imagine describing the dish to a hungry customer who is about to order it. Keep it to 2-3 appetizing sentences. Do not write like an encyclopedia or food blog; write like a menu.

Return ONLY a valid JSON object with these fields:
{
  "detailed_description": "2-3 sentence appetizing menu-style description",
  "ingredients": ["ingredient1", ...],
  "preparation": "Brief description of how it's prepared",
  "serving_suggestions": "How it's served (e.g. 'Served hot with garlic naan')",
  "fun_fact": "Interesting fact"
}

No markdown, no code blocks, just the raw JSON.`,
        },
        {
          role: "user",
          content: `Write an appetizing menu description for: ${dishName}${contextStr}`,
        },
      ],
      temperature: 0.8,
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

    // Persist the generated details on the dish doc so re-clicks (even
    // after a server restart) return the cached result instead of paying
    // for another AI call. ai_description is the plain-text snippet for
    // cards; ai_details is the full structured object for the dialog.
    if (id) {
      try {
        db.update("dishes", id, {
          ai_details: data,
          ai_description: typeof data.detailed_description === "string"
            ? (data.detailed_description as string).slice(0, 300)
            : "",
        });
      } catch {
        // non-fatal: in-memory client cache still covers this session
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    logError(err, { endpoint: "/api/dishes/details" });
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
