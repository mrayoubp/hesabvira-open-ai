import { afterEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import ExcelJS from "exceljs";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
} from "../src/convex/lib/reportCatalog";
import schema from "../src/convex/schema";
import { buildReportWorkbook } from "../src/lib/reportExport";

/**
 * Phase 9 acceptance suite.
 *
 * Every number is created through the real Phase 6–8 mutations first, then the
 * report engine is queried. No fixture bypasses the accounting or inventory
 * posting rules. Browser-only PDF/print rendering is intentionally not faked:
 * XLSX is built and re-opened here; PDF/print are covered by catalog/export-log
 * checks and are reported as a manual browser verification in delivery notes.
 */
const modules = {
  "../src/convex/_generated/api.ts": () => import("../src/convex/_generated/api"),
  "../src/convex/accounts.ts": () => import("../src/convex/accounts"),
  "../src/convex/accountingDocuments.ts": () =>
    import("../src/convex/accountingDocuments"),
  "../src/convex/analytics.ts": () => import("../src/convex/analytics"),
  "../src/convex/ai.ts": () => import("../src/convex/ai"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/incomeExpenses.ts": () => import("../src/convex/incomeExpenses"),
  "../src/convex/inventory.ts": () => import("../src/convex/inventory"),
  "../src/convex/products.ts": () => import("../src/convex/products"),
  "../src/convex/purchases.ts": () => import("../src/convex/purchases"),
  "../src/convex/receipts.ts": () => import("../src/convex/receipts"),
  "../src/convex/reportCenter.ts": () => import("../src/convex/reportCenter"),
  "../src/convex/sales.ts": () => import("../src/convex/sales"),
  "../src/convex/suppliers.ts": () => import("../src/convex/suppliers"),
  "../src/convex/treasury.ts": () => import("../src/convex/treasury"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "مدیر گزارش",
      email: `report-${Math.random()}@test.local`,
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
      name: "ناظر گزارش",
      email: `viewer-${Math.random()}@test.local`,
    }),
  );
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("businessMembers", {
      businessId: businessId as Id<"businesses">,
      userId: viewerId,
      role: "viewer",
      displayName: "ناظر گزارش",
      createdAt: now,
      updatedAt: now,
    });
  });
  const viewer = t.withIdentity({ subject: viewerId });

  const strangerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "کسب‌وکار دیگر",
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
    viewerId,
    stranger,
    otherBusinessId: otherBusinessId as Id<"businesses">,
    businessId: businessId as Id<"businesses">,
    fiscalYearId: fiscalYear._id as Id<"fiscalYears">,
    fiscalYearStart: fiscalYear.startAt,
    fiscalYearEnd: fiscalYear.endAt,
    branchId: branch._id as Id<"branches">,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function seedBooks(s: Setup) {
  const customerId = (
    await s.owner.mutation(api.customers.create, {
      businessId: s.businessId,
      name: "شرکت خریدار نمونه",
      personType: "legal",
      creditLimit: 500_000_000,
    })
  ).customerId as Id<"customers">;

  const supplierId = (
    await s.owner.mutation(api.suppliers.create, {
      businessId: s.businessId,
      name: "تأمین‌کننده نمونه",
      personType: "legal",
    })
  ).supplierId as Id<"suppliers">;

  const productId = (
    await s.owner.mutation(api.products.create, {
      businessId: s.businessId,
      name: "کالای گزارش",
      unit: "عدد",
      purchasePrice: 1_000_000,
      salePrice: 2_000_000,
      taxRateBps: 0,
      minStockMilli: 5_000,
      productType: "physical",
    })
  ).productId as Id<"products">;

  const warehouseId = (
    await s.owner.mutation(api.inventory.createWarehouse, {
      businessId: s.businessId,
      name: "انبار گزارش",
      isDefault: true,
    })
  ).warehouseId as Id<"warehouses">;

  const opening = await s.owner.mutation(api.inventory.createDocument, {
    businessId: s.businessId,
    type: "receipt",
    toWarehouseId: warehouseId,
    occurredAt: Date.now(),
    description: "موجودی اولیه واقعی",
    lines: [{ productId, quantityMilli: 100_000, unitCost: 1_000_000 }],
  });
  await s.owner.mutation(api.inventory.postDocument, {
    businessId: s.businessId,
    documentId: opening.documentId,
  });

  await s.owner.mutation(api.purchases.create, {
    businessId: s.businessId,
    supplierId,
    warehouseId,
    lines: [
      { productId, quantityMilli: 80_000, unitCost: 1_200_000, taxRateBps: 0 },
    ],
  });

  const sale = await s.owner.mutation(api.sales.create, {
    businessId: s.businessId,
    customerId,
    warehouseId,
    status: "issued",
    lines: [
      { productId, quantityMilli: 50_000, unitPrice: 2_000_000, taxRateBps: 0 },
    ],
  });

  const fundId = (
    await s.owner.mutation(api.treasury.createFund, {
      businessId: s.businessId,
      name: "صندوق گزارش",
      openingBalance: 0,
      openingDate: Date.now(),
    })
  ).cashFundId as Id<"cashFunds">;

  const receipt = await s.owner.mutation(api.receipts.create, {
    businessId: s.businessId,
    partyType: "customer",
    customerId,
    partyName: "شرکت خریدار نمونه",
    invoiceId: sale.invoiceId,
    amount: 40_000_000,
    method: "cash",
    destinationType: "cash",
    cashFundId: fundId,
    description: "دریافت بخشی از مطالبات",
    occurredAt: Date.now(),
  });
  await s.owner.mutation(api.receipts.post, {
    businessId: s.businessId,
    receiptId: receipt.receiptId,
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

  const saleDetail = await s.owner.query(api.sales.get, {
    businessId: s.businessId,
    invoiceId: sale.invoiceId,
  });

  return {
    customerId,
    supplierId,
    productId,
    warehouseId,
    fundId,
    saleId: sale.invoiceId,
    saleCost: saleDetail.costOfGoods,
  };
}

type Seeded = Awaited<ReturnType<typeof seedBooks>>;

const report = (
  s: Setup,
  reportKey: string,
  overrides: {
    from?: number;
    to?: number;
    branchId?: Id<"branches">;
    search?: string;
  } = {},
) =>
  s.owner.query(api.analytics.run, {
    businessId: s.businessId,
    reportKey,
    fiscalYearId: s.fiscalYearId,
    from: overrides.from ?? s.fiscalYearStart,
    to: overrides.to ?? s.fiscalYearEnd,
    branchId: overrides.branchId,
    search: overrides.search,
  });

function summaryValue(
  payload: { summary: { key: string; value: number | string }[] },
  key: string,
) {
  return Number(payload.summary.find((item) => item.key === key)?.value ?? 0);
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
  delete process.env.ZAI_API_BASE;
  delete process.env.ZAI_MODEL;
  delete process.env.AI_DISABLED;
});

describe("Phase 9 report center, analysis and Vira AI", () => {
  test("۱. ترازنامه از اسناد قطعی ساخته می‌شود و اختلاف کنترل صفر است", async () => {
    const s = await setup();
    await seedBooks(s);
    const balance = await report(s, "balance-sheet");
    expect(balance.title).toBe("ترازنامه");
    expect(balance.meta.businessName).toBeTruthy();
    expect(summaryValue(balance, "assets")).toBeGreaterThan(0);
    expect(summaryValue(balance, "difference")).toBe(0);
    expect(balance.sections.find((row) => row.key === "assets")?.rows.length).toBeGreaterThan(0);
    expect(balance.evidence.length).toBeGreaterThan(0);
  });

  test("۲. صورت سود و زیان با فروش، بهای تمام‌شده و هزینه واقعی می‌بندد", async () => {
    const s = await setup();
    const seeded = await seedBooks(s);
    const income = await report(s, "income-statement");
    const revenue = summaryValue(income, "revenue");
    const cogs = summaryValue(income, "cogs");
    const opex = summaryValue(income, "opex");
    expect(revenue).toBe(100_000_000);
    expect(cogs).toBe(seeded.saleCost);
    expect(opex).toBe(800_000);
    expect(summaryValue(income, "net")).toBe(revenue - cogs - opex);
    expect(summaryValue(income, "gross")).toBe(revenue - cogs);
  });

  test("۳. جریان نقدی فقط دریافت واقعی صندوق را نشان می‌دهد", async () => {
    const s = await setup();
    await seedBooks(s);
    const cash = await report(s, "cash-flow-statement");
    expect(summaryValue(cash, "inflow")).toBe(40_000_000);
    expect(summaryValue(cash, "outflow")).toBe(0);
    expect(summaryValue(cash, "closing")).toBe(40_000_000);
    expect(cash.sections[0].rows.some((row) => row.label.includes("دریافت"))).toBe(true);
  });

  test("۴. تحلیل سود، مقایسه دوره قبل و روند ماهانه را می‌سازد", async () => {
    const s = await setup();
    await seedBooks(s);
    const profit = await report(s, "profit-analysis");
    expect(summaryValue(profit, "revenue")).toBe(100_000_000);
    const comparison = profit.sections.find((row) => row.key === "comparison");
    const salesRow = comparison?.rows.find((row) => row.metric === "فروش");
    expect(salesRow?.current).toBe(100_000_000);
    expect(salesRow?.previous).toBe(0);
    expect(profit.chart?.data.length).toBeGreaterThan(0);
    expect(profit.chart?.type).toBe("line");
  });

  test("۵. گزارش شعب، فروش و مطالبات همان شعبه را جدا می‌کند", async () => {
    const s = await setup();
    await seedBooks(s);
    const branches = await report(s, "branch-comparison");
    const rows = branches.sections[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBeTruthy();
    expect(rows[0].sales).toBe(100_000_000);
    expect(rows[0].receivables).toBe(60_000_000);
    expect(summaryValue(branches, "branches")).toBe(1);
  });

  test("۶. گزارش فروش، مشتری و کالای واقعی را برمی‌گرداند", async () => {
    const s = await setup();
    await seedBooks(s);
    const sales = await report(s, "sales-by-customer");
    expect(summaryValue(sales, "sales")).toBe(100_000_000);
    expect(sales.sections[0].rows.some((row) => row.name === "شرکت خریدار نمونه")).toBe(true);
    const products = await report(s, "sales-by-product");
    const row = products.sections[0].rows.find((item) => item.name === "کالای گزارش");
    expect(row?.sales).toBe(100_000_000);
    expect(row?.quantity).toBe(50);
  });

  test("۷. گزارش انبار موجودی ۱۳۰ واحد و ارزش مثبت را نشان می‌دهد", async () => {
    const s = await setup();
    await seedBooks(s);
    const inventory = await report(s, "inventory-by-warehouse");
    const row = inventory.sections[0].rows.find((item) => item.name === "انبار گزارش");
    expect(row?.quantity).toBe(130);
    expect(Number(row?.value)).toBeGreaterThan(0);
    expect(summaryValue(inventory, "value")).toBeGreaterThan(0);
    const value = await report(s, "inventory-value");
    expect(summaryValue(value, "value")).toBeGreaterThan(0);
  });

  test("۸. کاتالوگ گزارش‌ها ۱۴ دسته و متادیتای فارسی کامل دارد", () => {
    expect(REPORT_CATEGORIES).toHaveLength(14);
    expect(REPORT_CATALOG.length).toBeGreaterThanOrEqual(50);
    for (const category of REPORT_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(1);
      expect(REPORT_CATALOG.some((row) => row.category === category.key)).toBe(true);
    }
    expect(REPORT_CATALOG.every((row) => row.title.length > 1 && row.description.length > 5)).toBe(true);
    const printable = REPORT_CATALOG.filter((row) => row.mode === "run");
    expect(printable.length).toBeGreaterThan(40);
  });

  test("۹. XLSX واقعی ساخته می‌شود، باز می‌شود و جمع/راست‌چین دارد", async () => {
    const workbook = await buildReportWorkbook({
      title: "تراز آزمایشی گزارش",
      category: "حسابداری",
      businessName: "شرکت آزمون فارسی",
      fiscalYear: "۱۴۰۵",
      from: Date.now() - 86_400_000,
      to: Date.now(),
      generatedAt: Date.now(),
      currency: "IRT",
      summary: [
        { key: "debit", label: "جمع بدهکار", value: 12_345_678, kind: "money" },
      ],
      sections: [
        {
          key: "trial",
          title: "حساب‌های دفتر کل",
          columns: [
            { key: "code", label: "کد حساب", kind: "text" },
            { key: "name", label: "نام حساب", kind: "text" },
            { key: "debit", label: "بدهکار", kind: "money" },
            { key: "date", label: "تاریخ", kind: "date" },
          ],
          rows: [
            { code: "1010", name: "موجودی نقد", debit: 10_000_000, date: Date.now() },
            { code: "1020", name: "بانک", debit: 2_345_678, date: Date.now() },
          ],
          totals: { debit: 12_345_678 },
        },
      ],
    });

    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(5_000);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    expect(loaded.worksheets.map((sheet) => sheet.name)).toContain("خلاصه گزارش");
    const detail = loaded.getWorksheet("حساب‌های دفتر کل");
    expect(detail).toBeDefined();
    expect(detail?.views?.[0]?.rightToLeft).toBe(true);
    expect(detail?.getCell("A1").value).toContain("شرکت آزمون فارسی");
    expect(detail?.getCell("A4").value).toBe("کد حساب");
    expect(detail?.getCell("C5").value).toBe(10_000_000);
    expect(detail?.getCell("A7").value).toBe("جمع کل");
    expect(detail?.getCell("C7").value).toBe(12_345_678);
    expect(detail?.autoFilter).toBeTruthy();
  });

  test("۱۰. خروجی چاپ در تاریخچه خروجی‌ها ثبت می‌شود", async () => {
    const s = await setup();
    await s.owner.mutation(api.reportCenter.logExport, {
      businessId: s.businessId,
      reportKey: "balance-sheet",
      title: "ترازنامه",
      format: "print",
      rowCount: 3,
      filters: JSON.stringify({ orientation: "landscape", marginMm: 8 }),
      status: "success",
    });
    const workspace = await s.owner.query(api.reportCenter.workspace, {
      businessId: s.businessId,
    });
    expect(workspace.exports[0]?.format).toBe("print");
    expect(workspace.exports[0]?.status).toBe("success");
    expect(workspace.exports[0]?.rowCount).toBe(3);
  });

  test("۱۱. گزارش سفارشی ذخیره، اجرا، پین و آرشیو می‌شود", async () => {
    const s = await setup();
    await seedBooks(s);
    const config = JSON.stringify({
      module: "invoices",
      fields: ["number", "customer", "total", "status"],
      sortKey: "total",
      sortDirection: "desc",
      search: "",
    });
    const saved = await s.owner.mutation(api.reportCenter.saveReport, {
      businessId: s.businessId,
      title: "فاکتورهای فروش مدیریتی",
      reportKey: "custom",
      module: "invoices",
      config,
      pinned: false,
    });
    const list = await s.owner.query(api.reportCenter.saved, {
      businessId: s.businessId,
    });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("فاکتورهای فروش مدیریتی");
    expect(list[0].pinned).toBe(false);
    await s.owner.mutation(api.reportCenter.togglePin, {
      businessId: s.businessId,
      savedReportId: saved.savedReportId,
    });
    const pinned = await s.owner.query(api.reportCenter.saved, {
      businessId: s.businessId,
    });
    expect(pinned[0].pinned).toBe(true);

    const custom = await s.owner.query(api.reportCenter.runCustom, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      config,
    });
    expect(custom.rowCount).toBe(1);
    expect(custom.rows[0].customer).toBe("شرکت خریدار نمونه");
    expect(custom.rows[0].total).toBe(100_000_000);
    expect(custom.totals.total).toBe(100_000_000);

    await s.owner.mutation(api.reportCenter.archiveReport, {
      businessId: s.businessId,
      savedReportId: saved.savedReportId,
    });
    const archived = await s.owner.query(api.reportCenter.saved, {
      businessId: s.businessId,
    });
    expect(archived).toHaveLength(0);
  });

  test("۱۲. مجوز گزارش حساس برای نقش ناظر سمت سرور مسدود است", async () => {
    const s = await setup();
    await seedBooks(s);
    const denied = await rejection(
      s.viewer.query(api.analytics.run, {
        businessId: s.businessId,
        reportKey: "customer-debt",
        fiscalYearId: s.fiscalYearId,
      }),
    );
    expect(denied).toContain("مجاز نیست");
    const deniedCustom = await rejection(
      s.viewer.query(api.reportCenter.runCustom, {
        businessId: s.businessId,
        fiscalYearId: s.fiscalYearId,
        config: JSON.stringify({
          module: "invoices",
          fields: ["number", "outstanding"],
        }),
      }),
    );
    expect(deniedCustom).toContain("حساس");
    const allowed = await s.viewer.query(api.reportCenter.runCustom, {
      businessId: s.businessId,
      fiscalYearId: s.fiscalYearId,
      config: JSON.stringify({
        module: "invoices",
        fields: ["number", "customer", "total"],
      }),
    });
    expect(allowed.rowCount).toBe(1);
  });

  test("۱۳. ویرا AI محلی فقط با شواهد پاسخ می‌دهد و سرویس را متصل نشان نمی‌دهد", async () => {
    const s = await setup();
    await seedBooks(s);
    const status = await s.owner.action(api.ai.providerStatus, {});
    expect(status.connected).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.model).toBeNull();

    const answer = await s.owner.action(api.ai.ask, {
      businessId: s.businessId,
      content: "سود خالص این ماه چقدر بوده است؟",
    });
    expect(answer.connected).toBe(false);
    expect(answer.provider).toBe("local");
    expect(answer.content).toContain("سود خالص");
    expect(answer.content).toContain("تومان");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.every((citation) => citation.label.length > 0)).toBe(true);

    const messages = await s.owner.query(api.ai.messages, {
      businessId: s.businessId,
      conversationId: answer.conversationId,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].citations.length).toBeGreaterThan(0);
  });

  test("۱۴. دسترسی بین کسب‌وکارها در گزارش، گزارش سفارشی و AI بسته است", async () => {
    const s = await setup();
    await seedBooks(s);
    const reportDenied = await rejection(
      s.owner.query(api.analytics.run, {
        businessId: s.otherBusinessId,
        reportKey: "balance-sheet",
      }),
    );
    expect(reportDenied).toContain("دسترسی");
    const customDenied = await rejection(
      s.owner.query(api.reportCenter.runCustom, {
        businessId: s.otherBusinessId,
        config: JSON.stringify({ module: "invoices", fields: ["number"] }),
      }),
    );
    expect(customDenied).toContain("دسترسی");
    const aiDenied = await rejection(
      s.owner.action(api.ai.ask, {
        businessId: s.otherBusinessId,
        content: "فروش این ماه چقدر است؟",
      }),
    );
    expect(aiDenied.length).toBeGreaterThan(0);
  });

  test("۱۵. خطای سرویس AI به موتور محلی برمی‌گردد و پاسخ قطع نمی‌شود", async () => {
    const s = await setup();
    await seedBooks(s);
    process.env.ZAI_API_KEY = "test-key-never-used";
    process.env.ZAI_API_BASE = "http://127.0.0.1:1";
    process.env.ZAI_MODEL = "test-model";
    try {
      const status = await s.owner.action(api.ai.providerStatus, {});
      expect(status.connected).toBe(true);
      const answer = await s.owner.action(api.ai.ask, {
        businessId: s.businessId,
        content: "وضعیت نقدینگی کسب‌وکار چگونه است؟",
      });
      expect(answer.provider).toBe("local-fallback");
      expect(answer.error).toBeTruthy();
      expect(answer.content).toContain("موتور تحلیل محلی");
      expect(answer.citations.length).toBeGreaterThan(0);
      const messages = await s.owner.query(api.ai.messages, {
        businessId: s.businessId,
        conversationId: answer.conversationId,
      });
      expect(messages).toHaveLength(2);
      expect(messages[1].error).toBeTruthy();
    } finally {
      delete process.env.ZAI_API_KEY;
      delete process.env.ZAI_API_BASE;
      delete process.env.ZAI_MODEL;
    }
  });

  test("۱۶. تاریخچه اجرا و نمودار تحلیل برای گزارش‌های اخیر ثبت می‌شود", async () => {
    const s = await setup();
    await seedBooks(s);
    const profit = await report(s, "profit-analysis");
    await s.owner.mutation(api.reportCenter.recordView, {
      businessId: s.businessId,
      reportKey: profit.key,
      title: profit.title,
      category: profit.category,
      from: profit.meta.from,
      to: profit.meta.to,
      fiscalYearId: s.fiscalYearId,
      rowCount: profit.meta.rowCount,
    });
    const workspace = await s.owner.query(api.reportCenter.workspace, {
      businessId: s.businessId,
    });
    expect(workspace.recent[0]?.reportKey).toBe("profit-analysis");
    expect(workspace.recent[0]?.rowCount).toBe(profit.meta.rowCount);
    expect(profit.chart?.data.every((point) => typeof point.label === "string")).toBe(true);
  });
});
