"use client";

/**
 * React hook to access the CSRF token on the client side.
 *
 * The layout's warm-up script fetches /api/csrf/token once on page load and
 * stores it in a meta tag + sessionStorage. This hook reads that value
 * synchronously; it only fetches if the warm-up hasn't finished yet (e.g.
 * the very first render racing the script). The endpoint is idempotent, so
 * even a fallback fetch never invalidates the token.
 */
import { useEffect, useState } from "react";

/** Synchronously read the CSRF token (meta tag first, then sessionStorage). */
export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
    sessionStorage.getItem("csrf_token") ||
    null
  );
}

export function useCsrf(): string | null {
  const [token, setToken] = useState<string | null>(() => getCsrfToken());

  useEffect(() => {
    const existing = getCsrfToken();
    if (existing) {
      setToken(existing);
      return;
    }

    // Warm-up hasn't landed yet — fetch once (idempotent, no rotation).
    let cancelled = false;
    fetch("/api/csrf/token")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const t = (data?.token as string) || null;
        if (t) {
          sessionStorage.setItem("csrf_token", t);
          document.querySelector('meta[name="csrf-token"]')?.setAttribute("content", t);
        }
        setToken(t);
      })
      .catch(() => {
        if (!cancelled) setToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return token;
}

/**
 * Fetch wrapper that automatically includes the CSRF token header.
 * Use for all POST/PUT/DELETE requests.
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getCsrfToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("x-csrf-token", token);
  }
  headers.set("content-type", headers.get("content-type") || "application/json");

  return fetch(url, { ...options, headers });
}
