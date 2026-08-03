/**
 * CSRF protection for state-changing API routes.
 *
 * Implementation:
 * - A CSRF token pair (secret + client-visible token) is generated per session
 * - The client-visible token is embedded in a meta tag in layout.tsx
 * - POST/PUT/DELETE handlers read the token from the `X-CSRF-Token` header
 *   and verify it matches the session's secret using constant-time comparison
 * - The secret is stored in a secure (HttpOnly, SameSite=Strict) cookie
 *
 * Usage:
 *   import { requireCsrf } from "@/lib/csrf";
 *   export async function POST(request: NextRequest) {
 *     const csrfError = requireCsrf(request);
 *     if (csrfError) return csrfError; // returns a 403 Response
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual as _timingSafeEqual } from "crypto";

const CSRF_COOKIE = "csrf_secret";
const CSRF_HEADER = "x-csrf-token";
// In production this should be in .env.local
const CSRF_SECRET = process.env.CSRF_SECRET || "menulens-csrf-dev-key-change-in-prod";

/**
 * Generate a CSRF token pair and set the secret cookie.
 * Call this from a login or session-init endpoint.
 */
export function generateCsrfToken(): { secret: string; token: string } {
  const secret = randomBytes(32).toString("hex");
  return { secret, token: deriveCsrfToken(secret) };
}

/**
 * Derive the client-visible token from a secret (deterministic, verifiable).
 * Used both at generation time and by the idempotent /api/csrf/token
 * endpoint so repeated fetches never rotate the secret under the client.
 */
export function deriveCsrfToken(secret: string): string {
  return createHmac("sha256", CSRF_SECRET).update(secret).digest("hex");
}

/**
 * Read the csrf_secret cookie value from a request's Cookie header.
 */
export function readCsrfSecret(request: NextRequest): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  return parseCookies(cookieHeader)[CSRF_COOKIE] || null;
}

/**
 * Validate the CSRF token from the request against the cookie secret.
 */
function validateToken(secret: string, token: string): boolean {
  const expected = deriveCsrfToken(secret);
  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const tokenBuf = Buffer.from(token, "hex");
    if (expectedBuf.length !== tokenBuf.length) return false;
    return _timingSafeEqual(expectedBuf, tokenBuf);
  } catch {
    return false;
  }
}

/**
 * Validate CSRF on a request. Returns true if valid, false otherwise.
 */
export function validateCsrf(request: NextRequest): boolean {
  const secret = readCsrfSecret(request);
  if (!secret) return false;

  const token = request.headers.get(CSRF_HEADER);
  if (!token) return false;

  return validateToken(secret, token);
}

/**
 * Middleware-style wrapper: returns a 403 Response if CSRF fails,
 * or `null` if the request is valid (proceed normally).
 */
export function requireCsrf(request: NextRequest): NextResponse | null {
  if (!validateCsrf(request)) {
    return NextResponse.json({ error: "Invalid or missing CSRF token" }, { status: 403 });
  }
  return null;
}

/**
 * Set the CSRF cookie on a response (use after generating tokens).
 */
export function setCsrfCookie(response: NextResponse, secret: string): NextResponse {
  response.cookies.set(CSRF_COOKIE, secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return response;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  const items = cookieHeader.split(";");
  for (const item of items) {
    const [name, ...rest] = item.trim().split("=");
    if (name) result[name] = rest.join("=");
  }
  return result;
}
