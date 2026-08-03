/**
 * Menu Translation API
 * POST /api/translate
 * Body: { text: string, target_language: string }
 * Returns: Groq-powered translation of menu text
 */

import { NextRequest, NextResponse } from "next/server";
import { chatCompletions } from "@/lib/ai/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/error-handler";
import { sanitizeErrorMessage } from "@/lib/utils";

const SUPPORTED_LANGUAGES: Record<string, string> = {
  english: "English",
  urdu: "Urdu",
  arabic: "Arabic",
  chinese: "Chinese",
  french: "French",
  spanish: "Spanish",
  german: "German",
  japanese: "Japanese",
};

export async function POST(request: NextRequest) {
  try {
    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { text, target_language } = await request.json();

    if (!text || !target_language) {
      return NextResponse.json({ error: "Provide both 'text' and 'target_language'" }, { status: 400 });
    }

    if (typeof text !== "string" || text.length > 10000) {
      return NextResponse.json({ error: "text must be a string under 10,000 characters" }, { status: 400 });
    }

    if (typeof target_language !== "string" || target_language.length > 50) {
      return NextResponse.json({ error: "target_language must be a string under 50 characters" }, { status: 400 });
    }

    const langName = SUPPORTED_LANGUAGES[target_language.toLowerCase()];
    if (!langName) {
      return NextResponse.json(
        { error: `Unsupported language. Supported: ${Object.keys(SUPPORTED_LANGUAGES).join(", ")}` },
        { status: 400 }
      );
    }

    const result = await chatCompletions({
      messages: [
        {
          role: "system",
          content: `You are a professional menu translator. Translate the given menu items and descriptions into ${langName}.

Return ONLY a JSON object with this structure (no markdown, no code blocks):
{
  "translated_text": "The full translated text",
  "language": "${langName}"
}

Keep dish names in their original language unless there's a well-known translation.
Translate descriptions, prices (keep numbers), and any other text.`,
        },
        {
          role: "user",
          content: `Translate this menu content to ${langName}:\n\n${text}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = result.choices[0]?.message?.content || "";

    try {
      const cleaned = content.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({ translation: parsed, raw: content });
    } catch {
      return NextResponse.json({ translation: { translated_text: content, language: langName }, raw: content });
    }
  } catch (err: any) {
    logError(err, { endpoint: "/api/translate" });
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
