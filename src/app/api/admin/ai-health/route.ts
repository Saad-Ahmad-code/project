/**
 * Admin AI Health endpoint.
 * GET /api/admin/ai-health — probes each configured AI provider with a
 * lightweight chat completion (max_tokens=1, minimal prompt) and reports
 * latency + availability. Session-gated like the other admin routes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { providers, getCloudflareBaseURL } from '@/lib/ai/providers';
import { AI_REQUEST_TIMEOUT_MS } from '@/lib/config';
import { logger } from '@/lib/logger';

async function requireAdmin(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions);
    return !!session && (session.user as { isAdmin?: boolean }).isAdmin === true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Group providers by apiKeyEnv so each configured key gets one probe
  // (the first provider using that key).
  const probed = new Set<string>();
  const results: {
    name: string;
    ok: boolean;
    latencyMs: number;
    error?: string;
  }[] = [];

  for (const provider of providers) {
    if (probed.has(provider.apiKeyEnv)) continue;
    probed.add(provider.apiKeyEnv);

    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) {
      results.push({ name: provider.name, ok: false, latencyMs: 0, error: `No ${provider.apiKeyEnv} configured` });
      continue;
    }

    const baseURL = provider.name === 'cloudflare' ? getCloudflareBaseURL() : provider.baseURL;
    const url = `${baseURL}/chat/completions`;
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...provider.headers,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - start;
      results.push({
        name: provider.name,
        ok: res.ok,
        latencyMs,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      });
      if (res.ok) logger.info(`[AI-Health] ${provider.name} OK (${latencyMs}ms)`);
      else logger.warn(`[AI-Health] ${provider.name} failed: HTTP ${res.status}`);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const msg = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? `Timeout after ${AI_REQUEST_TIMEOUT_MS}ms`
        : err?.message || String(err);
      results.push({ name: provider.name, ok: false, latencyMs, error: msg });
      logger.warn(`[AI-Health] ${provider.name} failed: ${msg}`);
    }
  }

  return NextResponse.json({
    healthy: results.some((r) => r.ok),
    checked: results.length,
    results,
    ts: new Date().toISOString(),
  });
}
