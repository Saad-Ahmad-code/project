/**
 * Health & Diagnostics API
 * GET /api/diagnostics — runs all checks
 * GET /api/diagnostics/log — shows recent errors
 * POST /api/diagnostics/report — log an error from the frontend
 */
import { NextRequest, NextResponse } from 'next/server';
import { runDiagnostics, getErrorLog, logError } from '@/lib/error-handler';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'full';

  if (mode === 'log') {
    const count = parseInt(searchParams.get('count') || '10', 10);
    const logs = getErrorLog(count);
    // Also check persisted logs
    const fs = require('fs');
    const logFile = process.cwd() + '/data/logs/errors.jsonl';
    const persisted: any[] = [];
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines.slice(-count)) {
        try { persisted.push(JSON.parse(line)); } catch {}
      }
    }
    return NextResponse.json({ in_memory: logs, persisted });
  }

  if (mode === 'quick') {
    const { db } = await (await import('@/lib/mongodb')).connectToDatabase();
    const scanCount = db('scans').countDocuments();
    const dishCount = db('dishes').countDocuments();
    return NextResponse.json({
      status: 'ok',
      storage: 'local-json',
      node: process.version,
      scans: scanCount,
      dishes: dishCount,
    });
  }

  // Full diagnostics
  const result = await runDiagnostics();
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { error, context } = body;
    if (error) {
      logError(error, context);
      return NextResponse.json({ logged: true });
    }
    return NextResponse.json({ logged: false, reason: 'No error provided' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ logged: false, error: err.message }, { status: 500 });
  }
}
