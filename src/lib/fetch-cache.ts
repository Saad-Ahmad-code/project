const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 300_000;

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  cache.delete(key);
  return null;
}

export function setCache<T>(key: string, data: T): void {
  if (cache.size >= 100) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { data, ts: Date.now() });
}

export function clearCache(): void {
  cache.clear();
}