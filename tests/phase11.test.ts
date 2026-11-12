import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";
import schema from "../src/convex/schema";

/**
 * Phase 11 tests execute the real SaaS backend against convex-test:
 * database plans, onboarding, simulated server-verified payments, duplicate
 * protection, subscription expiry, renewal, tenant isolation, plan limits,
 * legal pages and admin-only revenue. No real gateway or production data is
 * touched.
 */
const modules = {
  "../src/convex/_generated/api.ts": () => import("../src/convex/_generated/api"),
  "../src/convex/backup.ts": () => import("../src/convex/backup"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/hr.ts": () => import("../src/convex/hr"),
  "../src/convex/inventory.ts": () => import("../src/convex/inventory"),
  "../src/convex/legal.ts": () => import("../src/convex/legal"),
  "../src/convex/platform.ts": () => import("../src/convex/platform"),
  "../src/convex/seed.ts": () => import("../src/convex/seed"),
  "../src/convex/subscription.ts": () => import("../src/convex/subscription"),
  "../src/convex/system.ts": () => import("../src/convex/system"),
};

type T = ReturnType<typeof convexTest>;
type Identity = ReturnType<T["withIdentity"]>;

async function identityFor(
  t: T,
  label: string,
  role?: "admin" | "user" | "member",
) {
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: label,
      email: `${label}@test.local`,
      ...(role ? { role } : {}),
    }),
  );
  return { userId, identity: t.withIdentity({ subject: userId }) };
}

async function setup() {
  const t = convexTest(schema, modules);
  const { userId: adminId, identity: admin } = await identityFor(
    t,
    "platform-admin",
    "admin",
  );
  await admin.mutation(api.platform.seedDefaults, {});
  const plans = await admin.query(api.subscription.plans);
  const quarterly = plans.find((plan) => plan.code === "quarterly");
  const annual = plans.find((plan) => plan.code === "annual");
  if (!quarterly || !annual) throw new Error("plans not seeded");
  return { t, adminId, admin, plans, quarterly, annual };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function createOwner(t: T, label: string) {
  const { userId, identity } = await identityFor(t, label);
  return { userId, identity };
}

async function signup(
  identity: Identity,
  planId: Id<"plans">,
  businessName: string,
  key: string,
  email: string,
) {
  return await identity.mutation(api.subscription.startOnboarding, {
    firstName: "مدیر",
    lastName: businessName,
    mobile: "09121234567",
    email,
    businessName,
    businessType: "فروشگاه و خرده‌فروشی",
    city: "تهران",
    planId,
    acceptedTerms: true,
    onboardingKey: key,
  });
}

async function pay(
  identity: Identity,
  invoiceId: string,
  outcome: "success" | "failed" = "success",
) {
  const checkout = await identity.mutation(api.subscription.checkout, {
    invoiceId: invoiceId as Id<"subscriptionInvoices">,
  });
  if (checkout.mode !== "test") {
    throw new Error(`unexpected checkout mode: ${checkout.mode}`);
  }
  const result = await identity.mutation(
    api.subscription.confirmTestPayment,
    {
      paymentId: checkout.paymentId,
      outcome,
    },
  );
  return { checkout, result };
}

describe("Phase 11 SaaS subscriptions", () => {
  test("۱. دو تعرفه رسمی دقیقاً با قیمت و مدت مصوب از دیتابیس خوانده می‌شوند", async () => {
    const s = await setup();
    expect(s.plans).toHaveLength(2);
    expect(s.plans.map((plan) => plan.code)).toEqual([
      "quarterly",
      "annual",
    ]);
    expect(s.quarterly.priceToman).toBe(8_000_000);
    expect(s.quarterly.durationMonths).toBe(3);
    expect(s.annual.priceToman).toBe(18_500_000);
    expect(s.annual.durationMonths).toBe(12);
    expect(s.quarterly.limits.allowedModules.length).toBeGreaterThan(0);
    const again = await s.admin.mutation(api.platform.seedDefaults, {});
    expect(again.createdPlans).toBe(0);
    expect(again.createdLegal).toBe(0);
  });

  test("۲. ثبت‌نام، ساخت فضای اختصاصی و فاکتور در انتظار پرداخت", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-a");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه الف",
      "onboarding-a",
      "owner-a@test.local",
    );
    expect(result.alreadyExists).toBe(false);
    expect(result.invoiceId).toBeTruthy();
    expect(result.amountToman).toBe(8_000_000);

    const billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId: result.businessId,
    });
    expect(billing.access.status).toBe("pending_payment");
    expect(billing.access.canWrite).toBe(false);
    expect(billing.access.testMode).toBe(true);
    expect(billing.subscription?.paymentStatus).toBe("unpaid");
    expect(billing.plan?.priceToman).toBe(8_000_000);
    expect(billing.invoices[0].status).toBe("unpaid");

    await expect(
      owner.identity.mutation(api.customers.create, {
        businessId: result.businessId,
        name: "مشتری قبل از پرداخت",
      }),
    ).rejects.toThrow(/پرداخت|اشتراک/);

    const duplicate = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه الف",
      "onboarding-a",
      "owner-a@test.local",
    );
    expect(duplicate.alreadyExists).toBe(true);
    expect(duplicate.businessId).toBe(result.businessId);
    const refreshed = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه الف",
      "onboarding-a-new-browser-key",
      "owner-a@test.local",
    );
    expect(refreshed.alreadyExists).toBe(true);
    expect(refreshed.businessId).toBe(result.businessId);
    expect(refreshed.invoiceId).toBe(result.invoiceId);
    const businesses = await s.t.run(async (ctx) => ctx.db.query("businesses").take(10));
    expect(businesses).toHaveLength(1);
  });

  test("۳. پرداخت ناموفق اشتراک را فعال نمی‌کند و پرداخت موفق تکراری تأیید نمی‌شود", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-b");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه ب",
      "onboarding-b",
      "owner-b@test.local",
    );
    const failed = await pay(owner.identity, result.invoiceId!, "failed");
    expect(failed.result.status).toBe("failed");
    let billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId: result.businessId,
    });
    expect(billing.access.status).toBe("pending_payment");
    expect(billing.invoices[0].status).toBe("failed");
    await expect(
      owner.identity.mutation(api.customers.create, {
        businessId: result.businessId,
        name: "مشتری پس از خطا",
      }),
    ).rejects.toThrow(/پرداخت|اشتراک/);

    const success = await pay(owner.identity, result.invoiceId!, "success");
    expect(success.result.status).toBe("succeeded");
    billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId: result.businessId,
    });
    expect(billing.access.status).toBe("active");
    expect(billing.access.canWrite).toBe(true);
    expect(billing.invoices[0].status).toBe("paid");
    const endAt = billing.subscription?.endAt ?? 0;
    expect(endAt).toBeGreaterThan(Date.now());

    const duplicate = await owner.identity.mutation(api.subscription.checkout, {
      invoiceId: result.invoiceId!,
    });
    expect(duplicate.mode).toBe("already_paid");
    const afterDuplicate = await owner.identity.query(
      api.subscription.mySubscription,
      { businessId: result.businessId },
    );
    expect(afterDuplicate.subscription?.endAt).toBe(endAt);
    const customer = await owner.identity.mutation(api.customers.create, {
      businessId: result.businessId,
      name: "مشتری اشتراک فعال",
    });
    expect(customer.customerId).toBeTruthy();
    const audits = await s.t.run(async (ctx) =>
      ctx.db.query("auditLogs").take(50),
    );
    expect(
      audits.some((row) => row.action === "subscription.activated"),
    ).toBe(true);
  });

  test("۴. ثبت‌نام و پرداخت پلن یک‌ساله با مبلغ و اعتبار ۱۲ ماه", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-annual");
    const result = await signup(
      owner.identity,
      s.annual._id,
      "شرکت سالانه",
      "onboarding-annual",
      "owner-annual@test.local",
    );
    expect(result.amountToman).toBe(18_500_000);
    await pay(owner.identity, result.invoiceId!);
    const billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId: result.businessId,
    });
    expect(billing.access.status).toBe("active");
    expect(billing.plan?.durationMonths).toBe(12);
    expect(billing.subscription?.endAt).toBeGreaterThan(
      billing.subscription?.startAt ?? 0,
    );
    const days =
      ((billing.subscription?.endAt ?? 0) -
        (billing.subscription?.startAt ?? 0)) /
      (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  test("۵. پایان اعتبار، مهلت تمدید، محدودیت نوشتن و تمدید واقعی", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-expiry");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه تمدید",
      "onboarding-expiry",
      "owner-expiry@test.local",
    );
    await pay(owner.identity, result.invoiceId!);
    const businessId = result.businessId as Id<"businesses">;

    await s.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("subscriptions")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect();
      const sub = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!sub) throw new Error("subscription missing");
      await ctx.db.patch(sub._id, {
        endAt: Date.now() - 24 * 60 * 60 * 1000,
        status: "active",
      });
    });

    let billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });
    expect(billing.access.status).toBe("grace");
    expect(billing.access.canWrite).toBe(false);
    expect(billing.access.daysRemaining).toBeLessThan(0);
    await expect(
      owner.identity.mutation(api.customers.create, {
        businessId,
        name: "مشتری در مهلت تمدید",
      }),
    ).rejects.toThrow(/مهلت تمدید/);

    await s.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("subscriptions")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect();
      const sub = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!sub) throw new Error("subscription missing");
      await ctx.db.patch(sub._id, {
        endAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
        status: "active",
      });
    });
    billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });
    expect(billing.access.status).toBe("expired");
    expect(billing.invoices.length).toBeGreaterThan(0);
    expect(billing.events.some((event) => event.type === "activated")).toBe(
      true,
    );

    const renewal = await owner.identity.mutation(api.subscription.renew, {
      businessId,
      planId: s.annual._id,
    });
    expect(renewal.amountToman).toBe(18_500_000);
    await pay(owner.identity, renewal.invoiceId);
    billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });
    expect(billing.access.status).toBe("active");
    expect(billing.access.canWrite).toBe(true);
    expect(billing.plan?.code).toBe("annual");
    expect(billing.events.some((event) => event.type === "renewed")).toBe(true);
    const renewalAudits = await s.t.run(async (ctx) =>
      ctx.db.query("auditLogs").take(50),
    );
    expect(
      renewalAudits.some((row) => row.action === "subscription.renewed"),
    ).toBe(true);
  });

  test("۶. لغو، تعلیق و فعال‌سازی با دلیل و حفظ داده", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-cancel");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه لغو",
      "onboarding-cancel",
      "owner-cancel@test.local",
    );
    await pay(owner.identity, result.invoiceId!);
    const businessId = result.businessId as Id<"businesses">;
    const before = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });

    await owner.identity.mutation(api.subscription.cancel, {
      businessId,
      reason: "تصمیم موقت مدیر",
    });
    let billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });
    expect(billing.access.status).toBe("cancelled");
    expect(billing.access.canWrite).toBe(false);
    expect(billing.invoices).toHaveLength(before.invoices.length);
    expect(billing.subscription?.cancelReason).toBe("تصمیم موقت مدیر");

    await s.admin.mutation(api.platform.setSubscriptionState, {
      businessId,
      action: "activate",
      reason: "رفع مشکل پرداخت",
    });
    billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });
    expect(billing.access.status).toBe("active");

    await s.admin.mutation(api.platform.setSubscriptionState, {
      businessId,
      action: "suspend",
      reason: "بررسی موقت تخلف",
    });
    billing = await owner.identity.query(api.subscription.mySubscription, {
      businessId,
    });
    expect(billing.access.status).toBe("cancelled");
    expect(billing.access.canWrite).toBe(false);

    const audits = await s.t.run(async (ctx) =>
      ctx.db.query("platformAuditLogs").take(20),
    );
    expect(
      audits.filter((row) =>
        ["subscription.suspended", "subscription.reactivated"].includes(
          row.action,
        ),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("۷. جداسازی مشتریان و محدودیت نقش در اشتراک، فاکتور و پرداخت", async () => {
    const s = await setup();
    const one = await createOwner(s.t, "tenant-one");
    const two = await createOwner(s.t, "tenant-two");
    const first = await signup(
      one.identity,
      s.quarterly._id,
      "کسب‌وکار اول",
      "tenant-key-1",
      "tenant-one@test.local",
    );
    const second = await signup(
      two.identity,
      s.quarterly._id,
      "کسب‌وکار دوم",
      "tenant-key-2",
      "tenant-two@test.local",
    );
    expect(first.businessId).not.toBe(second.businessId);
    await expect(
      two.identity.query(api.subscription.mySubscription, {
        businessId: first.businessId,
      }),
    ).rejects.toThrow(/دسترسی/);
    await expect(
      two.identity.mutation(api.subscription.checkout, {
        invoiceId: first.invoiceId!,
      }),
    ).rejects.toThrow(/دسترسی/);
    const secondBilling = await two.identity.query(
      api.subscription.mySubscription,
      { businessId: second.businessId },
    );
    expect(secondBilling.invoices[0].number).not.toBe(
      (
        await one.identity.query(api.subscription.mySubscription, {
          businessId: first.businessId,
        })
      ).invoices[0].number,
    );

    const viewerId = await s.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "viewer",
        email: "viewer@test.local",
      });
      await ctx.db.insert("businessMembers", {
        businessId: first.businessId as Id<"businesses">,
        userId,
        role: "viewer",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return userId;
    });
    const viewer = s.t.withIdentity({ subject: viewerId });
    const viewerBilling = await viewer.query(api.subscription.mySubscription, {
      businessId: first.businessId,
    });
    expect(viewerBilling.invoices.length).toBeGreaterThan(0);
    await expect(
      viewer.mutation(api.subscription.cancel, {
        businessId: first.businessId,
        reason: "تلاش ناظر",
      }),
    ).rejects.toThrow(/مدیر|دسترسی/);
    await expect(
      viewer.mutation(api.subscription.checkout, {
        invoiceId: first.invoiceId!,
      }),
    ).rejects.toThrow(/مدیر|دسترسی/);
  });

  test("۸. پنل مدیر فقط با نقش ویژه، درآمد واقعی و تمدید دستی", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-admin-view");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "مشتری درآمد",
      "admin-revenue",
      "owner-admin-view@test.local",
    );
    await pay(owner.identity, result.invoiceId!);
    await expect(
      owner.identity.query(api.platform.overview, {}),
    ).rejects.toThrow(/مدیر اصلی/);

    const overview = await s.admin.query(api.platform.overview, {});
    expect(overview.rows).toHaveLength(1);
    expect(overview.totals.paidToman).toBe(8_000_000);
    expect(overview.rows[0].paidTotalToman).toBe(8_000_000);
    expect(
      overview.monthly.reduce((sum, row) => sum + row.amountToman, 0),
    ).toBe(8_000_000);
    expect(overview.rows[0].status).toBe("active");

    const manual = await s.admin.mutation(api.platform.renewManually, {
      businessId: result.businessId,
      planId: s.annual._id,
      reason: "تمدید هدیه سازمانی",
    });
    expect(manual.invoiceId).toBeTruthy();
    const detail = await s.admin.query(api.platform.businessDetail, {
      businessId: result.businessId,
    });
    expect(detail.invoices.some((row) => row.status === "paid")).toBe(true);
    expect(detail.events.some((row) => row.type === "manual_renewal")).toBe(
      true,
    );
    const after = await s.admin.query(api.platform.overview, {});
    expect(after.totals.paidToman).toBe(26_500_000);
    const audits = await s.t.run(async (ctx) =>
      ctx.db.query("platformAuditLogs").take(20),
    );
    expect(audits.some((row) => row.action === "subscription.manual_renewal")).toBe(
      true,
    );
  });

  test("۹. مدیر می‌تواند تعرفه و صفحات حقوقی را ویرایش کند و UI از دیتابیس می‌خواند", async () => {
    const s = await setup();
    await s.admin.mutation(api.platform.updatePlan, {
      planId: s.quarterly._id,
      name: "اشتراک سه‌ماهه ویژه",
      description: "تعرفه به‌روزشده برای تست",
      durationMonths: 4,
      priceToman: 8_100_000,
      active: true,
      features: ["ویژگی تست یک", "ویژگی تست دو"],
      limits: {
        ...s.quarterly.limits,
        maxBranches: 2,
      },
    });
    const publicPlans = await s.t.query(api.subscription.plans);
    const updated = publicPlans.find((plan) => plan.code === "quarterly");
    expect(updated?.priceToman).toBe(8_100_000);
    expect(updated?.durationMonths).toBe(4);
    expect(updated?.name).toBe("اشتراک سه‌ماهه ویژه");
    const buyer = await createOwner(s.t, "owner-new-price");
    const newInvoice = await signup(
      buyer.identity,
      s.quarterly._id,
      "خریدار تعرفه جدید",
      "new-price-key",
      "owner-new-price@test.local",
    );
    expect(newInvoice.amountToman).toBe(8_100_000);
    await s.admin.mutation(api.platform.updateBillingSettings, {
      testMode: false,
      provider: "zarinpal",
      gatewayLabel: "درگاه در حال اتصال",
      graceDays: 7,
    });
    const config = await s.t.query(api.subscription.billingConfig);
    expect(config.testMode).toBe(false);
    expect(config.provider).toBe("zarinpal");
    await expect(
      buyer.identity.mutation(api.subscription.checkout, {
        invoiceId: newInvoice.invoiceId!,
      }),
    ).rejects.toThrow(/درگاه پرداخت واقعی/);

    const pages = await s.admin.query(api.platform.adminLegalPages, {});
    const terms = pages.find((page) => page.slug === "terms");
    if (!terms) throw new Error("terms missing");
    await s.admin.mutation(api.platform.updateLegalPage, {
      pageId: terms._id,
      title: "شرایط به‌روزشده",
      content: "متن جدید شرایط استفاده\n\nبند دوم.",
      active: true,
    });
    const publicPage = await s.t.query(api.legal.get, { slug: "terms" });
    expect(publicPage?.title).toBe("شرایط به‌روزشده");
    expect(publicPage?.version).toBe(2);
  });

  test("۱۰. محدودیت شعب و انبارها از پلن فعال خوانده و سمت سرور اعمال می‌شود", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-limits");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه محدودیت",
      "limits-key",
      "owner-limits@test.local",
    );
    await pay(owner.identity, result.invoiceId!);
    const businessId = result.businessId as Id<"businesses">;
    const branch = await owner.identity.mutation(api.hr.createBranch, {
      businessId,
      name: "شعبه دوم",
      code: "BR-0002",
    });
    expect(branch.branchId).toBeTruthy();
    await expect(
      owner.identity.mutation(api.hr.createBranch, {
        businessId,
        name: "شعبه سوم",
        code: "BR-0003",
      }),
    ).rejects.toThrow(/سقف شعب/);

    for (let index = 1; index <= 3; index += 1) {
      await owner.identity.mutation(api.inventory.createWarehouse, {
        businessId,
        name: `انبار ${index}`,
        code: `WH-000${index}`,
      });
    }
    await expect(
      owner.identity.mutation(api.inventory.createWarehouse, {
        businessId,
        name: "انبار چهارم",
        code: "WH-0004",
      }),
    ).rejects.toThrow(/سقف انبار/);
  });

  test("۱۱. پرداخت بدون امضای Webhook رد می‌شود و ساخت خودکار بدون اشتراک ممکن نیست", async () => {
    const s = await setup();
    const unprovisioned = await createOwner(s.t, "owner-no-workspace");
    await expect(
      unprovisioned.identity.mutation(api.businesses.ensure, {}),
    ).rejects.toThrow(/فضای کاری/);
    await expect(
      s.t.mutation(internal.subscription.applyWebhook, {
        provider: "zarinpal",
        providerRef: "forged-ref",
        amountToman: 8_000_000,
        succeeded: true,
        signatureVerified: false,
      }),
    ).rejects.toThrow(/امضا/);
  });

  test("۱۲. بازیابی بکاپ فضای جدید را رایگان نمی‌کند و آن را در انتظار پرداخت می‌گذارد", async () => {
    const s = await setup();
    const owner = await createOwner(s.t, "owner-restore");
    const result = await signup(
      owner.identity,
      s.quarterly._id,
      "فروشگاه بازیابی",
      "restore-key",
      "owner-restore@test.local",
    );
    await pay(owner.identity, result.invoiceId!);
    const backup = await owner.identity.action(api.backup.create, {
      businessId: result.businessId,
    });
    const restored = await owner.identity.action(api.backup.restore, {
      businessId: result.businessId,
      jobId: backup.jobId,
    });
    expect(restored.businessId).not.toBe(result.businessId);
    const access = await owner.identity.query(api.subscription.access, {
      businessId: restored.businessId,
    });
    expect(access.required).toBe(true);
    expect(access.status).toBe("pending_payment");
    expect(access.canRead).toBe(true);
    expect(access.canWrite).toBe(false);
    expect(access.plan?.code).toBe("quarterly");
  }, 30_000);
});
