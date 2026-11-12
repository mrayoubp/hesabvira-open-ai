import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const APP_VERSION = "1.0.0";
export const APP_PHASE = "PHASE 10";

const MAX_DETAIL = 600;
const MAX_USER_AGENT = 240;

/**
 * Fixed-window rate limit stored in Convex. The read/write pair runs inside a
 * serializable mutation, so two concurrent requests cannot both consume the
 * last slot.
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    businessId?: Id<"businesses">;
    action: string;
    limit: number;
    windowMs: number;
  },
) {
  const now = Date.now();
  const windowStart = Math.floor(now / args.windowMs) * args.windowMs;
  const key = [
    args.action,
    args.userId,
    args.businessId ?? "global",
    windowStart,
  ].join(":");
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (existing && existing.count >= args.limit) {
    throw new ConvexError({
      code: "RATE_LIMITED",
      message:
        "تعداد درخواست‌های این عملیات بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
      retryAfterMs: windowStart + args.windowMs - now,
    });
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("rateLimits", {
      key,
      action: args.action,
      userId: args.userId,
      businessId: args.businessId,
      windowStart,
      count: 1,
      updatedAt: now,
    });
  }
}

export function safeErrorText(value: unknown, max = MAX_DETAIL) {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(
      /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function errorFingerprint(message: string) {
  let hash = 2166136261;
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function writeSecurityEvent(
  ctx: MutationCtx,
  args: {
    userId?: Id<"users">;
    businessId?: Id<"businesses">;
    action: string;
    result?: "success" | "failure";
    detail?: string;
    userAgent?: string;
    errorId?: string;
  },
) {
  await ctx.db.insert("securityEvents", {
    userId: args.userId,
    businessId: args.businessId,
    action: args.action,
    result: args.result ?? "success",
    detail: args.detail ? safeErrorText(args.detail) : undefined,
    userAgent: args.userAgent?.slice(0, MAX_USER_AGENT),
    errorId: args.errorId,
    createdAt: Date.now(),
  });
}

export async function logSystemError(
  ctx: MutationCtx,
  args: {
    businessId?: Id<"businesses">;
    userId?: Id<"users">;
    source: "client" | "server";
    message: string;
    route?: string;
    digest?: string;
    errorId?: string;
  },
) {
  const message = safeErrorText(args.message) || "خطای بدون پیام";
  const errorId =
    args.errorId ??
    `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fingerprint = errorFingerprint(`${args.source}:${message}`);
  await ctx.db.insert("systemErrors", {
    businessId: args.businessId,
    userId: args.userId,
    source: args.source,
    errorId,
    fingerprint,
    message,
    route: args.route?.slice(0, 240),
    digest: args.digest?.slice(0, 240),
    createdAt: Date.now(),
  });
  return errorId;
}
