import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

async function requireAdmin(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions);
    return !!session && (session.user as { isAdmin?: boolean }).isAdmin === true;
  } catch {
    return false;
  }
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { db } = await import("@/lib/storage");

    const totalScans = await db.count("scans");
    const totalDishes = await db.count("dishes");
    const completedScans = await db.count("scans", { status: "completed" });

    // Daily scan volume for last 7 days
    const allScans = db.findAll<any>("scans", 500);
    const today = new Date();
    const dailyCounts: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyCounts[key] = 0;
    }
    for (const scan of allScans) {
      const created = scan.created_at || scan.createdAt;
      if (created) {
        const day = new Date(created).toISOString().slice(0, 10);
        if (day in dailyCounts) dailyCounts[day]++;
      }
    }
    const dailyVolume = Object.entries(dailyCounts).map(([date, count]) => ({ date, count }));

    // Recent scans for the table
    const recentScans = db
      .findAll<any>("scans", 10)
      .sort((a: any, b: any) => {
        const aDate = a.created_at || a.createdAt || "";
        const bDate = b.created_at || b.createdAt || "";
        return bDate.localeCompare(aDate);
      })
      .slice(0, 10)
      .map((s: any) => ({
        id: s._id || s.id,
        date: s.created_at || s.createdAt || "unknown",
        items: s.items_count || s.dishes?.length || 0,
        status: s.status || "completed",
        userId: s.user_id || "anonymous",
      }));

    return NextResponse.json({ totalScans, totalDishes, completedScans, dailyVolume, recentScans });
  } catch {
    return NextResponse.json({
      totalScans: 0,
      totalDishes: 0,
      completedScans: 0,
      dailyVolume: [] as { date: string; count: number }[],
      recentScans: [],
    });
  }
}
