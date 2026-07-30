import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { db } = await import("@/lib/storage");

    const totalScans = await db.count("scans");
    const totalDishes = await db.count("dishes");
    const completedScans = await db.count("scans", { status: "completed" });

    return NextResponse.json({ totalScans, totalDishes, completedScans });
  } catch {
    return NextResponse.json({ totalScans: 0, totalDishes: 0, completedScans: 0 });
  }
}
