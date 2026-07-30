import { NextResponse } from "next/server";
import { db } from "@/lib/storage";

export async function GET() {
  try {
    const scans = await db.findAll("scans", 50);
    return NextResponse.json({ scans });
  } catch {
    return NextResponse.json({ scans: [] });
  }
}
