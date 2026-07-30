import { NextRequest, NextResponse } from "next/server";

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
