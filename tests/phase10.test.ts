import { afterEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";
import schema from "../src/convex/schema";

/**
 * Phase 10 security, backup/restore and acceptance suite.
 *
 * Backups are real Convex actions writing a JSON snapshot into File Storage;
 * restore opens that snapshot again, verifies the checksum and rebuilds every
 * tenant table in a NEW business. Nothing here touches production data.
 */
const modules = {
  "../src/convex/_generated/api.ts": () => import("../src/convex/_generated/api"),
  "../src/convex/accountingDocuments.ts": () => import("../src/convex/accountingDocuments"),
  "../src/convex/accountingReports.ts": () => import("../src/convex/accountingReports"),
  "../src/convex/accounts.ts": () => import("../src/convex/accounts"),
  "../src/convex/analytics.ts": () => import("../src/convex/analytics"),
  "../src/convex/backup.ts": () => import("../src/convex/backup"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/commerceReports.ts": () => import("../src/convex/commerceReports"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/files.ts": () => import("../src/convex/files"),
  "../src/convex/incomeExpenses.ts": () => import("../src/convex/incomeExpenses"),
  "../src/convex/inventory.ts": () => import("../src/convex/inventory"),
  "../src/convex/paymentVouchers.ts": () => import("../src/convex/paymentVouchers"),
  "../src/convex/products.ts": () => import("../src/convex/products"),
  "../src/convex/purchases.ts": () => import("../src/convex/purchases"),
  "../src/convex/receipts.ts": () => import("../src/convex/receipts"),
  "../src/convex/sales.ts": () => import("../src/convex/sales"),
  "../src/convex/suppliers.ts": () => import("../src/convex/suppliers"),
  "../src/convex/system.ts": () => import("../src/convex/system"),
  "../src/convex/treasury.ts": () => import("../src/convex/treasury"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "مدیر امنیت",
      email: `owner-${Math.random()}@test.local`,
    }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { businessId } = await owner.mutation(internal.businesses.seedWorkspace, {});
  const context = await owner.query(api.businesses.context);
  const fiscalYear = context.fiscalYears.find(
    (year) => year.businessId === businessId && year.status === "open",
  );
  const branch = context.branches.find((row) => row.businessId === businessId);
  if (!fiscalYear || !branch) throw new Error("Workspace defaults missing");

  const viewerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "ناظر امنیت",
      email: `viewer-${Math.random()}@test.local`,
    }),
  );
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("businessMembers", {
      businessId: businessId as Id<"businesses">,
      userId: viewerId,
      role: "viewer",
      displayName: "ناظر امنیت",
      createdAt: now,
      updatedAt: now,
    });
  });
  const viewer = t.withIdentity({ subject: viewerId });

  const strangerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "کسب‌وکار دوم",
      email: `stranger-${Math.random()}@test.local`,
    }),
  );
  const stranger = t.withIdentity({ subject: strangerId });
  const { businessId: otherBusinessId } = await stranger.mutation(
    internal.businesses.seedWorkspace,
    {},
  );

  return {
    t,
    owner,
    ownerId,
    viewer,
    stranger,
    strangerId,
    businessId: businessId as Id<"businesses">,
    otherBusinessId: otherBusinessId as Id<"businesses">,
    fiscalYearId: fiscalYear._id as Id<"fiscalYears">,
    fiscalYearStart: fiscalYear.startAt,
    fiscalYearEnd: fiscalYear.endAt,
    branchId: branch._id as Id<"branches">,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function seedBooks(s: Setup) {
  const customer = await s.owner.mutation(api.customers.create, {
    businessId: s.businessId,
    name: "شرکت خریدار پذیرش",
    personType: "legal",
    creditLimit: 900_000_000,
  });
  const supplier = await s.owner.mutation(api.suppliers.create, {
    businessId: s.businessId,
    name: "تأمین‌کننده پذیرش",
    personType: "legal",
  });
  const product = await s.owner.mutation(api.products.create, {
    businessId: s.businessId,
    name: "کالای پذیرش",
    unit: "عدد",
    purchasePrice: 1_000_000,
    salePrice: 2_000_000,
    taxRateBps: 0,
    productType: "physical",
  });
  const warehouse = await s.owner.mutation(api.inventory.createWarehouse, {
    businessId: s.businessId,
    name: "انبار پذیرش",
    isDefault: true,
  });

  const opening = await s.owner.mutation(api.inventory.createDocument, {
    businessId: s.businessId,
    type: "receipt",
    toWarehouseId: warehouse.warehouseId,
    occurredAt: Date.now(),
    description: "موجودی اولیه",
    lines: [
      {
        productId: product.productId,
        quantityMilli: 100_000,
        unitCost: 1_000_000,
      },
    ],
  });
  await s.owner.mutation(api.inventory.postDocument, {
    businessId: s.businessId,
    documentId: opening.documentId,
  });

  const purchase = await s.owner.mutation(api.purchases.create, {
    businessId: s.businessId,
    supplierId: supplier.supplierId,
    warehouseId: warehouse.warehouseId,
    lines: [
      {
        productId: product.productId,
        quantityMilli: 80_000,
        unitCost: 1_200_000,
        taxRateBps: 0,
      },
    ],
  });

  const sale = await s.owner.mutation(api.sales.create, {
    businessId: s.businessId,
    customerId: customer.customerId,
    warehouseId: warehouse.warehouseId,
    status: "issued",
    lines: [
      {
        productId: product.productId,
        quantityMilli: 50_000,
        unitPrice: 2_000_000,
        taxRateBps: 0,
      },
    ],
  });
  const fund = await s.owner.mutation(api.treasury.createFund, {
    businessId: s.businessId,
    name: "صندوق پذیرش",
    openingBalance: 0,
    openingDate: Date.now(),
  });
  const receipt = await s.owner.mutation(api.receipts.create, {
    businessId: s.businessId,
    partyType: "customer",
    customerId: customer.customerId,
    partyName: "شرکت خریدار پذیرش",
    invoiceId: sale.invoiceId,
    amount: 40_000_000,
    method: "cash",
    destinationType: "cash",
    cashFundId: fund.cashFundId,
    description: "دریافت بخشی از فروش",
    occurredAt: Date.now(),
  });
  await s.owner.mutation(api.receipts.post, {
    businessId: s.businessId,
    receiptId: receipt.receiptId,
  });

  const payment = await s.owner.mutation(api.paymentVouchers.create, {
    businessId: s.businessId,
    partyType: "supplier",
    supplierId: supplier.supplierId,
    purchaseInvoiceId: purchase.invoiceId,
    partyName: "تأمین‌کننده پذیرش",
    amount: 20_000_000,
    method: "cash",
    sourceType: "cash",
    cashFundId: fund.cashFundId,
    description: "پرداخت بخشی از خرید",
    occurredAt: Date.now(),
  });
  await s.owner.mutation(api.paymentVouchers.post, {
    businessId: s.businessId,
    voucherId: payment.voucherId,
  });

  await s.owner.mutation(api.incomeExpenses.createExpense, {
    businessId: s.businessId,
    category: "rent",
    supplierName: "مالک دفتر",
    amount: 800_000,
    description: "اجاره ماه جاری",
    occurredAt: Date.now(),
    status: "approved",
  });

  return {
    customerId: customer.customerId as Id<"customers">,
    supplierId: supplier.supplierId as Id<"suppliers">,
    purchaseId: purchase.invoiceId as Id<"purchaseInvoices">,
    productId: product.productId as Id<"products">,
    warehouseId: warehouse.warehouseId as Id<"warehouses">,
    fundId: fund.cashFundId as Id<"cashFunds">,
    saleId: sale.invoiceId as Id<"invoices">,
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

afterEach(() => {
  delete process.env.ZAI_API_KEY;
  delete process.env.AI_DISABLED;
});

describe("Phase 10 security, backup and acceptance", () => {
  test("۱. بدون نشست، کسب‌وکار و تنظیمات قابل خواندن نیست", async () => {
    const s = await setup();
    const anonymous = s.t;
    expect(await rejection(anonymous.query(api.customers.list, { businessId: s.businessId }))).toContain("وارد");
    expect(await rejection(anonymous.query(api.system.settings, { businessId: s.businessId }))).toContain("وارد");
    expect(await rejection(anonymous.mutation(api.system.updateSettings, {
      businessId: s.businessId,
      displayName: "هک",
      calendar: "jalali",
      timezone: "Asia/Tehran",
      printOrientation: "portrait",
      notificationsEnabled: true,
      lowStockAlerts: true,
      backupEnabled: true,
      backupFrequency: "daily",
      backupHourUtc: 1,
      backupRetentionDays: 30,
    }))).toContain("وارد");
  });

  test("۲. ناظر به تنظیمات، سلامت، خطاها و بکاپ مدیریتی دسترسی ندارد", async () => {
    const s = await setup();
    expect(await rejection(s.viewer.query(api.system.settings, { businessId: s.businessId }))).toContain("مدیر");
    expect(await rejection(s.viewer.query(api.system.health, { businessId: s.businessId }))).toContain("مدیر");
    expect(await rejection(s.viewer.query(api.system.errors, { businessId: s.businessId }))).toContain("مدیر");
    expect(await rejection(s.viewer.query(api.backup.list, { businessId: s.businessId }))).toContain("مدیر");
    expect(await rejection(s.viewer.action(api.backup.create, { businessId: s.businessId }))).toContain("مدیر");
  });

  test("۳. کسب‌وکار دیگر به تنظیمات، گزارش، فایل و بکاپ دسترسی ندارد", async () => {
    const s = await setup();
    const seeded = await seedBooks(s);
    const storageId = await s.t.run((ctx) =>
      ctx.storage.store(new Blob(["tenant-private"], { type: "text/plain" })),
    );
    // convex-test does not implement storage.getMetadata (used by the upload
    // registration mutation); insert the real catalog row to exercise the
    // authorization checks below. The registration mutation itself is covered
    // by a live development-backend check, reported separately.
    await s.t.run(async (ctx) => {
      await ctx.db.insert("fileUploads", {
        businessId: s.businessId,
        storageId,
        name: "private.txt",
        mimeType: "text/plain",
        size: 14,
        uploadedBy: s.ownerId,
        createdAt: Date.now(),
      });
    });

    expect(await rejection(s.stranger.query(api.system.settings, { businessId: s.businessId }))).toContain("دسترسی");
    expect(await rejection(s.stranger.query(api.system.health, { businessId: s.businessId }))).toContain("دسترسی");
    expect(await rejection(s.stranger.action(api.backup.create, { businessId: s.businessId }))).toContain("دسترسی");
    expect(await rejection(s.stranger.query(api.analytics.run, {
      businessId: s.businessId,
      reportKey: "balance-sheet",
      fiscalYearId: s.fiscalYearId,
      from: s.fiscalYearStart,
      to: s.fiscalYearEnd,
    }))).toContain("دسترسی");
    expect(await rejection(s.stranger.query(api.files.url, { businessId: s.businessId, storageId }))).toContain("دسترسی");
    expect(await rejection(s.stranger.query(api.sales.get, {
      businessId: s.businessId,
      invoiceId: seeded.saleId,
    }))).toContain("دسترسی");

    const ownFile = await s.owner.mutation(api.files.assertBusinessFile, {
      businessId: s.businessId,
      storageId,
    });
    expect(ownFile).toBe(true);
  });

  test("۴. ثبت فایل از کسب‌وکار دیگر و آپلود بدون ثبت رد می‌شود", async () => {
    const s = await setup();
    const storageId = await s.t.run((ctx) =>
      ctx.storage.store(new Blob(["other-tenant"], { type: "text/plain" })),
    );
    await s.t.run(async (ctx) => {
      await ctx.db.insert("fileUploads", {
        businessId: s.otherBusinessId,
        storageId,
        name: "other.txt",
        mimeType: "text/plain",
        size: 11,
        uploadedBy: s.strangerId,
        createdAt: Date.now(),
      });
    });
    expect(await rejection(s.owner.query(api.files.url, {
      businessId: s.businessId,
      storageId,
    }))).toContain("این فایل");

    const unregistered = await s.t.run((ctx) =>
      ctx.storage.store(new Blob(["unregistered"], { type: "text/plain" })),
    );
    expect(await rejection(s.owner.mutation(api.products.create, {
      businessId: s.businessId,
      name: "کالای فایل غیرمجاز",
      unit: "عدد",
      purchasePrice: 10,
      salePrice: 20,
      taxRateBps: 0,
      productType: "physical",
      imageStorageId: unregistered,
    }))).toContain("تعلق ندارد");
  });

  test("۵. تنظیمات واقعی ذخیره و Audit می‌شود و مقدار نامعتبر رد می‌شود", async () => {
    const s = await setup();
    await s.owner.mutation(api.system.updateSettings, {
      businessId: s.businessId,
      displayName: "حساب ویرا — دفتر مرکزی",
      legalName: "شرکت نمونه",
      calendar: "gregorian",
      timezone: "Asia/Tehran",
      invoiceFooter: "با تشکر از خرید شما",
      printOrientation: "landscape",
      notificationsEnabled: false,
      lowStockAlerts: true,
      backupEnabled: true,
      backupFrequency: "weekly",
      backupHourUtc: 3,
      backupRetentionDays: 60,
    });
    const saved = await s.owner.query(api.system.settings, { businessId: s.businessId });
    expect(saved.businessName).toBe("حساب ویرا — دفتر مرکزی");
    expect(saved.calendar).toBe("gregorian");
    expect(saved.backupRetentionDays).toBe(60);
    expect(saved.printOrientation).toBe("landscape");

    expect(await rejection(s.owner.mutation(api.system.updateSettings, {
      businessId: s.businessId,
      displayName: "x",
      calendar: "jalali",
      timezone: "Asia/Tehran",
      printOrientation: "portrait",
      notificationsEnabled: true,
      lowStockAlerts: true,
      backupEnabled: true,
      backupFrequency: "daily",
      backupHourUtc: 1,
      backupRetentionDays: 30,
    }))).toContain("۲ تا ۱۲۰");
    expect(await rejection(s.owner.mutation(api.system.updateSettings, {
      businessId: s.businessId,
      displayName: "نام معتبر",
      calendar: "jalali",
      timezone: "not-a-timezone",
      printOrientation: "portrait",
      notificationsEnabled: true,
      lowStockAlerts: true,
      backupEnabled: true,
      backupFrequency: "daily",
      backupHourUtc: 1,
      backupRetentionDays: 30,
    }))).toContain("منطقه زمانی");
    expect(await rejection(s.owner.mutation(api.system.updateSettings, {
      businessId: s.businessId,
      displayName: "نام معتبر",
      calendar: "jalali",
      timezone: "Asia/Tehran",
      printOrientation: "portrait",
      notificationsEnabled: true,
      lowStockAlerts: true,
      backupEnabled: true,
      backupFrequency: "daily",
      backupHourUtc: 24,
      backupRetentionDays: 30,
    }))).toContain("۰ تا ۲۳");

    const audit = await s.owner.query(api.system.audit, { businessId: s.businessId });
    expect(audit.some((row) => row.action === "settings.update")).toBe(true);
  });

  test("۶. Rate Limit واقعی پس از ۲۰ نشست در ساعت فعال می‌شود", async () => {
    const s = await setup();
    for (let i = 0; i < 20; i += 1) {
      await s.owner.mutation(api.system.noteSession, {
        businessId: s.businessId,
        event: "session_start",
      });
    }
    const blocked = await rejection(
      s.owner.mutation(api.system.noteSession, {
        businessId: s.businessId,
        event: "session_start",
      }),
    );
    expect(blocked).toContain("بیش از حد");
    const events = await s.owner.query(api.system.securityLog, { businessId: s.businessId });
    expect(events.length).toBeGreaterThanOrEqual(20);
  });

  test("۷. خطای Frontend پاک‌سازی می‌شود و قابل Resolve است", async () => {
    const s = await setup();
    const errorId = await s.owner.mutation(api.system.reportClientError, {
      businessId: s.businessId,
      message: "خطا token=sk-super-secret برای user@example.com",
      route: "/dashboard/test?token=abc",
      errorId: "ui_test_1",
    });
    const rows = await s.owner.query(api.system.errors, { businessId: s.businessId });
    const row = rows.find((item) => item.errorId === errorId);
    expect(row).toBeTruthy();
    expect(row?.message).not.toContain("sk-super-secret");
    expect(row?.message).not.toContain("user@example.com");
    expect(row?.resolvedAt).toBeFalsy();
    await s.owner.mutation(api.system.resolveError, {
      businessId: s.businessId,
      errorId: row!._id,
    });
    const after = await s.owner.query(api.system.errors, { businessId: s.businessId });
    expect(after.find((item) => item._id === row!._id)?.resolvedAt).toBeTruthy();
    expect(await rejection(s.stranger.mutation(api.system.resolveError, {
      businessId: s.businessId,
      errorId: row!._id,
    }))).toContain("دسترسی");
  });

  test("۸. صفحه سلامت وضعیت واقعی دیتابیس، فایل و AI محلی را برمی‌گرداند", async () => {
    const s = await setup();
    const health = await s.owner.action(api.system.runHealthCheck, {
      businessId: s.businessId,
    });
    // convex-test implements storage.get/store but not storage.getMetadata,
    // which the real Convex backend provides. The probe is therefore reported
    // as critical in this harness; production uses the same action against the
    // real File Storage service. Everything else must still be healthy.
    expect(["healthy", "unhealthy"]).toContain(health.status);
    const checks = new Map(health.checks.map((check) => [check.key, check]));
    expect(checks.get("database")?.status).toBe("healthy");
    expect(checks.get("backend")?.status).toBe("healthy");
    expect(["healthy", "critical"]).toContain(checks.get("storage")!.status);
    expect(checks.get("ai")?.status).toBe("healthy");
    expect(checks.get("backup")?.status).toBe("warning");
    expect(health.version).toBe("1.0.0");
    const queryHealth = await s.owner.query(api.system.health, {
      businessId: s.businessId,
    });
    expect(queryHealth.lastCheckStatus).toBe(health.status);
    expect(queryHealth.checks.find((check) => check.key === "ai")?.status).toBe("healthy");
  }, 20_000);

  test("۹. بکاپ واقعی در Storage نوشته و با Checksum تأیید می‌شود", async () => {
    const s = await setup();
    const seeded = await seedBooks(s);
    const created = await s.owner.action(api.backup.create, {
      businessId: s.businessId,
    });
    expect(created.rowCount).toBeGreaterThan(10);
    expect(created.checksum).toHaveLength(16);
    const jobs = await s.owner.query(api.backup.list, {
      businessId: s.businessId,
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("success");
    expect(jobs[0].downloadReady).toBe(true);
    expect(jobs[0].checksum).toBe(created.checksum);

    const size = await s.t.run(async (ctx) => {
      const job = await ctx.db.get(jobs[0]._id as Id<"backupJobs">);
      if (!job?.storageId) return 0;
      const stored = await ctx.storage.get(job.storageId);
      return stored?.size ?? 0;
    });
    expect(size).toBeGreaterThan(500);

    const verified = await s.owner.action(api.backup.verify, {
      businessId: s.businessId,
      jobId: jobs[0]._id as Id<"backupJobs">,
    });
    expect(verified.ok).toBe(true);
    expect(verified.checksumMatches).toBe(true);
    expect(verified.countsMatch).toBe(true);
    expect(verified.rowCount).toBe(created.rowCount);

    const salesRows = await s.owner.query(api.commerceReports.report, {
      businessId: s.businessId,
      kind: "sales-by-customer",
    });
    expect(salesRows.rows.length).toBeGreaterThan(0);
    expect(seeded.customerId).toBeTruthy();
  }, 30_000);

  test("۱۰. Restore واقعی کسب‌وکار جدید می‌سازد و داده مبدأ را دست‌نخورده نگه می‌دارد", async () => {
    const s = await setup();
    const seeded = await seedBooks(s);
    const job = await s.owner.action(api.backup.create, {
      businessId: s.businessId,
    });
    const restored = await s.owner.action(api.backup.restore, {
      businessId: s.businessId,
      jobId: job.jobId,
    });
    expect(restored.businessId).not.toBe(s.businessId);
    expect(restored.rows).toBe(job.rowCount);
    expect(restored.tables).toBe(job.tableCount);

    const newCustomers = await s.owner.query(api.customers.list, {
      businessId: restored.businessId,
    });
    expect(newCustomers.some((row) => row.name === "شرکت خریدار پذیرش")).toBe(true);
    const newProducts = await s.owner.query(api.products.list, {
      businessId: restored.businessId,
    });
    expect(newProducts.some((row) => row.name === "کالای پذیرش")).toBe(true);
    const restoredSale = await s.owner.query(api.sales.get, {
      businessId: restored.businessId,
      invoiceId: seeded.saleId,
    }).catch(() => null);
    // The restored IDs differ; sales.get is checked through the restored list.
    expect(restoredSale).toBeNull();
    const newSales = await s.owner.query(api.sales.list, {
      businessId: restored.businessId,
    });
    expect(newSales.length).toBe(1);

    const originalCustomers = await s.owner.query(api.customers.list, {
      businessId: s.businessId,
    });
    expect(originalCustomers.length).toBe(1);
    const jobs = await s.owner.query(api.backup.list, {
      businessId: s.businessId,
    });
    expect(jobs.some((row) => row.trigger === "pre_restore")).toBe(true);
    expect(jobs.find((row) => row._id === job.jobId)?.restoredBusinessId).toBe(restored.businessId);

    const context = await s.owner.query(api.businesses.context);
    expect(context?.workspaces.some((row) => row.business._id === restored.businessId)).toBe(true);
    expect(context?.workspaces.some((row) => row.business._id === s.businessId)).toBe(true);
    expect(await rejection(s.viewer.action(api.backup.restore, {
      businessId: s.businessId,
      jobId: job.jobId,
    }))).toContain("مدیر");
  }, 60_000);

  test("۱۱. سناریوی پذیرش کامل از خرید و فروش تا تراز، سود و زیان، Excel و بکاپ", async () => {
    const s = await setup();
    const seeded = await seedBooks(s);

    const trial = await s.owner.query(api.accountingReports.trialBalanceReport, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      level: "detail",
    });
    expect(trial.totalDebit).toBeGreaterThan(0);
    expect(trial.difference).toBe(0);

    const balance = await s.owner.query(api.analytics.run, {
      businessId: s.businessId,
      reportKey: "balance-sheet",
      fiscalYearId: s.fiscalYearId,
      from: s.fiscalYearStart,
      to: s.fiscalYearEnd,
    });
    const difference = balance.summary.find((item) => item.key === "difference")?.value;
    expect(Number(difference)).toBe(0);

    const income = await s.owner.query(api.analytics.run, {
      businessId: s.businessId,
      reportKey: "income-statement",
      fiscalYearId: s.fiscalYearId,
      from: s.fiscalYearStart,
      to: s.fiscalYearEnd,
    });
    const revenue = Number(income.summary.find((item) => item.key === "revenue")?.value ?? 0);
    expect(revenue).toBe(100_000_000);

    const cash = await s.owner.query(api.commerceReports.report, {
      businessId: s.businessId,
      kind: "sales-by-customer",
    });
    expect(cash.rows.length).toBe(1);

    const invoice = await s.owner.query(api.sales.get, {
      businessId: s.businessId,
      invoiceId: seeded.saleId,
    });
    expect(invoice.outstanding).toBe(60_000_000);
    const customer = await s.owner.query(api.customers.profile, {
      businessId: s.businessId,
      customerId: seeded.customerId,
    });
    expect(customer.outstanding).toBe(60_000_000);
    const supplier = await s.owner.query(api.suppliers.get, {
      businessId: s.businessId,
      supplierId: seeded.supplierId,
    });
    expect(supplier.balance).toBe(76_000_000);

    const stock = await s.owner.query(api.inventory.balances, {
      businessId: s.businessId,
    });
    const stockRow = stock.rows.find((row) => row.productId === seeded.productId);
    expect(stockRow?.quantityMilli).toBe(130_000);

    const job = await s.owner.action(api.backup.create, {
      businessId: s.businessId,
    });
    expect(job.rowCount).toBeGreaterThan(10);
    const verified = await s.owner.action(api.backup.verify, {
      businessId: s.businessId,
      jobId: job.jobId,
    });
    expect(verified.checksumMatches).toBe(true);
  }, 60_000);
});
