import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { db } from "@/lib/storage";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    // Privacy: a logged-in user only ever sees THEIR scans. Anonymous visitors
    // get an empty list — the pre-change behavior (every scan in the DB,
    // including other users' and anonymous users' menus) was a leak. Scans are
    // still reachable by id via /api/scan/[id] (unguessable id = capability).
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;

    let scans: any[] = [];
    let total = 0;

    if (userId) {
      const all = db.findBy<any>("scans", { user_id: userId });
      total = all.length;
      scans = all
        .sort(
          (a, b) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        )
        .slice(offset, offset + limit);
    }

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
