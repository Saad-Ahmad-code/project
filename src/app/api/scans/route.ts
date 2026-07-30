import { NextResponse } from "next/server";
import { db } from "@/lib/storage";

export async function GET() {
  try {
    const scans = await db.findAll("scans", 50);
    // Normalize _id → id for frontend consumption
    const normalized = scans.map((s: any) => ({
      id: s._id || s.id,
      items_count: s.items_count || s.dishes?.length || 0,
      created_at: s.created_at || s.createdAt || "",
      status: s.status || "completed",
      user_id: s.user_id || "anonymous",
    }));
    return NextResponse.json({ scans: normalized });
  } catch {
    return NextResponse.json({ scans: [] });
  }
}
