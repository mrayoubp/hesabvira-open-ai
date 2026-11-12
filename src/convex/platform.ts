import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { planLimitsValidator } from "./schema";
import {
  addMonths,
  BILLING_SETTINGS_KEY,
  DEFAULT_BILLING,
  makeIdempotencyKey,
  makeInvoiceNumber,
} from "./lib/billing";
import {
  billingSettings,
  latestSubscription,
  loadSubscriptionAccess,
} from "./lib/subscriptionAccess";
import {
  requirePlatformAdmin,
  writePlatformAudit,
} from "./lib/platform";
import { writeAudit } from "./lib/tenant";
import { requireInt, requireString } from "./lib/validation";
import { seedDefaultsData } from "./seed";

function adminPlan(plan: Doc<"plans">) {
  return {
    _id: plan._id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    durationMonths: plan.durationMonths,
    priceToman: plan.priceToman,
    active: plan.active,
    sortOrder: plan.sortOrder,
    features: plan.features,
    limits: plan.limits,
    updatedAt: plan.updatedAt,
  };
}

function invoiceRow(invoice: Doc<"subscriptionInvoices">) {
  return {
    _id: invoice._id,
    number: invoice.number,
    amountToman: invoice.amountToman,
    status: invoice.status,
    kind: invoice.kind,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    issuedAt: invoice.issuedAt,
    paidAt: invoice.paidAt ?? null,
    gateway: invoice.gateway ?? null,
    gatewayRef: invoice.gatewayRef ?? null,
    description: invoice.description,
  };
}

export const amIPlatformAdmin = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const user = await ctx.db.get(userId);
    return user?.role === "admin";
  },
});

/** Seed the two approved plans, legal pages and billing settings once. */
export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requirePlatformAdmin(ctx);
    const result = await seedDefaultsData(ctx);
    await writePlatformAudit(ctx, {
      adminId: admin._id,
      action: "platform.seed_defaults",
      targetType: "platform",
      targetId: "defaults",
      summary: "ایجاد داده‌های اولیه تعرفه‌ها، صفحات حقوقی و تنظیمات پرداخت",
    });
    return result;
  },
});

/**
 * Admin-only global view. Every row is assembled from real business,
 * subscription and paid-invoice records. No demo revenue is fabricated.
 */
export const overview = query({
  args: {
    q: v.optional(v.string()),
    status: v.optional(v.string()),
    planCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const now = Date.now();
    const businesses = await ctx.db.query("businesses").take(200);
    const activeBusinesses = businesses.filter((row) => !row.archivedAt);
    const allInvoices = await ctx.db
      .query("subscriptionInvoices")
      .take(2000);
    const paidInvoices = allInvoices.filter(
      (row) => row.status === "paid" && row.paidAt,
    );
    const allPlans = await ctx.db.query("plans").take(20);
    const q = (args.q ?? "").trim().toLowerCase();

    const rows = [];
    for (const business of activeBusinesses) {
      const access = await loadSubscriptionAccess(ctx, business, now);
      if (args.status && access.status !== args.status) continue;
      if (args.planCode && access.plan?.code !== args.planCode) continue;
      const memberships = await ctx.db
        .query("businessMembers")
        .withIndex("by_business", (index) =>
          index.eq("businessId", business._id),
        )
        .take(200);
      const owner = memberships.find((row) => row.role === "owner");
      const ownerUser = owner ? await ctx.db.get(owner.userId) : null;
      const searchable = [
        business.name,
        business.businessType ?? "",
        business.city ?? "",
        ownerUser?.name ?? "",
        ownerUser?.email ?? "",
        access.plan?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (q && !searchable.includes(q)) continue;
      const paidTotal = paidInvoices
        .filter((row) => row.businessId === business._id)
        .reduce((sum, row) => sum + row.amountToman, 0);
      rows.push({
        businessId: business._id,
        name: business.name,
        businessType: business.businessType ?? null,
        city: business.city ?? null,
        createdAt: business.createdAt,
        ownerName: ownerUser?.name ?? owner?.displayName ?? null,
        ownerEmail: ownerUser?.email ?? null,
        ownerPhone: ownerUser?.phone ?? business.contactPhone ?? null,
        memberCount: memberships.length,
        planCode: access.plan?.code ?? null,
        planName: access.plan?.name ?? null,
        status: access.status,
        canWrite: access.canWrite,
        priceToman: access.subscription?.priceToman ?? null,
        paymentStatus: access.subscription?.paymentStatus ?? null,
        startAt: access.subscription?.startAt ?? null,
        endAt: access.subscription?.endAt ?? null,
        daysRemaining: access.daysRemaining,
        paidTotalToman: paidTotal,
        cancelReason: access.subscription?.cancelReason ?? null,
        subscriptionId: access.subscription?._id ?? null,
        planId: access.plan?._id ?? null,
      });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);

    const year = new Date(now).getUTCFullYear();
    const month = new Date(now).getUTCMonth();
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const offset = 11 - index;
      const start = Date.UTC(year, month - offset, 1);
      const end = Date.UTC(year, month - offset + 1, 1);
      const amount = paidInvoices
        .filter((row) => {
          const at = row.paidAt ?? row.issuedAt;
          return at >= start && at < end;
        })
        .reduce((sum, row) => sum + row.amountToman, 0);
      return { start, amountToman: amount };
    });
    const yearlyMap = new Map<number, number>();
    for (const invoice of paidInvoices) {
      const invoiceYear = new Date(
        invoice.paidAt ?? invoice.issuedAt,
      ).getUTCFullYear();
      yearlyMap.set(
        invoiceYear,
        (yearlyMap.get(invoiceYear) ?? 0) + invoice.amountToman,
      );
    }
    const annual = Array.from(yearlyMap.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, 4)
      .map(([yearValue, amountToman]) => ({ year: yearValue, amountToman }));

    const statusCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});

    const recentAudit = await ctx.db
      .query("platformAuditLogs")
      .withIndex("by_created")
      .order("desc")
      .take(50);

    return {
      rows,
      plans: allPlans
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(adminPlan),
      totals: {
        businesses: rows.length,
        paidToman: paidInvoices.reduce(
          (sum, row) => sum + row.amountToman,
          0,
        ),
        active: statusCounts.active ?? 0,
        pending: statusCounts.pending_payment ?? 0,
        expired: (statusCounts.expired ?? 0) + (statusCounts.grace ?? 0),
        cancelled: statusCounts.cancelled ?? 0,
      },
      monthly,
      annual,
      recentAudit: recentAudit.map((row) => ({
        _id: row._id,
        action: row.action,
        summary: row.summary,
        reason: row.reason ?? null,
        targetType: row.targetType,
        targetBusinessId: row.targetBusinessId ?? null,
        createdAt: row.createdAt,
      })),
    };
  },
});

/** Full billing history for one customer. */
export const businessDetail = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("کسب‌وکار پیدا نشد.");
    const access = await loadSubscriptionAccess(ctx, business);
    const memberships = await ctx.db
      .query("businessMembers")
      .withIndex("by_business", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(200);
    const members = [];
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      members.push({
        _id: membership._id,
        role: membership.role,
        name: user?.name ?? membership.displayName ?? null,
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        joinedAt: membership.createdAt,
      });
    }
    const invoices = access.subscription
      ? await ctx.db
          .query("subscriptionInvoices")
          .withIndex("by_subscription", (q) =>
            q.eq("subscriptionId", access.subscription!._id),
          )
          .collect()
      : [];
    const events = access.subscription
      ? await ctx.db
          .query("subscriptionEvents")
          .withIndex("by_subscription_created", (q) =>
            q.eq("subscriptionId", access.subscription!._id),
          )
          .collect()
      : [];
    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .collect();
    return {
      business: {
        _id: business._id,
        name: business.name,
        businessType: business.businessType ?? null,
        city: business.city ?? null,
        economicCode: business.economicCode ?? null,
        contactPhone: business.contactPhone ?? null,
        createdAt: business.createdAt,
      },
      access: {
        status: access.status,
        canWrite: access.canWrite,
        message: access.message,
      },
      plan: access.plan ? adminPlan(access.plan) : null,
      subscription: access.subscription
        ? {
            _id: access.subscription._id,
            status: access.subscription.status,
            paymentStatus: access.subscription.paymentStatus,
            startAt: access.subscription.startAt ?? null,
            endAt: access.subscription.endAt ?? null,
            renewalAt: access.subscription.renewalAt ?? null,
            cancelReason: access.subscription.cancelReason ?? null,
          }
        : null,
      members,
      invoices: invoices
        .sort((a, b) => b.issuedAt - a.issuedAt)
        .map(invoiceRow),
      events: events
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          _id: row._id,
          type: row.type,
          fromStatus: row.fromStatus ?? null,
          toStatus: row.toStatus ?? null,
          amountToman: row.amountToman ?? null,
          reason: row.reason ?? null,
          createdAt: row.createdAt,
        })),
      payments: payments
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          _id: row._id,
          amountToman: row.amountToman,
          status: row.status,
          provider: row.provider,
          authority: row.authority ?? null,
          failureReason: row.failureReason ?? null,
          createdAt: row.createdAt,
          paidAt: row.paidAt ?? null,
        })),
    };
  },
});

/** Only the two seeded plans exist; this updates either one in place. */
export const updatePlan = mutation({
  args: {
    planId: v.id("plans"),
    name: v.string(),
    description: v.string(),
    durationMonths: v.number(),
    priceToman: v.number(),
    active: v.boolean(),
    features: v.array(v.string()),
    limits: planLimitsValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError("پلن پیدا نشد.");
    const name = requireString(args.name, "نام پلن", { max: 100 }) as string;
    const description = requireString(args.description, "توضیح پلن", {
      max: 500,
    }) as string;
    const durationMonths = requireInt(args.durationMonths, "مدت اشتراک", {
      min: 1,
      max: 24,
    });
    const priceToman = requireInt(args.priceToman, "قیمت اشتراک", {
      min: 0,
      max: 100_000_000_000,
    });
    const features = args.features
      .map((row) => requireString(row, "ویژگی پلن", { max: 160 }))
      .filter((row): row is string => Boolean(row))
      .slice(0, 20);
    if (features.length === 0) {
      throw new ConvexError("حداقل یک ویژگی برای پلن لازم است.");
    }
    for (const [key, value] of Object.entries(args.limits)) {
      if (Array.isArray(value)) continue;
      requireInt(value, `محدودیت ${key}`, { min: 0, max: 1_000_000 });
    }
    await ctx.db.patch(args.planId, {
      name,
      description,
      durationMonths,
      priceToman,
      active: args.active,
      features,
      limits: args.limits,
      updatedAt: Date.now(),
    });
    await writePlatformAudit(ctx, {
      adminId: admin._id,
      action: "plan.updated",
      targetType: "plans",
      targetId: args.planId,
      summary: `به‌روزرسانی ${name}: ${priceToman.toLocaleString("fa-IR")} تومان / ${durationMonths} ماه`,
    });
    return { planId: args.planId };
  },
});

export const updateBillingSettings = mutation({
  args: {
    testMode: v.boolean(),
    provider: v.union(
      v.literal("test"),
      v.literal("zarinpal"),
      v.literal("none"),
    ),
    gatewayLabel: v.string(),
    graceDays: v.number(),
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const graceDays = requireInt(args.graceDays, "مهلت تمدید", {
      min: 0,
      max: 30,
    });
    const gatewayLabel = requireString(args.gatewayLabel, "نام درگاه", {
      max: 100,
    }) as string;
    const provider = args.testMode
      ? "test"
      : args.provider === "test"
        ? "none"
        : args.provider;
    const now = Date.now();
    const existing = await ctx.db
      .query("billingSettings")
      .withIndex("by_key", (q) => q.eq("key", BILLING_SETTINGS_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        testMode: args.testMode,
        provider,
        gatewayLabel,
        graceDays,
        updatedBy: admin._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("billingSettings", {
        key: BILLING_SETTINGS_KEY,
        testMode: args.testMode,
        provider,
        gatewayLabel,
        graceDays,
        updatedBy: admin._id,
        updatedAt: now,
      });
    }
    await writePlatformAudit(ctx, {
      adminId: admin._id,
      action: "billing.settings_updated",
      targetType: "billingSettings",
      targetId: BILLING_SETTINGS_KEY,
      summary: args.testMode
        ? "درگاه آزمایشی فعال شد"
        : `درگاه ${gatewayLabel} تنظیم شد`,
      reason: `مهلت تمدید ${graceDays} روز`,
    });
    return { testMode: args.testMode, provider, graceDays };
  },
});

async function createManualPaidInvoice(
  ctx: MutationCtx,
  input: {
    business: Doc<"businesses">;
    plan: Doc<"plans">;
    subscription: Doc<"subscriptions">;
    adminId: Id<"users">;
    reason: string;
  },
) {
  const now = Date.now();
  const periodStart =
    input.subscription.endAt && input.subscription.endAt > now
      ? input.subscription.endAt
      : now;
  const periodEnd = addMonths(periodStart, input.plan.durationMonths);
  const invoiceNumber = makeInvoiceNumber(now);
  const invoiceId = await ctx.db.insert("subscriptionInvoices", {
    businessId: input.business._id,
    subscriptionId: input.subscription._id,
    planId: input.plan._id,
    number: invoiceNumber,
    amountToman: input.plan.priceToman,
    currency: "IRT",
    status: "paid",
    kind: "renewal",
    periodStart,
    periodEnd,
    issuedAt: now,
    dueAt: now,
    paidAt: now,
    gateway: "manual",
    gatewayRef: `MANUAL-${now.toString(36).toUpperCase()}`,
    description: `تمدید دستی ${input.plan.name} — ${input.business.name}`,
    createdBy: input.adminId,
    paidBy: input.adminId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("subscriptionPayments", {
    businessId: input.business._id,
    subscriptionId: input.subscription._id,
    invoiceId,
    amountToman: input.plan.priceToman,
    status: "succeeded",
    provider: "manual",
    providerRef: `MANUAL-${now.toString(36).toUpperCase()}`,
    signatureVerified: true,
    idempotencyKey: makeIdempotencyKey(invoiceId, "manual"),
    initiatedBy: input.adminId,
    createdAt: now,
    verifiedAt: now,
    paidAt: now,
  });
  const fromStatus = input.subscription.status;
  await ctx.db.patch(input.subscription._id, {
    planId: input.plan._id,
    planCode: input.plan.code,
    planName: input.plan.name,
    durationMonths: input.plan.durationMonths,
    priceToman: input.plan.priceToman,
    status: "active",
    paymentStatus: "paid",
    startAt: input.subscription.startAt ?? now,
    endAt: periodEnd,
    renewalAt: periodEnd,
    lastPaymentAt: now,
    lastInvoiceId: invoiceId,
    cancelledAt: undefined,
    cancelReason: undefined,
    updatedAt: now,
  });
  await ctx.db.insert("subscriptionEvents", {
    businessId: input.business._id,
    subscriptionId: input.subscription._id,
    type: "manual_renewal",
    fromStatus,
    toStatus: "active",
    amountToman: input.plan.priceToman,
    actorId: input.adminId,
    reason: input.reason,
    invoiceId,
    createdAt: now,
  });
  await writeAudit(ctx, {
    businessId: input.business._id,
    actorId: input.adminId,
    action: "subscription.manual_renewal",
    entity: "subscriptions",
    entityId: input.subscription._id,
    summary: `تمدید دستی ${input.plan.name}: ${input.reason}`,
  });
  return { invoiceId, number: invoiceNumber, periodEnd };
}

export const renewManually = mutation({
  args: {
    businessId: v.id("businesses"),
    planId: v.optional(v.id("plans")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("کسب‌وکار پیدا نشد.");
    const reason = requireString(args.reason, "دلیل تمدید دستی", {
      max: 300,
    }) as string;
    const subscription = await latestSubscription(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("این کسب‌وکار اشتراک ندارد و باید از ثبت‌نام ایجاد شود.");
    }
    const plan = await ctx.db.get(args.planId ?? subscription.planId);
    if (!plan) throw new ConvexError("پلن پیدا نشد.");
    if (!plan.active) throw new ConvexError("پلن غیرفعال است.");
    const result = await createManualPaidInvoice(ctx, {
      business,
      plan,
      subscription,
      adminId: admin._id,
      reason,
    });
    await writePlatformAudit(ctx, {
      adminId: admin._id,
      action: "subscription.manual_renewal",
      targetType: "subscriptions",
      targetId: subscription._id,
      targetBusinessId: args.businessId,
      summary: `تمدید دستی ${plan.name} برای ${business.name}`,
      reason,
    });
    return result;
  },
});

export const setSubscriptionState = mutation({
  args: {
    businessId: v.id("businesses"),
    action: v.union(v.literal("suspend"), v.literal("activate")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("کسب‌وکار پیدا نشد.");
    const subscription = await latestSubscription(ctx, args.businessId);
    if (!subscription) throw new ConvexError("اشتراکی پیدا نشد.");
    const reason = requireString(args.reason, "دلیل تغییر وضعیت", {
      max: 300,
    }) as string;
    const now = Date.now();
    if (args.action === "suspend") {
      if (subscription.status === "cancelled") {
        throw new ConvexError("اشتراک از قبل لغو یا معلق است.");
      }
      await ctx.db.patch(subscription._id, {
        status: "cancelled",
        cancelReason: `تعلیق مدیریتی: ${reason}`,
        cancelledAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("subscriptionEvents", {
        businessId: args.businessId,
        subscriptionId: subscription._id,
        type: "cancelled",
        fromStatus: subscription.status,
        toStatus: "cancelled",
        actorId: admin._id,
        reason: `تعلیق مدیریتی: ${reason}`,
        createdAt: now,
      });
    } else {
      if (!subscription.endAt || subscription.endAt <= now) {
        throw new ConvexError(
          "دوره اشتراک تمام شده است. ابتدا از «تمدید دستی» استفاده کنید.",
        );
      }
      await ctx.db.patch(subscription._id, {
        status: "active",
        cancelledAt: undefined,
        cancelReason: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("subscriptionEvents", {
        businessId: args.businessId,
        subscriptionId: subscription._id,
        type: "reactivated",
        fromStatus: subscription.status,
        toStatus: "active",
        actorId: admin._id,
        reason,
        createdAt: now,
      });
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: admin._id,
      action:
        args.action === "suspend"
          ? "subscription.suspended"
          : "subscription.reactivated",
      entity: "subscriptions",
      entityId: subscription._id,
      summary: `${args.action === "suspend" ? "تعلیق" : "فعال‌سازی"} اشتراک: ${reason}`,
    });
    await writePlatformAudit(ctx, {
      adminId: admin._id,
      action:
        args.action === "suspend"
          ? "subscription.suspended"
          : "subscription.reactivated",
      targetType: "subscriptions",
      targetId: subscription._id,
      targetBusinessId: args.businessId,
      summary: `${args.action === "suspend" ? "تعلیق" : "فعال‌سازی"} ${business.name}`,
      reason,
    });
    return { status: args.action === "suspend" ? "cancelled" : "active" };
  },
});

export const updateLegalPage = mutation({
  args: {
    pageId: v.id("legalPages"),
    title: v.string(),
    content: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    const page = await ctx.db.get(args.pageId);
    if (!page) throw new ConvexError("صفحه حقوقی پیدا نشد.");
    const title = requireString(args.title, "عنوان صفحه", {
      max: 140,
    }) as string;
    const content = requireString(args.content, "متن صفحه", {
      max: 30000,
    }) as string;
    const active = args.active;
    await ctx.db.patch(args.pageId, {
      title,
      content,
      active,
      version: page.version + 1,
      updatedBy: admin._id,
      updatedAt: Date.now(),
    });
    await writePlatformAudit(ctx, {
      adminId: admin._id,
      action: "legal.updated",
      targetType: "legalPages",
      targetId: args.pageId,
      summary: `به‌روزرسانی صفحه «${title}»`,
    });
    return { pageId: args.pageId, version: page.version + 1 };
  },
});

export const adminLegalPages = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db.query("legalPages").take(20);
    return rows
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((row) => ({
        _id: row._id,
        slug: row.slug,
        title: row.title,
        content: row.content,
        version: row.version,
        active: row.active,
        updatedAt: row.updatedAt,
      }));
  },
});

export const adminBillingSettings = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const settings = await billingSettings(ctx);
    return {
      testMode: settings?.testMode ?? DEFAULT_BILLING.testMode,
      provider: settings?.provider ?? DEFAULT_BILLING.provider,
      gatewayLabel: settings?.gatewayLabel ?? DEFAULT_BILLING.gatewayLabel,
      graceDays: settings?.graceDays ?? DEFAULT_BILLING.graceDays,
      requiredEnv: [
        "BILLING_GATEWAY_MERCHANT_ID",
        "BILLING_GATEWAY_CALLBACK_URL",
        "BILLING_WEBHOOK_SECRET",
      ],
    };
  },
});
