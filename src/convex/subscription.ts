import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  addMonths,
  DEFAULT_BILLING,
  makeIdempotencyKey,
  makeInvoiceNumber,
} from "./lib/billing";
import { requireMembership, requireUser, writeAudit } from "./lib/tenant";
import {
  provisionBusinessWorkspace,
} from "./lib/workspace";
import {
  billingSettings,
  latestSubscription,
  loadSubscriptionAccess,
} from "./lib/subscriptionAccess";
import {
  optionalString,
  requireString,
  validatePhone,
  validateEmail,
} from "./lib/validation";

const DAY_MS = 24 * 60 * 60 * 1000;

function publicPlan(plan: Doc<"plans">) {
  return {
    _id: plan._id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    durationMonths: plan.durationMonths,
    priceToman: plan.priceToman,
    features: plan.features,
    limits: plan.limits,
    active: plan.active,
  };
}

function publicSubscription(sub: Doc<"subscriptions"> | null) {
  if (!sub) return null;
  return {
    _id: sub._id,
    planId: sub.planId,
    planCode: sub.planCode,
    planName: sub.planName,
    durationMonths: sub.durationMonths,
    priceToman: sub.priceToman,
    status: sub.status,
    paymentStatus: sub.paymentStatus,
    startAt: sub.startAt ?? null,
    endAt: sub.endAt ?? null,
    renewalAt: sub.renewalAt ?? null,
    lastPaymentAt: sub.lastPaymentAt ?? null,
    cancelledAt: sub.cancelledAt ?? null,
    cancelReason: sub.cancelReason ?? null,
    createdAt: sub.createdAt,
  };
}

function publicInvoice(invoice: Doc<"subscriptionInvoices">) {
  return {
    _id: invoice._id,
    number: invoice.number,
    amountToman: invoice.amountToman,
    currency: invoice.currency,
    status: invoice.status,
    kind: invoice.kind,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt ?? null,
    gateway: invoice.gateway ?? null,
    gatewayRef: invoice.gatewayRef ?? null,
    description: invoice.description,
  };
}

function publicEvent(event: Doc<"subscriptionEvents">) {
  return {
    _id: event._id,
    type: event.type,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    amountToman: event.amountToman ?? null,
    reason: event.reason ?? null,
    createdAt: event.createdAt,
  };
}

/** Public, active plans. Prices, durations and limits always come from DB. */
export const plans = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("plans")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder).map(publicPlan);
  },
});

/** Public gateway mode (never includes credentials). */
export const billingConfig = query({
  args: {},
  handler: async (ctx) => {
    const settings = await billingSettings(ctx);
    return {
      testMode: settings?.testMode ?? DEFAULT_BILLING.testMode,
      provider: settings?.provider ?? DEFAULT_BILLING.provider,
      gatewayLabel: settings?.gatewayLabel ?? DEFAULT_BILLING.gatewayLabel,
      graceDays: settings?.graceDays ?? DEFAULT_BILLING.graceDays,
    };
  },
});

/**
 * Read access for the active workspace. It exposes only summary fields; full
 * invoices are returned by `mySubscription` to an authenticated member.
 */
export const access = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { business } = await requireMembership(ctx, args.businessId);
    const row = await loadSubscriptionAccess(ctx, business);
    return {
      required: row.required,
      status: row.status,
      canRead: row.canRead,
      canWrite: row.canWrite,
      canRenew: row.canRenew,
      message: row.message,
      graceDays: row.graceDays,
      daysRemaining: row.daysRemaining,
      graceEndsAt: row.graceEndsAt,
      testMode: row.testMode,
      plan: row.plan ? publicPlan(row.plan) : null,
      subscription: publicSubscription(row.subscription),
      limits: row.limits,
    };
  },
});

/** Full billing history for the current tenant (all members can view). */
export const mySubscription = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { business, membership } = await requireMembership(
      ctx,
      args.businessId,
    );
    const row = await loadSubscriptionAccess(ctx, business);
    const invoices = row.subscription
      ? await ctx.db
          .query("subscriptionInvoices")
          .withIndex("by_subscription", (q) =>
            q.eq("subscriptionId", row.subscription!._id),
          )
          .collect()
      : [];
    const events = row.subscription
      ? await ctx.db
          .query("subscriptionEvents")
          .withIndex("by_subscription_created", (q) =>
            q.eq("subscriptionId", row.subscription!._id),
          )
          .collect()
      : [];
    const payments = row.subscription
      ? await ctx.db
          .query("subscriptionPayments")
          .withIndex("by_business_created", (q) =>
            q.eq("businessId", args.businessId),
          )
          .collect()
      : [];

    return {
      access: {
        required: row.required,
        status: row.status,
        canRead: row.canRead,
        canWrite: row.canWrite,
        canRenew: row.canRenew,
        message: row.message,
        graceDays: row.graceDays,
        daysRemaining: row.daysRemaining,
        graceEndsAt: row.graceEndsAt,
        testMode: row.testMode,
      },
      plan: row.plan ? publicPlan(row.plan) : null,
      subscription: publicSubscription(row.subscription),
      limits: row.limits,
      canManage:
        membership.role === "owner" || membership.role === "admin",
      invoices: invoices
        .sort((a, b) => b.issuedAt - a.issuedAt)
        .slice(0, 50)
        .map(publicInvoice),
      events: events
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map(publicEvent),
      payments: payments
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map((payment) => ({
          _id: payment._id,
          invoiceId: payment.invoiceId,
          amountToman: payment.amountToman,
          status: payment.status,
          provider: payment.provider,
          failureReason: payment.failureReason ?? null,
          createdAt: payment.createdAt,
          paidAt: payment.paidAt ?? null,
        })),
    };
  },
});

/**
 * Signed-in onboarding: creates the business only after OTP auth and a chosen
 * plan. The onboardingKey makes double-submit safe. All server values are
 * re-read from the plan row; the browser cannot supply a price.
 */
export const startOnboarding = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    mobile: v.string(),
    email: v.string(),
    businessName: v.string(),
    businessType: v.string(),
    city: v.string(),
    economicCode: v.optional(v.string()),
    planId: v.id("plans"),
    acceptedTerms: v.boolean(),
    onboardingKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!args.acceptedTerms) {
      throw new ConvexError("پذیرش قوانین و شرایط استفاده الزامی است.");
    }
    if (!user.email) {
      throw new ConvexError(
        "ایمیل حساب کاربری تأیید نشده است. لطفاً دوباره وارد شوید.",
      );
    }
    const requestedEmail = validateEmail(args.email);
    if (
      !requestedEmail ||
      requestedEmail.toLowerCase() !== user.email.toLowerCase()
    ) {
      throw new ConvexError(
        "ایمیل واردشده با ایمیل تأییدشده حساب یکسان نیست.",
      );
    }
    const mobile = validatePhone(args.mobile);
    if (!mobile) throw new ConvexError("شماره موبایل الزامی است.");
    const firstName = requireString(args.firstName, "نام", {
      max: 60,
    }) as string;
    const lastName = requireString(args.lastName, "نام خانوادگی", {
      max: 60,
    }) as string;
    const businessName = requireString(args.businessName, "نام کسب‌وکار", {
      max: 120,
    }) as string;
    const businessType = requireString(args.businessType, "نوع کسب‌وکار", {
      max: 80,
    }) as string;
    const city = requireString(args.city, "شهر", { max: 80 }) as string;
    const economicCode = optionalString(
      args.economicCode,
      "کد اقتصادی",
      30,
    );
    const onboardingKey = requireString(
      args.onboardingKey,
      "شناسه ثبت‌نام",
      { max: 120 },
    ) as string;

    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_onboarding_key", (q) =>
        q.eq("onboardingKey", onboardingKey),
      )
      .unique();
    if (existing) {
      const membership = await ctx.db
        .query("businessMembers")
        .withIndex("by_business_user", (q) =>
          q.eq("businessId", existing._id).eq("userId", user._id),
        )
        .unique();
      if (!membership) {
        throw new ConvexError("این ثبت‌نام قبلاً برای حساب دیگری انجام شده است.");
      }
      const subscription = await latestSubscription(ctx, existing._id);
      const invoice = subscription?.lastInvoiceId
        ? await ctx.db.get(subscription.lastInvoiceId)
        : null;
      return {
        businessId: existing._id,
        subscriptionId: subscription?._id ?? null,
        invoiceId: invoice?._id ?? null,
        invoiceNumber: invoice?.number ?? null,
        amountToman: invoice?.amountToman ?? null,
        alreadyExists: true as const,
      };
    }

    // A refreshed signup form generates a new local key. Return an existing
    // unpaid workspace instead of silently creating another tenant. Active
    // customers may still intentionally create another workspace.
    const memberships = await ctx.db
      .query("businessMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const membership of memberships) {
      const business = await ctx.db.get(membership.businessId);
      if (!business || business.archivedAt) continue;
      const access = await loadSubscriptionAccess(ctx, business);
      if (access.status !== "pending_payment" || !access.subscription) continue;
      const invoice = access.subscription.lastInvoiceId
        ? await ctx.db.get(access.subscription.lastInvoiceId)
        : null;
      if (!invoice) continue;
      return {
        businessId: business._id,
        subscriptionId: access.subscription._id,
        invoiceId: invoice._id,
        invoiceNumber: invoice.number,
        amountToman: invoice.amountToman,
        alreadyExists: true as const,
      };
    }

    const plan = await ctx.db.get(args.planId);
    if (!plan || !plan.active) {
      throw new ConvexError("پلن انتخاب‌شده در دسترس نیست.");
    }

    await ctx.db.patch(user._id, {
      name: `${firstName} ${lastName}`.trim(),
      phone: mobile,
    });

    const businessId = await provisionBusinessWorkspace(ctx, user, {
      name: businessName,
      subscriptionRequired: true,
      businessType,
      city,
      economicCode,
      contactPhone: mobile,
      onboardingKey,
    });

    const now = Date.now();
    const periodEnd = addMonths(now, plan.durationMonths);
    const subscriptionId = await ctx.db.insert("subscriptions", {
      businessId,
      planId: plan._id,
      planCode: plan.code,
      planName: plan.name,
      durationMonths: plan.durationMonths,
      priceToman: plan.priceToman,
      status: "pending_payment",
      paymentStatus: "unpaid",
      createdAt: now,
      updatedAt: now,
    });
    const invoiceId = await ctx.db.insert("subscriptionInvoices", {
      businessId,
      subscriptionId,
      planId: plan._id,
      number: makeInvoiceNumber(now),
      amountToman: plan.priceToman,
      currency: "IRT",
      status: "unpaid",
      kind: "new",
      periodStart: now,
      periodEnd,
      issuedAt: now,
      dueAt: now + 7 * DAY_MS,
      description: `فاکتور ${plan.name} — ${businessName}`,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(subscriptionId, { lastInvoiceId: invoiceId });
    await ctx.db.insert("subscriptionEvents", {
      businessId,
      subscriptionId,
      type: "created",
      toStatus: "pending_payment",
      amountToman: plan.priceToman,
      actorId: user._id,
      invoiceId,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId,
      actorId: user._id,
      action: "subscription.created",
      entity: "subscriptions",
      entityId: subscriptionId,
      summary: `ثبت‌نام ${businessName} با ${plan.name}`,
    });

    return {
      businessId,
      subscriptionId,
      invoiceId,
      invoiceNumber: (await ctx.db.get(invoiceId))?.number ?? null,
      amountToman: plan.priceToman,
      alreadyExists: false as const,
    };
  },
});

/** Starts a test checkout. Real gateways are not enabled without credentials. */
export const checkout = mutation({
  args: { invoiceId: v.id("subscriptionInvoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new ConvexError("فاکتور اشتراک پیدا نشد.");
    const { user, business } = await requireMembership(
      ctx,
      invoice.businessId,
      { manage: true },
    );
    if (!business.subscriptionRequired) {
      throw new ConvexError("این فضای کاری از پرداخت اشتراک معاف است.");
    }
    if (invoice.status === "paid") {
      return {
        mode: "already_paid" as const,
        invoiceId: invoice._id,
        number: invoice.number,
      };
    }
    if (invoice.status === "cancelled" || invoice.status === "refunded") {
      throw new ConvexError("این فاکتور قابل پرداخت نیست.");
    }
    if (invoice.status === "failed") {
      await ctx.db.patch(invoice._id, {
        status: "unpaid",
        updatedAt: Date.now(),
      });
    }

    const settings = await billingSettings(ctx);
    const testMode = settings?.testMode ?? DEFAULT_BILLING.testMode;
    const provider = testMode ? "test" : settings?.provider ?? "none";
    if (!testMode || provider !== "test") {
      throw new ConvexError(
        "درگاه پرداخت واقعی هنوز متصل نشده است. لطفاً با پشتیبانی تماس بگیرید.",
      );
    }

    const attempts = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .collect();
    const open = attempts.find(
      (row) => row.status === "initiated" && row.provider === "test",
    );
    if (open) {
      return {
        mode: "test" as const,
        paymentId: open._id,
        invoiceId: invoice._id,
        number: invoice.number,
        amountToman: invoice.amountToman,
        gatewayLabel: settings?.gatewayLabel ?? DEFAULT_BILLING.gatewayLabel,
      };
    }
    if (attempts.some((row) => row.status === "succeeded")) {
      return {
        mode: "already_paid" as const,
        invoiceId: invoice._id,
        number: invoice.number,
      };
    }

    const now = Date.now();
    const idempotencyKey = makeIdempotencyKey(invoice._id, "test");
    const paymentId = await ctx.db.insert("subscriptionPayments", {
      businessId: invoice.businessId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice._id,
      amountToman: invoice.amountToman,
      status: "initiated",
      provider: "test",
      idempotencyKey,
      signatureVerified: false,
      initiatedBy: user._id,
      createdAt: now,
    });
    await ctx.db.insert("subscriptionEvents", {
      businessId: invoice.businessId,
      subscriptionId: invoice.subscriptionId,
      type: "payment_initiated",
      amountToman: invoice.amountToman,
      actorId: user._id,
      invoiceId: invoice._id,
      reason: "پرداخت آزمایشی",
      createdAt: now,
    });
    return {
      mode: "test" as const,
      paymentId,
      invoiceId: invoice._id,
      number: invoice.number,
      amountToman: invoice.amountToman,
      gatewayLabel: settings?.gatewayLabel ?? DEFAULT_BILLING.gatewayLabel,
    };
  },
});

async function activateInvoice(
  ctx: MutationCtx,
  input: {
    invoice: Doc<"subscriptionInvoices">;
    actorId: Id<"users">;
    provider: string;
    reference?: string;
  },
) {
  const { invoice, actorId } = input;
  const subscription = await ctx.db.get(invoice.subscriptionId);
  if (!subscription) throw new ConvexError("اشتراک فاکتور پیدا نشد.");
  if (subscription.businessId !== invoice.businessId) {
    throw new ConvexError("فاکتور به این اشتراک تعلق ندارد.");
  }
  if (invoice.status === "paid") {
    return { alreadyPaid: true as const, subscriptionId: subscription._id };
  }
  const plan = await ctx.db.get(invoice.planId);
  if (!plan) {
    throw new ConvexError("پلن فاکتور در دسترس نیست و پرداخت قابل تأیید نیست.");
  }

  const now = Date.now();
  const previousStatus = subscription.status;
  const periodStart =
    invoice.kind === "new"
      ? now
      : Math.max(now, subscription.endAt ?? 0);
  const periodEnd = addMonths(periodStart, plan.durationMonths);
  const subscriptionStart = subscription.startAt ?? now;
  const fromStatus = previousStatus;
  const toStatus = "active" as const;

  await ctx.db.patch(invoice._id, {
    status: "paid",
    paidAt: now,
    paidBy: actorId,
    gateway: input.provider,
    gatewayRef: input.reference,
    periodStart,
    periodEnd,
    updatedAt: now,
  });
  await ctx.db.patch(subscription._id, {
    planId: plan._id,
    planCode: plan.code,
    planName: plan.name,
    durationMonths: plan.durationMonths,
    priceToman: plan.priceToman,
    status: toStatus,
    paymentStatus: "paid",
    startAt: subscriptionStart,
    endAt: periodEnd,
    renewalAt: periodEnd,
    lastPaymentAt: now,
    lastInvoiceId: invoice._id,
    updatedAt: now,
  });
  await ctx.db.insert("subscriptionEvents", {
    businessId: invoice.businessId,
    subscriptionId: subscription._id,
    type: invoice.kind === "new" ? "activated" : "renewed",
    fromStatus,
    toStatus,
    amountToman: invoice.amountToman,
    actorId,
    invoiceId: invoice._id,
    createdAt: now,
  });
  await writeAudit(ctx, {
    businessId: invoice.businessId,
    actorId,
    action:
      invoice.kind === "new" ? "subscription.activated" : "subscription.renewed",
    entity: "subscriptions",
    entityId: subscription._id,
    summary: `پرداخت ${invoice.number} و فعال‌سازی ${plan.name}`,
  });
  return { alreadyPaid: false as const, subscriptionId: subscription._id };
}

/** Test-mode confirmation. Never available when test mode is off. */
export const confirmTestPayment = mutation({
  args: {
    paymentId: v.id("subscriptionPayments"),
    outcome: v.union(v.literal("success"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError("تلاش پرداخت پیدا نشد.");
    const { user, business } = await requireMembership(
      ctx,
      payment.businessId,
      { manage: true },
    );
    if (!business.subscriptionRequired) {
      throw new ConvexError("این فضای کاری اشتراک ندارد.");
    }
    const settings = await billingSettings(ctx);
    if (!(settings?.testMode ?? DEFAULT_BILLING.testMode)) {
      throw new ConvexError("پرداخت آزمایشی غیرفعال است.");
    }
    if (payment.provider !== "test") {
      throw new ConvexError("این پرداخت آزمایشی نیست.");
    }
    if (payment.status === "succeeded") {
      return { status: "succeeded" as const, alreadyProcessed: true };
    }
    if (payment.status === "failed") {
      return { status: "failed" as const, alreadyProcessed: true };
    }
    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice) throw new ConvexError("فاکتور پرداخت پیدا نشد.");
    if (invoice.amountToman !== payment.amountToman) {
      throw new ConvexError("مبلغ پرداخت با فاکتور هم‌خوانی ندارد.");
    }
    const now = Date.now();

    if (args.outcome === "failed") {
      await ctx.db.patch(payment._id, {
        status: "failed",
        failureReason: "پرداخت آزمایشی ناموفق",
        verifiedAt: now,
      });
      await ctx.db.patch(invoice._id, {
        status: "failed",
        updatedAt: now,
      });
      await ctx.db.insert("subscriptionEvents", {
        businessId: payment.businessId,
        subscriptionId: payment.subscriptionId,
        type: "payment_failed",
        amountToman: payment.amountToman,
        actorId: user._id,
        invoiceId: invoice._id,
        reason: "پرداخت آزمایشی ناموفق",
        createdAt: now,
      });
      await writeAudit(ctx, {
        businessId: payment.businessId,
        actorId: user._id,
        action: "subscription.payment_failed",
        entity: "subscriptionPayments",
        entityId: payment._id,
        summary: `پرداخت ناموفق فاکتور ${invoice.number}`,
      });
      return { status: "failed" as const, alreadyProcessed: false };
    }

    await ctx.db.patch(payment._id, {
      status: "succeeded",
      providerRef: `TEST-${payment._id}`,
      signatureVerified: true,
      verifiedAt: now,
      paidAt: now,
    });
    await activateInvoice(ctx, {
      invoice,
      actorId: user._id,
      provider: "test",
      reference: `TEST-${payment._id}`,
    });
    return { status: "succeeded" as const, alreadyProcessed: false };
  },
});

/** Creates (or reuses) a renewal invoice; actual activation waits for payment. */
export const renew = mutation({
  args: {
    businessId: v.id("businesses"),
    planId: v.optional(v.id("plans")),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(
      ctx,
      args.businessId,
      { manage: true },
    );
    const subscription = await latestSubscription(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("اشتراکی برای این کسب‌وکار پیدا نشد.");
    }
    const invoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", subscription._id),
      )
      .collect();
    const openInvoice = invoices.find((row) => row.status === "unpaid");
    if (openInvoice) {
      return {
        invoiceId: openInvoice._id,
        number: openInvoice.number,
        amountToman: openInvoice.amountToman,
        reused: true as const,
      };
    }
    const planId = args.planId ?? subscription.planId;
    const plan = await ctx.db.get(planId);
    if (!plan || !plan.active) {
      throw new ConvexError("پلن انتخابی در دسترس نیست.");
    }
    const now = Date.now();
    const periodStart =
      subscription.endAt && subscription.endAt > now
        ? subscription.endAt
        : now;
    const periodEnd = addMonths(periodStart, plan.durationMonths);
    const invoiceNumber = makeInvoiceNumber(now);
    const invoiceId = await ctx.db.insert("subscriptionInvoices", {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      planId: plan._id,
      number: invoiceNumber,
      amountToman: plan.priceToman,
      currency: "IRT",
      status: "unpaid",
      kind: "renewal",
      periodStart,
      periodEnd,
      issuedAt: now,
      dueAt: now + 7 * DAY_MS,
      description: `تمدید ${plan.name} — ${business.name}`,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(subscription._id, {
      lastInvoiceId: invoiceId,
      updatedAt: now,
    });
    return {
      invoiceId,
      number: invoiceNumber,
      amountToman: plan.priceToman,
      reused: false as const,
    };
  },
});

/** Customer-side cancellation. It never deletes financial records. */
export const cancel = mutation({
  args: {
    businessId: v.id("businesses"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(
      ctx,
      args.businessId,
      { manage: true },
    );
    const subscription = await latestSubscription(ctx, args.businessId);
    if (!subscription) throw new ConvexError("اشتراکی پیدا نشد.");
    if (subscription.status === "cancelled") {
      return { cancelled: true, alreadyCancelled: true };
    }
    const reason = requireString(args.reason, "دلیل لغو", {
      max: 300,
    }) as string;
    const now = Date.now();
    await ctx.db.patch(subscription._id, {
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("subscriptionEvents", {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      type: "cancelled",
      fromStatus: subscription.status,
      toStatus: "cancelled",
      actorId: user._id,
      reason,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "subscription.cancelled",
      entity: "subscriptions",
      entityId: subscription._id,
      summary: `لغو اشتراک ${business.name}: ${reason}`,
    });
    return { cancelled: true, alreadyCancelled: false };
  },
});

/**
 * Cron helper: materialises grace/expired statuses. Access checks are already
 * effective without cron, but the stored status must stay observable.
 */
export const refreshStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const settings = await billingSettings(ctx);
    const graceDays = settings?.graceDays ?? DEFAULT_BILLING.graceDays;
    const now = Date.now();
    let changed = 0;
    for (const status of ["active", "grace"] as const) {
      const rows = await ctx.db
        .query("subscriptions")
        .withIndex("by_status_end", (q) => q.eq("status", status))
        .take(500);
      for (const sub of rows) {
        if (!sub.endAt || sub.endAt >= now) continue;
        const graceEnd = sub.endAt + graceDays * DAY_MS;
        const next = now <= graceEnd ? "grace" : "expired";
        if (next === status) continue;
        await ctx.db.patch(sub._id, {
          status: next,
          updatedAt: now,
        });
        await ctx.db.insert("subscriptionEvents", {
          businessId: sub.businessId,
          subscriptionId: sub._id,
          type: next === "grace" ? "grace_started" : "expired",
          fromStatus: status,
          toStatus: next,
          createdAt: now,
        });
        changed += 1;
      }
    }
    return { changed };
  },
});

/**
 * Verified gateway callback. The HTTP layer is responsible for HMAC signature
 * verification with BILLING_WEBHOOK_SECRET; the mutation refuses unsigned
 * success callbacks even if someone calls it internally by mistake.
 */
export const applyWebhook = internalMutation({
  args: {
    provider: v.string(),
    providerRef: v.string(),
    authority: v.optional(v.string()),
    amountToman: v.number(),
    succeeded: v.boolean(),
    signatureVerified: v.boolean(),
    rawStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.signatureVerified) {
      throw new ConvexError("امضای Webhook معتبر نیست.");
    }
    const payment = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_provider_ref", (q) =>
        q.eq("providerRef", args.providerRef),
      )
      .unique();
    if (!payment) {
      throw new ConvexError("پرداخت متناظر با Webhook پیدا نشد.");
    }
    if (payment.provider !== args.provider) {
      throw new ConvexError("درگاه پرداخت با تلاش پرداخت هم‌خوانی ندارد.");
    }
    if (payment.amountToman !== args.amountToman) {
      throw new ConvexError("مبلغ Webhook با فاکتور هم‌خوانی ندارد.");
    }
    if (payment.status === "succeeded") {
      return { status: "succeeded", alreadyProcessed: true };
    }
    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice) throw new ConvexError("فاکتور پرداخت پیدا نشد.");
    const now = Date.now();
    if (!args.succeeded) {
      await ctx.db.patch(payment._id, {
        status: "failed",
        failureReason: args.rawStatus?.slice(0, 200) ?? "پرداخت ناموفق",
        signatureVerified: true,
        verifiedAt: now,
      });
      await ctx.db.patch(invoice._id, { status: "failed", updatedAt: now });
      await ctx.db.insert("subscriptionEvents", {
        businessId: payment.businessId,
        subscriptionId: payment.subscriptionId,
        type: "payment_failed",
        amountToman: payment.amountToman,
        actorId: payment.initiatedBy,
        invoiceId: invoice._id,
        reason: args.rawStatus?.slice(0, 200),
        createdAt: now,
      });
      return { status: "failed", alreadyProcessed: false };
    }
    await ctx.db.patch(payment._id, {
      status: "succeeded",
      authority: args.authority,
      signatureVerified: true,
      verifiedAt: now,
      paidAt: now,
    });
    await activateInvoice(ctx, {
      invoice,
      actorId: payment.initiatedBy,
      provider: args.provider,
      reference: args.providerRef,
    });
    return { status: "succeeded", alreadyProcessed: false };
  },
});

