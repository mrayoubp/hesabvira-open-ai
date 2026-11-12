import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { MemberRole } from "../schema";
import { assertWriteSubscription } from "./subscriptionAccess";

type Ctx = QueryCtx | MutationCtx;

/** Business roles that may create or change operational documents. */
const WRITE_ROLES: MemberRole[] = ["owner", "admin", "accountant"];
const MANAGE_ROLES: MemberRole[] = ["owner", "admin"];

export function isWriteRole(role: MemberRole) {
  return WRITE_ROLES.includes(role);
}

export function isManageRole(role: MemberRole) {
  return MANAGE_ROLES.includes(role);
}

/** Throws a Persian, user-safe error when there is no signed-in user. */
export async function requireUser(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("برای انجام این عملیات باید وارد شوید.");
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("حساب کاربری یافت نشد.");
  return user;
}

/**
 * Resolves the caller's membership for a business and optionally enforces a
 * write permission level. This is the single gate for tenant isolation:
 * every business-scoped function must call it.
 */
export async function requireMembership(
  ctx: Ctx,
  businessId: Id<"businesses">,
  options: { write?: boolean; manage?: boolean } = {},
): Promise<{
  user: Doc<"users">;
  business: Doc<"businesses">;
  membership: Doc<"businessMembers">;
}> {
  const user = await requireUser(ctx);

  const membership = await ctx.db
    .query("businessMembers")
    .withIndex("by_business_user", (q) =>
      q.eq("businessId", businessId).eq("userId", user._id),
    )
    .unique();

  if (!membership) {
    throw new ConvexError("دسترسی به این کسب‌وکار برای شما مجاز نیست.");
  }

  const business = await ctx.db.get(businessId);
  if (!business || business.archivedAt) {
    throw new ConvexError("این کسب‌وکار در دسترس نیست.");
  }

  if (options.write && !isWriteRole(membership.role)) {
    throw new ConvexError("نقش شما اجازه ثبت یا تغییر اطلاعات را ندارد.");
  }
  if (options.manage && !isManageRole(membership.role)) {
    throw new ConvexError("این عملیات فقط برای مدیر کسب‌وکار مجاز است.");
  }

  // Phase 11: all write paths that use the shared tenant gate honour the SaaS
  // subscription. Reads (including exports/backups) remain available.
  if (options.write) {
    await assertWriteSubscription(ctx, business);
  }

  return { user, business, membership };
}

/** Allocates the next value of a per-business counter atomically. */
export async function nextCounter(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  key: string,
) {
  const existing = await ctx.db
    .query("counters")
    .withIndex("by_business_key", (q) =>
      q.eq("businessId", businessId).eq("key", key),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("counters", { businessId, key, value: 1 });
    return 1;
  }

  const value = existing.value + 1;
  await ctx.db.patch(existing._id, { value });
  return value;
}

/** Appends an audit trail row. Audit writes must never block the operation. */
export async function writeAudit(
  ctx: MutationCtx,
  entry: {
    businessId: Id<"businesses">;
    actorId: Id<"users">;
    action: string;
    entity: string;
    entityId: string;
    summary?: string;
  },
) {
  await ctx.db.insert("auditLogs", { ...entry, createdAt: Date.now() });
}

export function padSequence(value: number, prefix: string) {
  return `${prefix}-${String(value).padStart(4, "0")}`;
}
