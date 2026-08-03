"use client";

/**
 * useDebounce — returns a debounced copy of `value` that only updates
 * `delay` ms after the last change. Used to smooth rapid filter toggles
 * (dietary pills) so the items list re-renders at most once per burst.
 */
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
