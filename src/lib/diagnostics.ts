/**
 * System diagnostics — health checks (no MongoDB dependency)
 */
import { connectToDatabase } from "@/lib/mongodb";

export async function checkDatabaseConnection() {
  const start = Date.now();
  try {
    const { db } = await connectToDatabase();
    db('scans').countDocuments();
    return { ok: true, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: String(err) };
  }
}

export async function checkAIService(name: string, url: string, apiKey?: string) {
  if (!apiKey) return { ok: false, error: "No API key configured" };
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Status ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Probe the local Ollama server: report reachability and which models are
 * installed. Uses the same URL resolution as src/lib/ocr/ollama.ts
 * (OLLAMA_URL env or the localhost default). Fail-soft — an unreachable
 * server returns ok:false with the error, never throws.
 */
export async function checkOllama(): Promise<{
  ok: boolean;
  url: string;
  models: string[];
  error?: string;
  latency?: number;
}> {
  const url = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const start = Date.now();
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { ok: false, url, models: [], error: `Status ${res.status}`, latency: Date.now() - start };
    }
    const tags = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (tags.models ?? []).map((m) => m.name).sort();
    return { ok: true, url, models, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, url, models: [], error: String(err), latency: Date.now() - start };
  }
}
