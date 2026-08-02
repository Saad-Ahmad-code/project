import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/storage";

export async function POST(request: NextRequest) {
  try {
    const { scanId, targetId } = await request.json();

    if (!scanId || !targetId) {
      return NextResponse.json({ error: "Both scanId and targetId required" }, { status: 400 });
    }

    if (typeof scanId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(scanId)) {
      return NextResponse.json({ error: "Invalid scanId format" }, { status: 400 });
    }

    if (typeof targetId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(targetId)) {
      return NextResponse.json({ error: "Invalid targetId format" }, { status: 400 });
    }

    const [scan1, scan2] = await Promise.all([
      db.findById("scans", scanId),
      db.findById("scans", targetId),
    ]);

    if (!scan1 || !scan2) {
      return NextResponse.json({ error: "One or both scans not found" }, { status: 404 });
    }

    const [dishes1, dishes2] = await Promise.all([
      db.findBy<{ name: string; price?: number }>("dishes", { scan_id: scanId }),
      db.findBy<{ name: string; price?: number }>("dishes", { scan_id: targetId }),
    ]);

    const combined = new Map<string, { price1: number; price2: number; scan_id1: string; scan_id2: string }>();
    for (const d of dishes1) {
      combined.set(d.name, { price1: d.price || 0, price2: 0, scan_id1: scanId, scan_id2: "" });
    }
    for (const d of dishes2) {
      const existing = combined.get(d.name);
      if (existing) {
        existing.price2 = d.price || 0;
        existing.scan_id2 = targetId;
      } else {
        combined.set(d.name, { price1: 0, price2: d.price || 0, scan_id1: "", scan_id2: targetId });
      }
    }

    const dishes: { name: string; price1: number; price2: number; scan_id1: string; scan_id2: string }[] = [];
    combined.forEach((v, k) => dishes.push({ name: k, price1: v.price1, price2: v.price2, scan_id1: v.scan_id1, scan_id2: v.scan_id2 }));
    dishes.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      label: `Comparing ${scanId.slice(-6)} vs ${targetId.slice(-6)}`,
      dishes,
    });
  } catch {
    return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
  }
}
