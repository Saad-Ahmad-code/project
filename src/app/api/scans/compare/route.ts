import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/storage";

export async function POST(request: NextRequest) {
  try {
    const { scanId, targetId } = await request.json();

    if (!scanId || !targetId) {
      return NextResponse.json({ error: "Both scanId and targetId required" }, { status: 400 });
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

    const combined = new Map<string, { price: number; scan_id: string }>();
    for (const d of dishes1) {
      combined.set(d.name, { price: d.price || 0, scan_id: scanId });
    }
    for (const d of dishes2) {
      if (!combined.has(d.name)) {
        combined.set(d.name, { price: d.price || 0, scan_id: targetId });
      }
    }

    const dishes: { name: string; price: number; scan_id: string }[] = [];
    combined.forEach((v, k) => dishes.push({ name: k, price: v.price, scan_id: v.scan_id }));
    dishes.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      label: `Comparing ${scanId.slice(-6)} vs ${targetId.slice(-6)}`,
      dishes,
    });
  } catch {
    return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
  }
}
