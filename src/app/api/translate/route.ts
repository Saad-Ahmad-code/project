/**
 * Menu Translation API
 * POST /api/translate
 * Body: { text: string, target_language: string }
 * Returns: Groq-powered translation of menu text
 */

import { NextRequest, NextResponse } from "next/server";
import { chatCompletions } from "@/lib/ai/client";

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
    const { text, target_language } = await request.json();

    if (!text || !target_language) {
      return NextResponse.json({ error: "Provide both 'text' and 'target_language'" }, { status: 400 });
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
    return NextResponse.json({ error: err.message || "Translation failed" }, { status: 500 });
  }
}
