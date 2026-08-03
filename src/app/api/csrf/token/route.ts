/**
 * CSRF Token Endpoint
 *
 * GET /api/csrf/token — returns a CSRF token for the current session.
 *
 * Idempotent: if a valid csrf_secret cookie already exists, the token is
 * derived from it (no rotation). A fresh secret is only generated on the
 * very first call. This is critical — the token is fetched multiple times
 * per page load (layout warm-up script, useCsrf, StrictMode double-mount),
 * and rotating the secret on each call would invalidate every earlier token
 * the client already received.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateCsrfToken, deriveCsrfToken, readCsrfSecret, setCsrfCookie } from "@/lib/csrf";

export async function GET(request: NextRequest) {
  const existing = readCsrfSecret(request);
  if (existing) {
    return NextResponse.json({ token: deriveCsrfToken(existing) });
  }

  const { secret, token } = generateCsrfToken();
  const response = NextResponse.json({ token });
  return setCsrfCookie(response, secret);
}
