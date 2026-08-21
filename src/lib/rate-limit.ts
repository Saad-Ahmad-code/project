/**
 * Shared rate limiting for API routes.
 *
 * In-memory per-process sliding-window limiter keyed by client IP. The scan
 * endpoint used to carry its own private copy; AI-backed routes (suggest,
 * translate, nutrition, recipes, dishes/details, classify, images) were
 * completely unprotected, so anyone could burn provider credits or spawn
 * subprocesses at will. All of them now go through this helper.
 *
 * Note: state is in-memory (per process, resets on restart) — good enough for
 * a local/single-instance deployment; swap for a persistent store if the app
 * is ever deployed multi-instance.
 */

import type { NextRequest } from "next/server";

const store = new Map<string, { count: number; resetAt: number }>();
const MAX_ENTRIES = 10_000;

export function getClientIp(request: NextRequest): string {
  return (
    (request as any).ip ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Returns true when the request is allowed, false when it exceeds `max`
 * requests within `windowMs`. Prunes expired entries when the store grows
 * past MAX_ENTRIES so a burst of distinct IPs can't leak memory forever.
 *
 * `bucket` namespaces the counter (e.g. "images" vs "scans") so browsing
 * photo galleries doesn't eat the scan budget — previously ALL routes
 * shared one 10/min pool per IP and heavy gallery use caused spurious 429s
 * on unrelated endpoints.
 */
export function checkRateLimit(
  ip: string,
  max = 10,
  windowMs = 60_000,
  bucket = "default"
): boolean {
  if (store.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }

  const now = Date.now();
  const key = `${bucket}:${ip}`;
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
