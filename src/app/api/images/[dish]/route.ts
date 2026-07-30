import { NextRequest, NextResponse } from "next/server";
import { searchDishImages } from "@/lib/images";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ dish: string }> }) {
  try {
    const { dish } = await params;
    let decoded: string;
    try {
      decoded = decodeURIComponent(dish);
    } catch {
      return NextResponse.json({ images: [] });
    }
    const images = await searchDishImages(decoded);
    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ images: [] });
  }
}
