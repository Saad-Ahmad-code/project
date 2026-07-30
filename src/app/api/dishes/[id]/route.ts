import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/storage";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dish = await db.findById("dishes", id);
    if (!dish) return NextResponse.json({ error: "Dish not found" }, { status: 404 });
    return NextResponse.json(dish);
  } catch {
    return NextResponse.json({ error: "Failed to fetch dish" }, { status: 500 });
  }
}
