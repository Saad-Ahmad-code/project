import { NextRequest, NextResponse } from "next/server";
import { searchDishImages } from "@/lib/images";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/error-handler";
import { sanitizeErrorMessage } from "@/lib/utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ dish: string }> }) {
  try {
    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ images: [], error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { dish } = await params;
    let decoded: string;
    try {
      decoded = decodeURIComponent(dish);
    } catch {
      return NextResponse.json({ images: [], error: "Invalid dish name encoding" }, { status: 400 });
    }
    const images = await searchDishImages(decoded);
    return NextResponse.json({ images });
  } catch (err: any) {
    logError(err, { endpoint: "/api/images/[dish]/GET" });
    return NextResponse.json({ images: [], error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ dish: string }> }) {
  try {
    if (!checkRateLimit(getClientIp(request))) {
      return NextResponse.json({ images: [], error: "Too many requests. Wait a minute and try again." }, { status: 429 });
    }

    const { dish } = await params;
    let decoded: string;
    try {
      decoded = decodeURIComponent(dish);
    } catch {
      return NextResponse.json({ images: [], error: "Invalid dish name encoding" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const query = body.query || decoded;
    const images = await searchDishImages(query);
    return NextResponse.json({ images });
  } catch (err: any) {
    logError(err, { endpoint: "/api/images/[dish]/POST" });
    return NextResponse.json({ images: [], error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
