import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const database = await getDatabase();
    const scan = await database.collection("scans").findOne({ id });
    const items = await database.collection("dishes").find({ scan_id: id }).toArray();
    return NextResponse.json({ scan, items });
  } catch {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
}
