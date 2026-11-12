import { ConvexError } from "convex/values";

/**
 * Normalises Convex/server errors into a message that is safe to show in a
 * toast. Business validation errors are thrown as ConvexError on the server.
 */
export function getErrorMessage(
  error: unknown,
  fallback = "خطای غیرمنتظره‌ای رخ داد. دوباره تلاش کنید.",
) {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data.trim()) return data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }

  if (error instanceof Error) {
    const match = error.message.match(/Uncaught (?:Convex)?Error: (.+)$/m);
    if (match?.[1]) return match[1];
    return error.message || fallback;
  }

  return fallback;
}
