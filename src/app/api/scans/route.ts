import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/storage";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const total = db.count("scans");
    // findAll slices from the start; fetch offset+limit then drop the offset
    // so pagination works without growing the whole collection into memory.
    const scans = db.findAll("scans", offset + limit).slice(offset);
    // Normalize _id → id for frontend consumption
    const normalized = scans.map((s: any) => ({
      id: s._id || s.id,
      items_count: s.items_count || s.dishes?.length || 0,
      created_at: s.created_at || s.createdAt || "",
      status: s.status || "completed",
      user_id: s.user_id || "anonymous",
    }));
    return NextResponse.json({ scans: normalized, total, limit, offset });
  } catch {
    return NextResponse.json({ scans: [], total: 0 });
  }
}
