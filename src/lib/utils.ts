/**
 * Shared utilities — cn() merges Tailwind classes (clsx + tailwind-merge).
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Sanitize error messages for client responses.
 * Returns a generic, user-friendly message instead of leaking internal
 * details (API key names, model names, quota strings, stack traces).
 * The full error should be logged server-side via logError() before calling
 * this function.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  // Known error patterns → user-friendly messages
  const patterns: Array<{ match: RegExp; message: string }> = [
    { match: /429|rate.?limit|quota|free-models-per-day/i, message: "Service is busy. Please try again in a minute." },
    { match: /401|unauthorized|invalid.*key|api.?key/i, message: "Authentication failed. Please try again later." },
    { match: /timeout|timed.?out/i, message: "Request timed out. Please try again." },
    { match: /fetch.*failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i, message: "Connection failed. Please try again." },
    { match: /openrouter|gemini|groq|provider/i, message: "AI service unavailable. Please try again." },
    { match: /image.*search|search.*image/i, message: "Image search failed. Please try again." },
  ];

  for (const { match, message } of patterns) {
    if (match.test(msg)) return message;
  }

  // Default: don't leak internal details
  return "Something went wrong. Please try again.";
}
