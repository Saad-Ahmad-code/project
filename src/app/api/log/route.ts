import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

const logs: LogEntry[] = [];
const MAX_LOGS = 1000;

export async function POST(request: NextRequest) {
  try {
    // Rate limit so a runaway client can't flood the in-memory log buffer.
    if (!checkRateLimit(getClientIp(request), 60, 60_000, "log")) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await request.json();
    const entry: LogEntry = {
      level: body.level || "info",
      message: body.message || "",
      timestamp: new Date().toISOString(),
      data: body.data,
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid log entry" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ logs: logs.slice(-100) });
}
