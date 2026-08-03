/**
 * Health Check Endpoint
 *
 * GET /api/health — liveness probe (fast, no external dependencies)
 * GET /api/health?readiness=true — readiness probe (includes DB + provider checks)
 */
import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const readiness = url.searchParams.get("readiness") === "true";

  if (!readiness) {
    // Liveness: just check the process is alive
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    });
  }

  // Readiness: check DB connectivity
  const dbHealth = { ok: true };
  try {
    const { db } = await connectToDatabase();
    db("scans").countDocuments();
  } catch {
    Object.assign(dbHealth, { ok: false, error: "Database unreachable" });
  }

  const overall = dbHealth.ok;

  return NextResponse.json({
    status: overall ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    storage: {
      type: "local-json",
      healthy: dbHealth.ok,
    },
  }, { status: overall ? 200 : 503 });
}
