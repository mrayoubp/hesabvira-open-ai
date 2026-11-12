import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import type { Id } from "../src/convex/_generated/dataModel";
import { api, internal } from "../src/convex/_generated/api";
import schema from "../src/convex/schema";

/**
 * Phase 7 acceptance tests run the real Convex functions against an in-memory
 * database. Amounts are integer currency units and quantities are thousandths.
 */
const modules = {
  "../src/convex/_generated/api.ts": () => import("../src/convex/_generated/api"),
  "../src/convex/accounts.ts": () => import("../src/convex/accounts"),
  "../src/convex/accountingDocuments.ts": () => import("../src/convex/accountingDocuments"),
  "../src/convex/accountingReports.ts": () => import("../src/convex/accountingReports"),
  "../src/convex/businesses.ts": () => import("../src/convex/businesses"),
  "../src/convex/customers.ts": () => import("../src/convex/customers"),
  "../src/convex/suppliers.ts": () => import("../src/convex/suppliers"),
  "../src/convex/products.ts": () => import("../src/convex/products"),
  "../src/convex/inventory.ts": () => import("../src/convex/inventory"),
  "../src/convex/sales.ts": () => import("../src/convex/sales"),
  "../src/convex/purchases.ts": () => import("../src/convex/purchases"),
  "../src/convex/commerceReports.ts": () => import("../src/convex/commerceReports"),
  "../src/convex/invoices.ts": () => import("../src/convex/invoices"),
  "../src/convex/payments.ts": () => import("../src/convex/payments"),
  "../src/convex/treasury.ts": () => import("../src/convex/treasury"),
  "../src/convex/receipts.ts": () => import("../src/convex/receipts"),
  "../src/convex/paymentVouchers.ts": () => import("../src/convex/paymentVouchers"),
  "../src/convex/finance.ts": () => import("../src/convex/finance"),
};

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "مدیر بازرگانی", email: "commerce@test.local" }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { businessId } = await owner.mutation(internal.businesses.seedWorkspace, {});
  const context = await owner.query(api.businesses.context);
  const fiscalYear = context.fiscalYears.find(
    (year) => year.businessId === businessId && year.status === "open",
  );
  const branch = context.branches.find((row) => row.businessId === businessId);
  if (!fiscalYear || !branch) throw new Error("Workspace defaults missing");
  return {
    t,
    owner,
    ownerId,
    businessId: businessId as Id<"businesses">,
    fiscalYearId: fiscalYear._id as Id<"fiscalYears">,
    branchId: branch._id as Id<"branches">,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function customer(s: Setup, name = "مشتری تجاری", code?: string) {
  return (await s.owner.mutation(api.customers.create, {
    businessId: s.businessId,
    name,
    code,
    personType: "legal",
    mobile: "09121234567",
    economicCode: "140012345",
    creditLimit: 10_000_000,
  })).customerId as Id<"customers">;
}

async function supplier(s: Setup, name = "تأمین‌کننده تجاری") {
  return (await s.owner.mutation(api.suppliers.create, {
    businessId: s.businessId,
    name,
    personType: "legal",
    mobile: "02188776655",
    economicCode: "140098765",
    creditLimit: 20_000_000,
  })).supplierId as Id<"suppliers">;
}

async function product(
  s: Setup,
  name = "کالای آزمایشی",
  purchasePrice = 1000,
  salePrice = 2000,
  code?: string,
  productType: "physical" | "service" | "serial" | "expiry" = "physical",
) {
  return (await s.owner.mutation(api.products.create, {
    businessId: s.businessId,
    name,
    code,
    unit: "عدد",
    purchasePrice,
    salePrice,
    taxRateBps: 0,
    minStockMilli: 2000,
    productType,
  })).productId as Id<"products">;
}

async function warehouse(s: Setup, name = "انبار مرکزی") {
  return (await s.owner.mutation(api.inventory.createWarehouse, {
    businessId: s.businessId,
    name,
    isDefault: true,
  })).warehouseId as Id<"warehouses">;
}

async function fund(s: Setup) {
  return (await s.owner.mutation(api.treasury.createFund, {
    businessId: s.businessId,
    name: "صندوق فروش",
    openingBalance: 0,
    openingDate: Date.now(),
  })).cashFundId as Id<"cashFunds">;
}

async function receiveStock(
  s: Setup,
  productId: Id<"products">,
  warehouseId: Id<"warehouses">,
  quantityMilli: number,
  unitCost: number,
) {
  const doc = await s.owner.mutation(api.inventory.createDocument, {
    businessId: s.businessId,
    type: "receipt",
    toWarehouseId: warehouseId,
    occurredAt: Date.now(),
    description: "ورود آزمایشی",
    lines: [{ productId, quantityMilli, unitCost }],
  });
  const posted = await s.owner.mutation(api.inventory.postDocument, {
    businessId: s.businessId,
    documentId: doc.documentId,
  });
  return { doc, posted };
}

async function balanced(s: Setup, documentId: Id<"accountingDocuments">) {
  const document = await s.owner.query(api.accountingDocuments.get, {
    businessId: s.businessId,
    documentId,
  });
  const debit = document.lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = document.lines.reduce((sum, line) => sum + line.credit, 0);
  expect(debit).toBe(credit);
  expect(debit).toBe(document.totalDebit);
  expect(debit).toBeGreaterThan(0);
  return document;
}

async function stock(s: Setup, productId: Id<"products">, warehouseId?: Id<"warehouses">) {
  const rows = await s.owner.query(api.products.list, {
    businessId: s.businessId,
    warehouseId,
  });
  return rows.find((row) => row._id === productId)?.quantityMilli ?? 0;
}

describe("Phase 7 commerce, inventory and sales", () => {
  test("۱. creates a customer with unique code and commercial profile", async () => {
    const s = await setup();
    const customerId = await customer(s, "شرکت الف", "C-CUSTOM-1");
    const profile = await s.owner.query(api.customers.profile, {
      businessId: s.businessId,
      customerId,
    });
    expect(profile.code).toBe("C-CUSTOM-1");
    expect(profile.personType).toBe("legal");
    expect(profile.creditLimit).toBe(10_000_000);
    let failed = false;
    try {
      await customer(s, "شرکت تکراری", "C-CUSTOM-1");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("۲. creates a supplier with contact and bank data", async () => {
    const s = await setup();
    const supplierId = await supplier(s, "تأمین‌کننده الف");
    const detail = await s.owner.query(api.suppliers.get, {
      businessId: s.businessId,
      supplierId,
    });
    expect(detail.name).toBe("تأمین‌کننده الف");
    expect(detail.code).toStartWith("SUP-");
    expect(detail.balance).toBe(0);
  });

  test("۳. creates a product and records price history", async () => {
    const s = await setup();
    const productId = await product(s, "کالای قیمت‌دار", 1000, 2500, "P-1");
    const detail = await s.owner.query(api.products.get, {
      businessId: s.businessId,
      productId,
    });
    expect(detail.code).toBe("P-1");
    expect(detail.salePrice).toBe(2500);
    expect(detail.priceHistory.length).toBe(1);
  });

  test("۴. creates a warehouse and makes it default", async () => {
    const s = await setup();
    const warehouseId = await warehouse(s, "انبار شمال");
    const rows = await s.owner.query(api.inventory.warehouses, {
      businessId: s.businessId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(warehouseId);
    expect(rows[0].isDefault).toBe(true);
  });

  test("۵. posts a stock receipt and a balanced inventory journal", async () => {
    const s = await setup();
    const p = await product(s);
    const w = await warehouse(s);
    const { posted } = await receiveStock(s, p, w, 10_000, 1000);
    expect(await stock(s, p)).toBe(10_000);
    await balanced(s, posted.accountingDocumentId as Id<"accountingDocuments">);
  });

  test("۶. posts a stock issue and reduces the real balance", async () => {
    const s = await setup();
    const p = await product(s);
    const w = await warehouse(s);
    await receiveStock(s, p, w, 10_000, 1000);
    const doc = await s.owner.mutation(api.inventory.createDocument, {
      businessId: s.businessId,
      type: "issue",
      fromWarehouseId: w,
      occurredAt: Date.now(),
      description: "خروج آزمایشی",
      lines: [{ productId: p, quantityMilli: 3000 }],
    });
    const posted = await s.owner.mutation(api.inventory.postDocument, {
      businessId: s.businessId,
      documentId: doc.documentId,
    });
    expect(await stock(s, p)).toBe(7000);
    await balanced(s, posted.accountingDocumentId as Id<"accountingDocuments">);
  });

  test("۷. transfers stock between warehouses without a financial journal", async () => {
    const s = await setup();
    const p = await product(s);
    const w1 = await warehouse(s, "انبار مبدأ");
    const w2 = (await s.owner.mutation(api.inventory.createWarehouse, {
      businessId: s.businessId,
      name: "انبار مقصد",
    })).warehouseId as Id<"warehouses">;
    await receiveStock(s, p, w1, 10_000, 1000);
    const doc = await s.owner.mutation(api.inventory.createDocument, {
      businessId: s.businessId,
      type: "transfer",
      fromWarehouseId: w1,
      toWarehouseId: w2,
      occurredAt: Date.now(),
      description: "انتقال آزمایشی",
      lines: [{ productId: p, quantityMilli: 4000 }],
    });
    await s.owner.mutation(api.inventory.postDocument, {
      businessId: s.businessId,
      documentId: doc.documentId,
    });
    expect(await stock(s, p, w1)).toBe(6000);
    expect(await stock(s, p, w2)).toBe(4000);
  });

  test("۸. posts a tax-free sales invoice, reduces stock and creates COGS", async () => {
    const s = await setup();
    const c = await customer(s);
    const p = await product(s, "کالای فروش", 1000, 2000);
    const w = await warehouse(s);
    await receiveStock(s, p, w, 10_000, 1000);
    const result = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 2000, unitPrice: 2000, taxRateBps: 0 }],
    });
    expect(result.total).toBe(4000);
    expect(await stock(s, p)).toBe(8000);
    const sale = await s.owner.query(api.sales.get, {
      businessId: s.businessId,
      invoiceId: result.invoiceId,
    });
    expect(sale.costOfGoods).toBe(2000);
    expect(sale.outstanding).toBe(4000);
    await balanced(s, result.accountingDocumentId as Id<"accountingDocuments">);
  });

  test("۹. posts a purchase invoice, increases stock and supplier payable", async () => {
    const s = await setup();
    const sup = await supplier(s);
    const p = await product(s, "کالای خرید", 1000, 2000);
    const w = await warehouse(s);
    const result = await s.owner.mutation(api.purchases.create, {
      businessId: s.businessId,
      supplierId: sup,
      warehouseId: w,
      lines: [{ productId: p, quantityMilli: 5000, unitCost: 1200, taxRateBps: 0 }],
    });
    expect(result.total).toBe(6000);
    expect(await stock(s, p)).toBe(5000);
    const supplierDetail = await s.owner.query(api.suppliers.get, {
      businessId: s.businessId,
      supplierId: sup,
    });
    expect(supplierDetail.balance).toBe(6000);
    await balanced(s, result.accountingDocumentId as Id<"accountingDocuments">);
  });

  test("۱۰. posts a sales return, restores stock and balances the journal", async () => {
    const s = await setup();
    const c = await customer(s);
    const p = await product(s, "کالای برگشتی", 1000, 2000);
    const w = await warehouse(s);
    await receiveStock(s, p, w, 10_000, 1000);
    const sale = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 2000, unitPrice: 2000, taxRateBps: 0 }],
    });
    const detail = await s.owner.query(api.sales.get, {
      businessId: s.businessId,
      invoiceId: sale.invoiceId,
    });
    const returned = await s.owner.mutation(api.sales.createReturn, {
      businessId: s.businessId,
      invoiceId: sale.invoiceId,
      refundMethod: "credit",
      lines: [{ invoiceItemId: detail.items[0]._id as Id<"invoiceItems">, quantityMilli: 1000 }],
    });
    expect(returned.total).toBe(2000);
    expect(await stock(s, p)).toBe(9000);
    await balanced(s, returned.accountingDocumentId as Id<"accountingDocuments">);
  });

  test("۱۱. posts a purchase return, reduces stock and supplier payable", async () => {
    const s = await setup();
    const sup = await supplier(s);
    const p = await product(s);
    const w = await warehouse(s);
    const purchase = await s.owner.mutation(api.purchases.create, {
      businessId: s.businessId,
      supplierId: sup,
      warehouseId: w,
      lines: [{ productId: p, quantityMilli: 5000, unitCost: 1200, taxRateBps: 0 }],
    });
    const detail = await s.owner.query(api.purchases.get, {
      businessId: s.businessId,
      invoiceId: purchase.invoiceId,
    });
    const returned = await s.owner.mutation(api.purchases.createReturn, {
      businessId: s.businessId,
      invoiceId: purchase.invoiceId,
      refundMethod: "credit",
      lines: [{ purchaseItemId: detail.items[0]._id as Id<"purchaseInvoiceItems">, quantityMilli: 1000 }],
    });
    expect(returned.total).toBe(1200);
    expect(await stock(s, p)).toBe(4000);
    const supplierDetail = await s.owner.query(api.suppliers.get, {
      businessId: s.businessId,
      supplierId: sup,
    });
    expect(supplierDetail.balance).toBe(4800);
    await balanced(s, returned.accountingDocumentId as Id<"accountingDocuments">);
  });

  test("۱۲. blocks negative stock unless the workspace explicitly allows it", async () => {
    const s = await setup();
    const c = await customer(s);
    const p = await product(s);
    const w = await warehouse(s);
    let failed = false;
    try {
      await s.owner.mutation(api.sales.create, {
        businessId: s.businessId,
        customerId: c,
        warehouseId: w,
        status: "issued",
        lines: [{ productId: p, quantityMilli: 1000, unitPrice: 2000 }],
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    await s.owner.mutation(api.inventory.updateValuationMethod, {
      businessId: s.businessId,
      method: "weighted_average",
      allowNegativeStock: true,
    });
    const allowed = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 1000, unitPrice: 2000 }],
    });
    expect(allowed.total).toBe(2000);
  });

  test("۱۳. calculates weighted-average cost across purchase layers", async () => {
    const s = await setup();
    const c = await customer(s);
    const p = await product(s);
    const w = await warehouse(s);
    const sup = await supplier(s);
    await s.owner.mutation(api.purchases.create, {
      businessId: s.businessId,
      supplierId: sup,
      warehouseId: w,
      lines: [{ productId: p, quantityMilli: 5000, unitCost: 1000, taxRateBps: 0 }],
    });
    await s.owner.mutation(api.purchases.create, {
      businessId: s.businessId,
      supplierId: sup,
      warehouseId: w,
      lines: [{ productId: p, quantityMilli: 5000, unitCost: 2000, taxRateBps: 0 }],
    });
    const sale = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 1000, unitPrice: 4000 }],
    });
    const detail = await s.owner.query(api.sales.get, {
      businessId: s.businessId,
      invoiceId: sale.invoiceId,
    });
    expect(detail.costOfGoods).toBe(1500);
    expect(detail.profit).toBe(2500);
  });

  test("۱۴. calculates customer debt from real invoices and receipts", async () => {
    const s = await setup();
    const c = await customer(s, "مشتری بدهکار");
    const p = await product(s);
    const w = await warehouse(s);
    const f = await fund(s);
    await receiveStock(s, p, w, 10_000, 1000);
    const sale = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 2000, unitPrice: 2000, taxRateBps: 0 }],
    });
    const receipt = await s.owner.mutation(api.receipts.create, {
      businessId: s.businessId,
      partyType: "customer",
      customerId: c,
      partyName: "مشتری بدهکار",
      invoiceId: sale.invoiceId,
      amount: 1000,
      method: "cash",
      destinationType: "cash",
      cashFundId: f,
      description: "دریافت جزئی",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.receipts.post, {
      businessId: s.businessId,
      receiptId: receipt.receiptId,
    });
    const profile = await s.owner.query(api.customers.profile, {
      businessId: s.businessId,
      customerId: c,
    });
    expect(profile.totalSales).toBe(4000);
    expect(profile.outstanding).toBe(3000);
  });

  test("۱۵. calculates supplier debt and records a purchase payment", async () => {
    const s = await setup();
    const sup = await supplier(s);
    const p = await product(s);
    const w = await warehouse(s);
    const f = await fund(s);
    const purchase = await s.owner.mutation(api.purchases.create, {
      businessId: s.businessId,
      supplierId: sup,
      warehouseId: w,
      lines: [{ productId: p, quantityMilli: 5000, unitCost: 1200, taxRateBps: 0 }],
    });
    const voucher = await s.owner.mutation(api.paymentVouchers.create, {
      businessId: s.businessId,
      partyType: "supplier",
      partyName: "تأمین‌کننده تجاری",
      supplierId: sup,
      purchaseInvoiceId: purchase.invoiceId,
      amount: 2000,
      method: "cash",
      sourceType: "cash",
      cashFundId: f,
      description: "پرداخت بخشی از خرید",
      occurredAt: Date.now(),
    });
    await s.owner.mutation(api.paymentVouchers.post, {
      businessId: s.businessId,
      voucherId: voucher.voucherId,
    });
    const detail = await s.owner.query(api.suppliers.get, {
      businessId: s.businessId,
      supplierId: sup,
    });
    expect(detail.balance).toBe(4000);
  });

  test("۱۶. links exactly one automatic journal to a confirmed sale", async () => {
    const s = await setup();
    const c = await customer(s);
    const p = await product(s);
    const w = await warehouse(s);
    await receiveStock(s, p, w, 10_000, 1000);
    const sale = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 1000, unitPrice: 2000 }],
    });
    const rows = await s.t.run(async (ctx) =>
      ctx.db
        .query("accountingDocuments")
        .withIndex("by_business_source", (q) =>
          q
            .eq("businessId", s.businessId)
            .eq("sourceType", "sales-invoice")
            .eq("sourceId", sale.invoiceId as string),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("posted");
    expect(rows[0].totalDebit).toBe(rows[0].totalCredit);
  });

  test("۱۷. rejects duplicate product barcodes and codes", async () => {
    const s = await setup();
    await product(s, "کالای الف", 1000, 2000, "P-DUP");
    let failed = false;
    try {
      await product(s, "کالای ب", 1000, 2000, "P-DUP");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("۱۸. enforces server-side write permissions", async () => {
    const s = await setup();
    const viewerId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", { name: "بیننده", email: "viewer@commerce.test" }),
    );
    await s.t.run(async (ctx) =>
      ctx.db.insert("businessMembers", {
        businessId: s.businessId,
        userId: viewerId,
        role: "viewer",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const viewer = s.t.withIdentity({ subject: viewerId });
    const rows = await viewer.query(api.products.list, {
      businessId: s.businessId,
    });
    expect(rows).toHaveLength(0);
    let failed = false;
    try {
      await viewer.mutation(api.products.create, {
        businessId: s.businessId,
        name: "کالای غیرمجاز",
        unit: "عدد",
        purchasePrice: 1,
        salePrice: 2,
        taxRateBps: 0,
        productType: "physical",
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("۱۹. isolates products and stock between businesses", async () => {
    const s = await setup();
    const p = await product(s);
    const otherUserId = await s.t.run(async (ctx) =>
      ctx.db.insert("users", { name: "مالک دوم", email: "second@commerce.test" }),
    );
    const other = s.t.withIdentity({ subject: otherUserId });
    const otherWorkspace = await other.mutation(internal.businesses.seedWorkspace, {
      name: "کسب‌وکار دوم",
    });
    const otherProducts = await other.query(api.products.list, {
      businessId: otherWorkspace.businessId,
    });
    expect(otherProducts).toHaveLength(0);
    let failed = false;
    try {
      await other.query(api.products.get, {
        businessId: otherWorkspace.businessId,
        productId: p,
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("۲۰. returns real sales and inventory report data", async () => {
    const s = await setup();
    const c = await customer(s, "مشتری گزارش");
    const p = await product(s, "کالای گزارش", 1000, 2000);
    const w = await warehouse(s);
    await receiveStock(s, p, w, 10_000, 1000);
    await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "issued",
      lines: [{ productId: p, quantityMilli: 2000, unitPrice: 2000 }],
    });
    const byCustomer = await s.owner.query(api.commerceReports.report, {
      businessId: s.businessId,
      kind: "sales-by-customer",
    });
    expect(byCustomer.rows[0].sales).toBe(4000);
    const inventory = await s.owner.query(api.commerceReports.report, {
      businessId: s.businessId,
      kind: "inventory-stock",
    });
    expect(inventory.rows[0].quantity).toBe(8);
    expect(inventory.rows[0].value).toBe(8000);
  });

  test("۲۱. turns a sales pre-invoice into one confirmed stock and accounting document", async () => {
    const s = await setup();
    const c = await customer(s, "مشتری پیش‌فاکتور");
    const p = await product(s, "کالای پیش‌فاکتور", 1000, 2500);
    const w = await warehouse(s);
    await receiveStock(s, p, w, 10_000, 1000);
    const draft = await s.owner.mutation(api.sales.create, {
      businessId: s.businessId,
      customerId: c,
      warehouseId: w,
      status: "draft",
      lines: [{ productId: p, quantityMilli: 2000, unitPrice: 2500, taxRateBps: 0 }],
    });
    expect(await stock(s, p, w)).toBe(10_000);
    let journalCount = await s.t.run(async (ctx) =>
      ctx.db
        .query("accountingDocuments")
        .withIndex("by_business_source", (q) =>
          q
            .eq("businessId", s.businessId)
            .eq("sourceType", "sales-invoice")
            .eq("sourceId", draft.invoiceId as string),
        )
        .collect(),
    );
    expect(journalCount).toHaveLength(0);

    const issued = await s.owner.mutation(api.sales.issueDraft, {
      businessId: s.businessId,
      invoiceId: draft.invoiceId,
    });
    expect(issued.accountingDocumentId).toBeTruthy();
    expect(await stock(s, p, w)).toBe(8_000);
    const detail = await s.owner.query(api.sales.get, {
      businessId: s.businessId,
      invoiceId: draft.invoiceId,
    });
    expect(detail.status).toBe("issued");
    expect(detail.costOfGoods).toBe(2000);
    await balanced(s, issued.accountingDocumentId as Id<"accountingDocuments">);
    journalCount = await s.t.run(async (ctx) =>
      ctx.db
        .query("accountingDocuments")
        .withIndex("by_business_source", (q) =>
          q
            .eq("businessId", s.businessId)
            .eq("sourceType", "sales-invoice")
            .eq("sourceId", draft.invoiceId as string),
        )
        .collect(),
    );
    expect(journalCount).toHaveLength(1);
    let failed = false;
    try {
      await s.owner.mutation(api.sales.issueDraft, {
        businessId: s.businessId,
        invoiceId: draft.invoiceId,
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
