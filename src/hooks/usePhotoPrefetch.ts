"use client";

import { useEffect, useRef } from "react";

/**
 * Warm the server-side image cache (and browser HTTP cache) for the first
 * `limit` dishes, `concurrency` requests at a time, once `enabled` turns
 * true. Fire-and-forget: failures are ignored — tapping a dish always
 * triggers its own fetch, and the server TTL cache makes repeats free.
 */
export function usePhotoPrefetch(
  dishNames: string[],
  enabled: boolean,
  limit = 6,
  concurrency = 2
) {
  const startedRef = useRef(false);
  // Keep the latest names in a ref so the effect doesn't re-run (and reset
  // its start delay) every time the parent's poll cycle produces a new array
  // with identical contents.
  const namesRef = useRef(dishNames);
  namesRef.current = dishNames;

  useEffect(() => {
    if (!enabled || startedRef.current || dishNames.length === 0) return;

    // Small delay so the dish grid paints (and scan polling/enrichment
    // requests finish) before background photo warming starts.
    const timer = setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;

      const queue = namesRef.current.slice(0, limit);
      let active = 0;

      const pump = () => {
        while (active < concurrency && queue.length > 0) {
          const name = queue.shift()!;
          active++;
          fetch(`/api/images/${encodeURIComponent(name)}`)
            .then((res) => res.json().catch(() => null))
            .catch(() => {})
            .finally(() => {
              active--;
              pump();
            });
        }
      };
      pump();
    }, 1000);

    return () => clearTimeout(timer);
  }, [enabled, limit, concurrency]);
}
