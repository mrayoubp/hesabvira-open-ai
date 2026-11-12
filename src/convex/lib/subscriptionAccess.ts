import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { PlanLimits, SubscriptionStatus } from "../schema";
import {
  BILLING_SETTINGS_KEY,
  DEFAULT_BILLING,
  effectiveSubscriptionStatus,
  isWriteAllowed,
  subscriptionStatusMessage,
} from "./billing";

type Ctx = QueryCtx | MutationCtx;

export type EffectiveAccessStatus = SubscriptionStatus | "legacy";

export interface SubscriptionAccess {
  required: boolean;
  status: EffectiveAccessStatus;
  canRead: boolean;
  canWrite: boolean;
  canRenew: boolean;
  message: string;
  graceDays: number;
  daysRemaining: number | null;
  subscription: Doc<"subscriptions"> | null;
  plan: Doc<"plans"> | null;
  limits: PlanLimits | null;
  testMode: boolean;
  graceEndsAt: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function latestSubscription(
  ctx: Ctx,
  businessId: Id<"businesses">,
) {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  return rows.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export async function billingSettings(ctx: Ctx) {
  return (
    (await ctx.db
      .query("billingSettings")
      .withIndex("by_key", (q) => q.eq("key", BILLING_SETTINGS_KEY))
      .unique()) ?? null
  );
}

/**
 * Single source of truth for read/write access. It never hides historical data:
 * expired and cancelled tenants keep read/export access indefinitely.
 */
export async function loadSubscriptionAccess(
  ctx: Ctx,
  business: Doc<"businesses">,
  now = Date.now(),
): Promise<SubscriptionAccess> {
  const settings = await billingSettings(ctx);
  const graceDays = settings?.graceDays ?? DEFAULT_BILLING.graceDays;
  const testMode = settings?.testMode ?? DEFAULT_BILLING.testMode;
  const subscription = await latestSubscription(ctx, business._id);
  const plan = subscription ? await ctx.db.get(subscription.planId) : null;

  if (!business.subscriptionRequired) {
    return {
      required: false,
      status: "legacy",
      canRead: true,
      canWrite: true,
      canRenew: false,
      message: "این فضای کاری قدیمی است و داده‌های آن حفظ شده است.",
      graceDays,
      daysRemaining: null,
      subscription,
      plan,
      limits: plan?.limits ?? null,
      testMode,
      graceEndsAt: null,
    };
  }

  if (!subscription) {
    return {
      required: true,
      status: "pending_payment",
      canRead: true,
      canWrite: false,
      canRenew: true,
      message: subscriptionStatusMessage("pending_payment"),
      graceDays,
      daysRemaining: null,
      subscription: null,
      plan: null,
      limits: null,
      testMode,
      graceEndsAt: null,
    };
  }

  const status = effectiveSubscriptionStatus(
    subscription.status,
    subscription.endAt,
    now,
    graceDays,
  );
  const graceEndsAt =
    status === "grace" && subscription.endAt
      ? subscription.endAt + graceDays * DAY_MS
      : null;

  return {
    required: true,
    status,
    canRead: true,
    canWrite: isWriteAllowed(status),
    canRenew: true,
    message: subscriptionStatusMessage(status),
    graceDays,
    daysRemaining:
      subscription.endAt === undefined
        ? null
        : Math.ceil((subscription.endAt - now) / DAY_MS),
    subscription,
    plan,
    limits: plan?.limits ?? null,
    testMode,
    graceEndsAt,
  };
}

export async function assertWriteSubscription(
  ctx: Ctx,
  business: Doc<"businesses">,
) {
  const access = await loadSubscriptionAccess(ctx, business);
  if (!access.canWrite) {
    throw new ConvexError(access.message);
  }
  return access;
}

async function requirePlanLimits(
  ctx: Ctx,
  businessId: Id<"businesses">,
): Promise<PlanLimits | null> {
  const business = await ctx.db.get(businessId);
  if (!business || !business.subscriptionRequired) return null;
  const access = await loadSubscriptionAccess(ctx, business);
  return access.limits;
}

export async function assertBranchCapacity(
  ctx: Ctx,
  businessId: Id<"businesses">,
) {
  const limits = await requirePlanLimits(ctx, businessId);
  if (!limits) return;
  const branches = await ctx.db
    .query("branches")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(500);
  const used = branches.filter((row) => !row.archivedAt).length;
  if (used >= limits.maxBranches) {
    throw new ConvexError(
      `سقف شعب پلن شما ${limits.maxBranches.toLocaleString("fa-IR")} شعبه است. برای افزودن شعبه، پلن را تمدید یا ارتقا دهید.`,
    );
  }
}

export async function assertWarehouseCapacity(
  ctx: Ctx,
  businessId: Id<"businesses">,
) {
  const limits = await requirePlanLimits(ctx, businessId);
  if (!limits) return;
  const warehouses = await ctx.db
    .query("warehouses")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(500);
  const used = warehouses.filter((row) => row.active).length;
  if (used >= limits.maxWarehouses) {
    throw new ConvexError(
      `سقف انبارهای پلن شما ${limits.maxWarehouses.toLocaleString("fa-IR")} انبار است. برای افزودن انبار، پلن را تمدید یا ارتقا دهید.`,
    );
  }
}

export async function assertStorageCapacity(
  ctx: Ctx,
  businessId: Id<"businesses">,
  incomingBytes: number,
) {
  const limits = await requirePlanLimits(ctx, businessId);
  if (!limits) return;
  const uploads = await ctx.db
    .query("fileUploads")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(5000);
  const used = uploads.reduce((sum, row) => sum + (row.size ?? 0), 0);
  const maxBytes = limits.maxStorageMb * 1024 * 1024;
  if (used + incomingBytes > maxBytes) {
    throw new ConvexError(
      `حجم فایل‌های مجاز پلن شما ${limits.maxStorageMb.toLocaleString("fa-IR")} مگابایت است و فضای باقی‌مانده کافی نیست.`,
    );
  }
}
