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
