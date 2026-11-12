import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireUser } from "./tenant";

type Ctx = QueryCtx | MutationCtx;

/**
 * Platform administrator is a privileged role outside any tenant. It is only
 * assigned manually in the users table (never by a public mutation).
 */
export async function requirePlatformAdmin(ctx: Ctx) {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new ConvexError("این بخش فقط برای مدیر اصلی سامانه مجاز است.");
  }
  return user;
}

export async function writePlatformAudit(
  ctx: MutationCtx,
  entry: {
    adminId: Id<"users">;
    action: string;
    targetType: string;
    targetId: string;
    targetBusinessId?: Id<"businesses">;
    summary: string;
    reason?: string;
  },
) {
  await ctx.db.insert("platformAuditLogs", {
    ...entry,
    createdAt: Date.now(),
  });
}
