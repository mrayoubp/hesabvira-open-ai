import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  jalaliMonthEnd,
  jalaliMonthLabel,
  jalaliMonthStart,
  timestampToJalali,
} from "./calendar";
import {
  emptyTotals,
  normaliseSearch,
  outstandingInvoice,
  outstandingPurchase,
  percentage,
  scopedInvoices,
  sortRows,
  sumRows,
  type ReportChartPoint,
  type ReportColumn,
  type ReportEvidence,
  type ReportRow,
  type ReportSection,
  type ReportSummaryItem,
} from "./reportTypes";

const DAY = 24 * 60 * 60 * 1000;

export interface CommerceReportPayload {
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart?: {
    title: string;
    type: "bar" | "line";
    xKey: string;
    series: { key: string; label: string }[];
    data: ReportChartPoint[];
  };
  evidence: ReportEvidence[];
  note?: string;
  rowCount: number;
}

interface SalesBase {
  invoices: Doc<"invoices">[];
  items: Doc<"invoiceItems">[];
  returns: Doc<"salesReturns">[];
  returnItems: Doc<"salesReturnItems">[];
  customers: Doc<"customers">[];
  products: Doc<"products">[];
  categories: Doc<"productCategories">[];
}

function qty(value: number) {
  return Math.round(value) / 1000;
}

function customerRowsSection(
  title: string,
  rows: ReportRow[],
  columns: ReportColumn[],
): ReportSection {
  return {
    key: "rows",
    title,
    columns,
    rows,
    totals: sumRows(
      rows,
      columns
        .filter((column) => column.kind === "money" || column.kind === "number")
        .map((column) => column.key),
    ),
  };
}

function filterSearch(rows: ReportRow[], search: string | undefined) {
  const needle = normaliseSearch(search);
  if (!needle) return rows;
  return rows.filter((row) =>
    Object.values(row).some((value) =>
      String(value ?? "").toLocaleLowerCase("fa").includes(needle),
    ),
  );
}

function monthlyBuckets(from: number, to: number, max = 24) {
  const buckets: { key: string; label: string; from: number; to: number }[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < max) {
    const parts = timestampToJalali(cursor);
    const start = jalaliMonthStart(parts.jy, parts.jm);
    const end = jalaliMonthEnd(parts.jy, parts.jm);
    buckets.push({
      key: `${parts.jy}-${String(parts.jm).padStart(2, "0")}`,
      label: jalaliMonthLabel(parts.jy, parts.jm),
      from: Math.max(from, start),
      to: Math.min(to, end),
    });
    cursor = end + 1;
    guard += 1;
  }
  return buckets;
}

async function loadSalesBase(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<SalesBase> {
  const [invoicesAll, invoiceItems, salesReturns, salesReturnItems, customers, products, categories] =
    await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_business_issue", (q) => q.eq("businessId", businessId))
        .take(5000),
      ctx.db
        .query("invoiceItems")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(15_000),
      ctx.db
        .query("salesReturns")
        .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
        .take(4000),
      ctx.db
        .query("salesReturnItems")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(10_000),
      ctx.db
        .query("customers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(3000),
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(3000),
      ctx.db
        .query("productCategories")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(1000),
    ]);
  return {
    invoices: scopedInvoices(invoicesAll, from, to, branchId),
    items: invoiceItems,
    returns: salesReturns.filter(
      (row) =>
        row.status === "posted" &&
        row.occurredAt >= from &&
        row.occurredAt <= to &&
        (!branchId || row.branchId === branchId),
    ),
    returnItems: salesReturnItems,
    customers,
    products,
    categories,
  };
}

function productGrouping(base: SalesBase) {
  const invoiceIds = new Set(base.invoices.map((row) => row._id as string));
  const productMap = new Map(base.products.map((row) => [row._id as string, row]));
  const groups = new Map<
    string,
    {
      productId?: string;
      name: string;
      quantity: number;
      sales: number;
      cogs: number;
      profit: number;
      invoiceIds: Set<string>;
    }
  >();
  for (const item of base.items) {
    if (!invoiceIds.has(item.invoiceId as string)) continue;
    const key = (item.productId as string | undefined) ?? `desc:${item.description}`;
    const entry =
      groups.get(key) ??
      {
        productId: item.productId as string | undefined,
        name: productMap.get(item.productId as string)?.name ?? item.description,
        quantity: 0,
        sales: 0,
        cogs: 0,
        profit: 0,
        invoiceIds: new Set<string>(),
      };
    entry.quantity += item.quantityMilli;
    entry.sales += item.lineTotal;
    entry.cogs += item.costTotal ?? 0;
    entry.profit += item.lineTotal - (item.costTotal ?? 0);
    entry.invoiceIds.add(item.invoiceId as string);
    groups.set(key, entry);
  }
  for (const item of base.returnItems) {
    const ret = base.returns.find((row) => row._id === item.returnId);
    if (!ret) continue;
    const key = (item.productId as string | undefined) ?? "return:other";
    const entry = groups.get(key);
    if (!entry) continue;
    entry.quantity -= item.quantityMilli;
    entry.sales -= item.lineTotal;
    entry.cogs -= item.costTotal;
    entry.profit -= item.lineTotal - item.costTotal;
  }
  return { groups, productMap };
}

export async function salesByCategory(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const base = await loadSalesBase(ctx, businessId, from, to, branchId);
  const invoiceIds = new Set(base.invoices.map((row) => row._id as string));
  const productMap = new Map(base.products.map((row) => [row._id as string, row]));
  const categoryMap = new Map(base.categories.map((row) => [row._id as string, row]));
  const groups = new Map<
    string,
    {
      name: string;
      quantity: number;
      sales: number;
      cogs: number;
      profit: number;
      invoiceIds: Set<string>;
    }
  >();
  for (const item of base.items) {
    if (!invoiceIds.has(item.invoiceId as string)) continue;
    const product = item.productId ? productMap.get(item.productId as string) : undefined;
    const categoryId = (product?.categoryId as string | undefined) ?? "uncategorised";
    const entry =
      groups.get(categoryId) ??
      {
        name: categoryMap.get(categoryId)?.name ?? "بدون دسته‌بندی",
        quantity: 0,
        sales: 0,
        cogs: 0,
        profit: 0,
        invoiceIds: new Set<string>(),
      };
    entry.quantity += item.quantityMilli;
    entry.sales += item.lineTotal;
    entry.cogs += item.costTotal ?? 0;
    entry.profit += item.lineTotal - (item.costTotal ?? 0);
    entry.invoiceIds.add(item.invoiceId as string);
    groups.set(categoryId, entry);
  }
  for (const item of base.returnItems) {
    const ret = base.returns.find((row) => row._id === item.returnId);
    if (!ret) continue;
    const product = item.productId ? productMap.get(item.productId as string) : undefined;
    const categoryId = (product?.categoryId as string | undefined) ?? "uncategorised";
    const entry = groups.get(categoryId);
    if (!entry) continue;
    entry.quantity -= item.quantityMilli;
    entry.sales -= item.lineTotal;
    entry.cogs -= item.costTotal;
    entry.profit -= item.lineTotal - item.costTotal;
  }
  let rows: ReportRow[] = [...groups.values()].map((row) => ({
    name: row.name,
    invoices: row.invoiceIds.size,
    quantity: qty(row.quantity),
    sales: row.sales,
    cogs: row.cogs,
    profit: row.profit,
    margin: percentage(row.profit, row.sales),
  }));
  rows = filterSearch(sortRows(rows, "sales"), search);
  const columns: ReportColumn[] = [
    { key: "name", label: "دسته‌بندی", kind: "text" },
    { key: "invoices", label: "تعداد فاکتور", kind: "number" },
    { key: "quantity", label: "مقدار", kind: "number" },
    { key: "sales", label: "فروش", kind: "money" },
    { key: "cogs", label: "بهای تمام‌شده", kind: "money" },
    { key: "profit", label: "سود", kind: "money" },
    { key: "margin", label: "حاشیه سود", kind: "percent" },
  ];
  const totals = sumRows(rows, ["invoices", "quantity", "sales", "cogs", "profit"]);
  return {
    sections: [customerRowsSection("فروش دسته‌بندی‌ها", rows, columns)],
    summary: [
      { key: "sales", label: "فروش خالص", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "profit", label: "سود ناخالص", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "margin", label: "حاشیه سود", value: percentage(Number(totals.profit), Number(totals.sales)), kind: "percent" },
      { key: "categories", label: "دسته‌های دارای فروش", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "فروش به تفکیک دسته‌بندی",
      type: "bar",
      xKey: "label",
      series: [{ key: "sales", label: "فروش" }],
      data: sortRows(rows, "sales").slice(0, 8).map((row) => ({
        label: String(row.name),
        sales: Number(row.sales),
      })),
    },
    evidence: [
      {
        label: "ردیف‌های فاکتور فروش",
        detail: `${base.invoices.length} فاکتور قطعی و ${base.returns.length} برگشت در بازه بررسی شد.`,
        reportKey: "sales-by-category",
      },
    ],
    rowCount: rows.length,
  };
}

export async function productSales(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  mode: "top" | "slow" | "profitability" | "all",
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const base = await loadSalesBase(ctx, businessId, from, to, branchId);
  const { groups, productMap } = productGrouping(base);
  let rows: ReportRow[] = [...groups.entries()].map(([key, row]) => ({
    productId: key,
    name: row.name,
    invoices: row.invoiceIds.size,
    quantity: qty(row.quantity),
    sales: row.sales,
    cogs: row.cogs,
    profit: row.profit,
    margin: percentage(row.profit, row.sales),
  }));
  if (mode === "slow") {
    const sold = new Set(rows.map((row) => String(row.productId)));
    for (const product of base.products) {
      if (!product.active || sold.has(product._id as string)) continue;
      if (product.productType === "service") continue;
      rows.push({
        productId: product._id as string,
        name: product.name,
        invoices: 0,
        quantity: 0,
        sales: 0,
        cogs: 0,
        profit: 0,
        margin: 0,
      });
    }
    rows = sortRows(rows, "quantity", "asc").slice(0, 100);
  } else if (mode === "top") {
    rows = sortRows(rows, "sales", "desc").slice(0, 30);
  } else if (mode === "profitability") {
    rows = sortRows(rows, "profit", "desc").slice(0, 100);
  } else {
    rows = sortRows(rows, "sales", "desc");
  }
  rows = filterSearch(rows, search);
  const columns: ReportColumn[] = [
    { key: "name", label: "کالا / خدمت", kind: "text" },
    { key: "invoices", label: "تعداد فاکتور", kind: "number" },
    { key: "quantity", label: "مقدار فروش", kind: "number" },
    { key: "sales", label: "فروش خالص", kind: "money" },
    { key: "cogs", label: "بهای تمام‌شده", kind: "money" },
    { key: "profit", label: "سود ناخالص", kind: "money" },
    { key: "margin", label: "حاشیه سود", kind: "percent" },
  ];
  const totals = sumRows(rows, ["invoices", "quantity", "sales", "cogs", "profit"]);
  const title =
    mode === "top"
      ? "کالاهای پرفروش"
      : mode === "slow"
        ? "کالاهای کم‌فروش"
        : "سودآوری کالا";
  return {
    sections: [customerRowsSection(title, rows, columns)],
    summary: [
      { key: "sales", label: "فروش ردیف‌های نمایش‌داده‌شده", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "profit", label: "سود ناخالص", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "quantity", label: "مقدار فروش", value: Number(totals.quantity ?? 0), kind: "number" },
      { key: "items", label: "تعداد اقلام", value: rows.length, kind: "number" },
    ],
    chart: {
      title: mode === "slow" ? "کم‌فروش‌ترین اقلام" : "پرفروش‌ترین اقلام",
      type: "bar",
      xKey: "label",
      series: [{ key: "sales", label: "فروش" }],
      data: rows.slice(0, 8).map((row) => ({
        label: String(row.name),
        sales: Number(row.sales),
      })),
    },
    evidence: [
      {
        label: "ردیف فاکتورهای فروش",
        detail: `${base.invoices.length} فاکتور و ${base.products.length} کالا/خدمت بررسی شد.`,
        reportKey: `sales-${mode === "profitability" ? "margin" : mode === "top" ? "top-products" : mode === "slow" ? "slow-products" : "by-product"}`,
      },
    ],
    rowCount: rows.length,
  };
}

export async function invoiceAverage(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const [invoicesAll, customers] = await Promise.all([
    ctx.db
      .query("invoices")
      .withIndex("by_business_issue", (q) => q.eq("businessId", businessId))
      .take(5000),
    ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(3000),
  ]);
  const customerMap = new Map(customers.map((row) => [row._id as string, row]));
  const invoices = scopedInvoices(invoicesAll, from, to, branchId);
  let rows: ReportRow[] = invoices.map((invoice) => ({
    number: invoice.number,
    documentId: invoice.accountingDocumentId,
    customer: customerMap.get(invoice.customerId as string)?.name ?? "—",
    date: invoice.issueDate,
    total: invoice.total,
    paid: invoice.paidAmount ?? 0,
    outstanding: outstandingInvoice(invoice),
  }));
  rows = filterSearch(rows, search);
  const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
  const average = rows.length ? Math.round(total / rows.length) : 0;
  const values = rows.map((row) => Number(row.total));
  const columns: ReportColumn[] = [
    { key: "number", label: "شماره فاکتور", kind: "doc" },
    { key: "customer", label: "مشتری", kind: "text" },
    { key: "date", label: "تاریخ", kind: "date" },
    { key: "total", label: "مبلغ فاکتور", kind: "money" },
    { key: "paid", label: "دریافت‌شده", kind: "money" },
    { key: "outstanding", label: "مانده", kind: "money" },
  ];
  return {
    sections: [
      {
        key: "invoices",
        title: "فاکتورهای بازه",
        columns,
        rows,
        totals: sumRows(rows, ["total", "paid", "outstanding"]),
      },
    ],
    summary: [
      { key: "count", label: "تعداد فاکتور", value: rows.length, kind: "number" },
      { key: "average", label: "میانگین مبلغ فاکتور", value: average, kind: "money" },
      { key: "total", label: "جمع فروش", value: total, kind: "money" },
      { key: "min", label: "کمترین فاکتور", value: values.length ? Math.min(...values) : 0, kind: "money" },
      { key: "max", label: "بیشترین فاکتور", value: values.length ? Math.max(...values) : 0, kind: "money" },
    ],
    chart: {
      title: "روند ماهانه میانگین فاکتور",
      type: "line",
      xKey: "label",
      series: [{ key: "average", label: "میانگین" }],
      data: monthlyBuckets(from, to).map((bucket) => {
        const scoped = rows.filter((row) => Number(row.date) >= bucket.from && Number(row.date) <= bucket.to);
        return {
          label: bucket.label,
          average: scoped.length
            ? Math.round(scoped.reduce((sum, row) => sum + Number(row.total), 0) / scoped.length)
            : 0,
        };
      }),
    },
    evidence: [
      {
        label: "فاکتورهای قطعی",
        detail: `${rows.length} فاکتور در بازه گزارش محاسبه شد.`,
        reportKey: "invoice-average",
      },
    ],
    rowCount: rows.length,
  };
}

export async function salesMargin(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const base = await loadSalesBase(ctx, businessId, from, to, branchId);
  const customerMap = new Map(base.customers.map((row) => [row._id as string, row]));
  const returnsByInvoice = new Map<string, number>();
  const returnCostByInvoice = new Map<string, number>();
  for (const ret of base.returns) {
    const key = ret.invoiceId as string;
    returnsByInvoice.set(key, (returnsByInvoice.get(key) ?? 0) + ret.total);
    returnCostByInvoice.set(key, (returnCostByInvoice.get(key) ?? 0) + ret.costOfGoods);
  }
  let rows: ReportRow[] = base.invoices.map((invoice) => {
    const returned = returnsByInvoice.get(invoice._id as string) ?? 0;
    const returnCost = returnCostByInvoice.get(invoice._id as string) ?? 0;
    const sales = invoice.total - returned;
    const cogs = Math.max(0, (invoice.costOfGoods ?? 0) - returnCost);
    return {
      number: invoice.number,
      customer: customerMap.get(invoice.customerId as string)?.name ?? "—",
      date: invoice.issueDate,
      sales,
      cogs,
      profit: sales - cogs,
      margin: percentage(sales - cogs, sales),
    };
  });
  rows = sortRows(filterSearch(rows, search), "date", "desc");
  const totals = sumRows(rows, ["sales", "cogs", "profit"]);
  const columns: ReportColumn[] = [
    { key: "number", label: "فاکتور", kind: "doc" },
    { key: "customer", label: "مشتری", kind: "text" },
    { key: "date", label: "تاریخ", kind: "date" },
    { key: "sales", label: "فروش خالص", kind: "money" },
    { key: "cogs", label: "بهای تمام‌شده", kind: "money" },
    { key: "profit", label: "سود ناخالص", kind: "money" },
    { key: "margin", label: "حاشیه سود", kind: "percent" },
  ];
  return {
    sections: [
      {
        key: "invoices",
        title: "حاشیه سود فاکتورها",
        columns,
        rows,
        totals: { ...totals, margin: percentage(Number(totals.profit), Number(totals.sales)) },
      },
    ],
    summary: [
      { key: "sales", label: "فروش خالص", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "cogs", label: "بهای تمام‌شده", value: Number(totals.cogs ?? 0), kind: "money" },
      { key: "profit", label: "سود ناخالص", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "margin", label: "حاشیه سود", value: percentage(Number(totals.profit), Number(totals.sales)), kind: "percent" },
    ],
    chart: {
      title: "روند ماهانه سود و حاشیه",
      type: "line",
      xKey: "label",
      series: [
        { key: "profit", label: "سود" },
        { key: "margin", label: "حاشیه ٪" },
      ],
      data: monthlyBuckets(from, to).map((bucket) => {
        const scoped = rows.filter((row) => Number(row.date) >= bucket.from && Number(row.date) <= bucket.to);
        const sales = scoped.reduce((sum, row) => sum + Number(row.sales), 0);
        const profit = scoped.reduce((sum, row) => sum + Number(row.profit), 0);
        return { label: bucket.label, profit, margin: percentage(profit, sales) };
      }),
    },
    evidence: [
      {
        label: "فاکتور و برگشت فروش",
        detail: `${base.invoices.length} فاکتور و ${base.returns.length} برگشت با بهای تمام‌شده ثبت‌شده.`,
        reportKey: "sales-margin",
      },
    ],
    rowCount: rows.length,
  };
}

export async function customerReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  mode: "top" | "debt" | "aging" | "ledger" | "trend",
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const [invoicesAll, invoiceItems, returns, receipts, customers] = await Promise.all([
    ctx.db
      .query("invoices")
      .withIndex("by_business_issue", (q) => q.eq("businessId", businessId))
      .take(5000),
    ctx.db
      .query("invoiceItems")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(15_000),
    ctx.db
      .query("salesReturns")
      .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
      .take(4000),
    ctx.db
      .query("receipts")
      .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
      .take(6000),
    ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(3000),
  ]);
  const customerMap = new Map(customers.map((row) => [row._id as string, row]));
  const scopedReceipts = receipts.filter(
    (row) =>
      row.status === "posted" &&
      row.occurredAt >= from &&
      row.occurredAt <= to &&
      (!branchId || row.branchId === branchId),
  );
  const scopedReturns = returns.filter(
    (row) =>
      row.status === "posted" &&
      row.occurredAt >= from &&
      row.occurredAt <= to &&
      (!branchId || row.branchId === branchId),
  );
  const periodInvoices = scopedInvoices(invoicesAll, from, to, branchId);
  const customerName = (id: string) => customerMap.get(id)?.name ?? "—";

  if (mode === "ledger") {
    const rows: ReportRow[] = [];
    for (const invoice of periodInvoices) {
      rows.push({
        customer: customerName(invoice.customerId as string),
        date: invoice.issueDate,
        type: "فاکتور فروش",
        reference: invoice.number,
        documentId: invoice.accountingDocumentId,
        debit: invoice.total,
        credit: 0,
      });
    }
    for (const ret of scopedReturns) {
      rows.push({
        customer: customerName(ret.customerId as string),
        date: ret.occurredAt,
        type: "برگشت فروش",
        reference: ret.number,
        documentId: ret.accountingDocumentId,
        debit: 0,
        credit: ret.total,
      });
    }
    for (const receipt of scopedReceipts) {
      if (receipt.partyType !== "customer" || !receipt.customerId) continue;
      rows.push({
        customer: customerName(receipt.customerId as string),
        date: receipt.occurredAt,
        type: "دریافت وجه",
        reference: receipt.number,
        documentId: receipt.accountingDocumentId,
        debit: 0,
        credit: receipt.amount,
      });
    }
    const filtered = filterSearch(sortRows(rows, "date", "asc"), search);
    const columns: ReportColumn[] = [
      { key: "customer", label: "مشتری", kind: "text" },
      { key: "date", label: "تاریخ", kind: "date" },
      { key: "type", label: "نوع", kind: "text" },
      { key: "reference", label: "سند", kind: "doc" },
      { key: "debit", label: "بدهکار", kind: "money" },
      { key: "credit", label: "بستانکار", kind: "money" },
    ];
    const totals = sumRows(filtered, ["debit", "credit"]);
    return {
      sections: [
        {
          key: "ledger",
          title: "گردش حساب مشتریان",
          columns,
          rows: filtered,
          totals,
        },
      ],
      summary: [
        { key: "debit", label: "جمع بدهکار", value: Number(totals.debit ?? 0), kind: "money" },
        { key: "credit", label: "جمع دریافت و برگشت", value: Number(totals.credit ?? 0), kind: "money" },
        { key: "balance", label: "مانده جریان بازه", value: Number(totals.debit ?? 0) - Number(totals.credit ?? 0), kind: "money" },
        { key: "rows", label: "تعداد گردش", value: filtered.length, kind: "number" },
      ],
      evidence: [
        { label: "گردش مشتریان", detail: `${periodInvoices.length} فاکتور، ${scopedReturns.length} برگشت و ${scopedReceipts.length} دریافت.`, reportKey: "customer-ledger" },
      ],
      rowCount: filtered.length,
    };
  }

  if (mode === "aging" || mode === "debt") {
    // Debt is as of the report end date, not limited to the start date, so old
    // unpaid invoices are not hidden by a narrow date filter.
    const asOf = invoicesAll.filter(
      (row) =>
        row.status !== "draft" &&
        row.status !== "void" &&
        row.issueDate <= to &&
        (!branchId || row.branchId === branchId),
    );
    const now = to;
    const groups = new Map<
      string,
      {
        name: string;
        count: number;
        total: number;
        paid: number;
        outstanding: number;
        current: number;
        days1: number;
        days30: number;
        days60: number;
        days90: number;
        oldestDays: number;
        dueDates: number[];
      }
    >();
    for (const invoice of asOf) {
      const outstanding = outstandingInvoice(invoice);
      if (outstanding <= 0) continue;
      const id = invoice.customerId as string;
      const entry =
        groups.get(id) ??
        {
          name: customerName(id),
          count: 0,
          total: 0,
          paid: 0,
          outstanding: 0,
          current: 0,
          days1: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          oldestDays: 0,
          dueDates: [],
        };
      const due = invoice.dueDate ?? invoice.issueDate;
      const overdue = Math.max(0, Math.floor((now - due) / DAY));
      entry.count += 1;
      entry.total += invoice.total;
      entry.paid += invoice.paidAmount ?? 0;
      entry.outstanding += outstanding;
      entry.oldestDays = Math.max(entry.oldestDays, overdue);
      if (overdue === 0) entry.current += outstanding;
      else if (overdue <= 30) entry.days1 += outstanding;
      else if (overdue <= 60) entry.days30 += outstanding;
      else if (overdue <= 90) entry.days60 += outstanding;
      else entry.days90 += outstanding;
      entry.dueDates.push(due);
      groups.set(id, entry);
    }
    let rows: ReportRow[] = [...groups.values()].map((row) => ({
      ...row,
      dueDate: row.dueDates.sort((a, b) => a - b)[0] ?? 0,
      overdue: row.days1 + row.days30 + row.days60 + row.days90,
    }));
    rows = mode === "debt" ? sortRows(filterSearch(rows, search), "outstanding") : sortRows(filterSearch(rows, search), "oldestDays");
    const totals = sumRows(rows, ["count", "total", "paid", "outstanding", "current", "days1", "days30", "days60", "days90", "overdue"]);
    const columns: ReportColumn[] =
      mode === "debt"
        ? [
            { key: "name", label: "مشتری", kind: "text" },
            { key: "count", label: "تعداد فاکتور", kind: "number" },
            { key: "total", label: "مبلغ کل", kind: "money" },
            { key: "paid", label: "دریافت‌شده", kind: "money" },
            { key: "outstanding", label: "مانده بدهی", kind: "money" },
            { key: "overdue", label: "معوق", kind: "money" },
            { key: "oldestDays", label: "قدیمی‌ترین (روز)", kind: "number" },
          ]
        : [
            { key: "name", label: "مشتری", kind: "text" },
            { key: "outstanding", label: "مانده", kind: "money" },
            { key: "current", label: "سررسیدنشده", kind: "money" },
            { key: "days1", label: "۱ تا ۳۰ روز", kind: "money" },
            { key: "days30", label: "۳۱ تا ۶۰ روز", kind: "money" },
            { key: "days60", label: "۶۱ تا ۹۰ روز", kind: "money" },
            { key: "days90", label: "بیش از ۹۰ روز", kind: "money" },
          ];
    return {
      sections: [
        {
          key: "debt",
          title: mode === "debt" ? "مانده مطالبات مشتریان" : "سالخوردگی مطالبات",
          columns,
          rows,
          totals,
          note: "مانده بر اساس فاکتورهای قطعی تا تاریخ پایان گزارش و پس از کسر دریافت و برگشت محاسبه شده است.",
        },
      ],
      summary: [
        { key: "receivable", label: "کل مطالبات", value: Number(totals.outstanding ?? 0), kind: "money" },
        { key: "overdue", label: "مطالبات معوق", value: Number(totals.overdue ?? 0), kind: "money" },
        { key: "customers", label: "مشتریان بدهکار", value: rows.length, kind: "number" },
        { key: "over90", label: "بیش از ۹۰ روز", value: Number(totals.days90 ?? 0), kind: "money" },
      ],
      chart: {
        title: "ترکیب سنی مطالبات",
        type: "bar",
        xKey: "label",
        series: [{ key: "amount", label: "مانده" }],
        data: [
          { label: "سررسیدنشده", amount: Number(totals.current ?? 0) },
          { label: "۱ تا ۳۰ روز", amount: Number(totals.days1 ?? 0) },
          { label: "۳۱ تا ۶۰ روز", amount: Number(totals.days30 ?? 0) },
          { label: "۶۱ تا ۹۰ روز", amount: Number(totals.days60 ?? 0) },
          { label: "بیش از ۹۰ روز", amount: Number(totals.days90 ?? 0) },
        ],
      },
      evidence: [
        { label: "فاکتورهای قطعی تا پایان بازه", detail: `${asOf.length} فاکتور بررسی و مانده هر مشتری از سوابق واقعی محاسبه شد.`, reportKey: mode === "debt" ? "customer-debt" : "customer-aging" },
      ],
      rowCount: rows.length,
    };
  }

  if (mode === "trend") {
    const groups = new Map<string, { customer: string; month: string; sales: number; count: number; from: number }>();
    for (const invoice of periodInvoices) {
      const parts = timestampToJalali(invoice.issueDate);
      const key = `${invoice.customerId}:${parts.jy}-${parts.jm}`;
      const row = groups.get(key) ?? {
        customer: customerName(invoice.customerId as string),
        month: jalaliMonthLabel(parts.jy, parts.jm),
        sales: 0,
        count: 0,
        from: invoice.issueDate,
      };
      row.sales += invoice.total;
      row.count += 1;
      row.from = Math.min(row.from, invoice.issueDate);
      groups.set(key, row);
    }
    let rows: ReportRow[] = sortRows([...groups.values()], "from", "asc");
    rows = filterSearch(rows, search);
    const columns: ReportColumn[] = [
      { key: "customer", label: "مشتری", kind: "text" },
      { key: "month", label: "ماه", kind: "text" },
      { key: "count", label: "تعداد فاکتور", kind: "number" },
      { key: "sales", label: "فروش", kind: "money" },
    ];
    return {
      sections: [{ key: "trend", title: "روند خرید مشتریان", columns, rows, totals: sumRows(rows, ["count", "sales"]) }],
      summary: [
        { key: "sales", label: "فروش بازه", value: rows.reduce((sum, row) => sum + Number(row.sales), 0), kind: "money" },
        { key: "customers", label: "مشتریان دارای خرید", value: new Set(rows.map((row) => row.customer)).size, kind: "number" },
      ],
      evidence: [
        { label: "فاکتورهای قطعی", detail: `${periodInvoices.length} فاکتور برای روند ماهانه استفاده شد.`, reportKey: "customer-trend" },
      ],
      rowCount: rows.length,
    };
  }

  // top customers and their all-time outstanding as of report end
  const allCustomers = new Map<string, { sales: number; count: number; profit: number; outstanding: number }>();
  for (const invoice of invoicesAll) {
    if (invoice.issueDate > to) continue;
    if (invoice.status === "draft" || invoice.status === "void") continue;
    if (branchId && invoice.branchId !== branchId) continue;
    const id = invoice.customerId as string;
    const current = allCustomers.get(id) ?? { sales: 0, count: 0, profit: 0, outstanding: 0 };
    if (invoice.issueDate >= from) {
      current.sales += invoice.total;
      current.count += 1;
      current.profit += invoice.total - (invoice.costOfGoods ?? 0);
    }
    current.outstanding += outstandingInvoice(invoice);
    allCustomers.set(id, current);
  }
  let rows: ReportRow[] = [...allCustomers.entries()]
    .map(([id, value]) => ({ name: customerName(id), ...value }))
    .filter((row) => Number(row.sales) > 0 || Number(row.outstanding) > 0);
  rows = sortRows(filterSearch(rows, search), "sales").slice(0, 100);
  const columns: ReportColumn[] = [
    { key: "name", label: "مشتری", kind: "text" },
    { key: "count", label: "تعداد فاکتور", kind: "number" },
    { key: "sales", label: "فروش بازه", kind: "money" },
    { key: "profit", label: "سود ناخالص", kind: "money" },
    { key: "outstanding", label: "مانده تا پایان بازه", kind: "money" },
  ];
  const totals = sumRows(rows, ["count", "sales", "profit", "outstanding"]);
  return {
    sections: [{ key: "top", title: "مشتریان برتر", columns, rows, totals }],
    summary: [
      { key: "sales", label: "فروش مشتریان", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "profit", label: "سود ناخالص", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "customers", label: "مشتریان", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "مشتریان برتر",
      type: "bar",
      xKey: "label",
      series: [{ key: "sales", label: "فروش" }],
      data: rows.slice(0, 8).map((row) => ({ label: String(row.name), sales: Number(row.sales) })),
    },
    evidence: [
      { label: "سوابق فروش و دریافت", detail: `${periodInvoices.length} فاکتور در بازه و ${invoiceItems.length} ردیف کالا بررسی شد.`, reportKey: "customer-top" },
    ],
    rowCount: rows.length,
  };
}

export async function purchaseReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  mode: "top" | "price" | "frequent" | "compare" | "debt" | "due" | "ledger",
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const [purchasesAll, purchaseItems, suppliers, products, payments] = await Promise.all([
    ctx.db
      .query("purchaseInvoices")
      .withIndex("by_business_date", (q) => q.eq("businessId", businessId))
      .take(5000),
    ctx.db
      .query("purchaseInvoiceItems")
      .withIndex("by_business_product", (q) => q.eq("businessId", businessId))
      .take(15_000),
    ctx.db
      .query("suppliers")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(3000),
    ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(3000),
    ctx.db
      .query("paymentVouchers")
      .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
      .take(6000),
  ]);
  const supplierMap = new Map(suppliers.map((row) => [row._id as string, row]));
  const productMap = new Map(products.map((row) => [row._id as string, row]));
  const supplierName = (id?: string) => (id ? supplierMap.get(id)?.name ?? "—" : "—");
  const scoped = purchasesAll.filter(
    (row) =>
      row.issueDate >= from &&
      row.issueDate <= to &&
      row.status !== "draft" &&
      row.status !== "cancelled" &&
      (!branchId || row.branchId === branchId),
  );
  const purchaseOnly = scoped.filter((row) => row.kind === "purchase");
  const purchaseIds = new Set(scoped.map((row) => row._id as string));
  const scopedPayments = payments.filter(
    (row) =>
      row.status === "posted" &&
      row.occurredAt >= from &&
      row.occurredAt <= to &&
      (!branchId || row.branchId === branchId),
  );

  if (mode === "price" || mode === "frequent") {
    const grouped = new Map<
      string,
      {
        name: string;
        quantity: number;
        total: number;
        min: number;
        max: number;
        last: number;
        lastDate: number;
        invoices: Set<string>;
      }
    >();
    for (const item of purchaseItems) {
      if (!purchaseIds.has(item.invoiceId as string)) continue;
      const invoice = scoped.find((row) => row._id === item.invoiceId);
      if (!invoice || invoice.kind !== "purchase") continue;
      const key = item.productId as string;
      const row =
        grouped.get(key) ??
        {
          name: productMap.get(key)?.name ?? item.description,
          quantity: 0,
          total: 0,
          min: Number.POSITIVE_INFINITY,
          max: 0,
          last: 0,
          lastDate: 0,
          invoices: new Set<string>(),
        };
      row.quantity += item.quantityMilli;
      row.total += item.lineTotal;
      row.min = Math.min(row.min, item.unitCost);
      row.max = Math.max(row.max, item.unitCost);
      if (invoice.issueDate >= row.lastDate) {
        row.lastDate = invoice.issueDate;
        row.last = item.unitCost;
      }
      row.invoices.add(item.invoiceId as string);
      grouped.set(key, row);
    }
    let rows: ReportRow[] = [...grouped.values()].map((row) => ({
      name: row.name,
      invoices: row.invoices.size,
      quantity: qty(row.quantity),
      average: row.quantity ? Math.round(row.total / qty(row.quantity)) : 0,
      min: Number.isFinite(row.min) ? row.min : 0,
      max: row.max,
      last: row.last,
      lastDate: row.lastDate,
      change: row.min ? Math.round(((row.last - row.min) / row.min) * 10_000) / 100 : 0,
    }));
    rows = filterSearch(rows, search);
    rows =
      mode === "price"
        ? sortRows(rows, "lastDate")
        : sortRows(rows, "invoices").slice(0, 100);
    const columns: ReportColumn[] =
      mode === "price"
        ? [
            { key: "name", label: "کالا", kind: "text" },
            { key: "lastDate", label: "آخرین خرید", kind: "date" },
            { key: "last", label: "آخرین بهای واحد", kind: "money" },
            { key: "min", label: "کمترین", kind: "money" },
            { key: "max", label: "بیشترین", kind: "money" },
            { key: "average", label: "میانگین موزون", kind: "money" },
            { key: "change", label: "تغییر از کف", kind: "percent" },
          ]
        : [
            { key: "name", label: "کالا", kind: "text" },
            { key: "invoices", label: "تعداد فاکتور", kind: "number" },
            { key: "quantity", label: "مقدار خرید", kind: "number" },
            { key: "average", label: "میانگین بهای واحد", kind: "money" },
            { key: "last", label: "آخرین بها", kind: "money" },
          ];
    const totals = sumRows(rows, ["invoices", "quantity"]);
    return {
      sections: [{ key: "rows", title: mode === "price" ? "مقایسه قیمت خرید" : "کالاهای پرتکرار خرید", columns, rows, totals }],
      summary: [
        { key: "items", label: "اقلام", value: rows.length, kind: "number" },
        { key: "quantity", label: "مقدار خرید", value: Number(totals.quantity ?? 0), kind: "number" },
        { key: "invoices", label: "تعداد فاکتور", value: Number(totals.invoices ?? 0), kind: "number" },
      ],
      evidence: [
        { label: "فاکتورهای خرید", detail: `${scoped.length} فاکتور خرید و برگشت و ${purchaseItems.length} ردیف بررسی شد.`, reportKey: mode === "price" ? "purchase-price-comparison" : "purchase-frequent" },
      ],
      rowCount: rows.length,
    };
  }

  if (mode === "ledger") {
    const rows: ReportRow[] = [];
    for (const purchase of scoped) {
      rows.push({
        supplier: supplierName(purchase.supplierId as string),
        date: purchase.issueDate,
        type: purchase.kind === "return" ? "برگشت خرید" : "فاکتور خرید",
        reference: purchase.number,
        documentId: purchase.accountingDocumentId,
        debit: purchase.kind === "return" ? purchase.total : 0,
        credit: purchase.kind === "return" ? 0 : purchase.total,
      });
    }
    for (const payment of scopedPayments) {
      if (payment.partyType !== "supplier") continue;
      rows.push({
        supplier: payment.supplierId ? supplierName(payment.supplierId as string) : payment.partyName,
        date: payment.occurredAt,
        type: "پرداخت",
        reference: payment.number,
        documentId: payment.accountingDocumentId,
        debit: payment.amount,
        credit: 0,
      });
    }
    const filtered = filterSearch(sortRows(rows, "date", "asc"), search);
    const totals = sumRows(filtered, ["debit", "credit"]);
    const columns: ReportColumn[] = [
      { key: "supplier", label: "تأمین‌کننده", kind: "text" },
      { key: "date", label: "تاریخ", kind: "date" },
      { key: "type", label: "نوع", kind: "text" },
      { key: "reference", label: "سند", kind: "doc" },
      { key: "debit", label: "بدهکار (پرداخت/برگشت)", kind: "money" },
      { key: "credit", label: "بستانکار (خرید)", kind: "money" },
    ];
    return {
      sections: [{ key: "ledger", title: "گردش حساب تأمین‌کنندگان", columns, rows: filtered, totals }],
      summary: [
        { key: "debit", label: "جمع پرداخت و برگشت", value: Number(totals.debit ?? 0), kind: "money" },
        { key: "credit", label: "جمع خرید", value: Number(totals.credit ?? 0), kind: "money" },
        { key: "rows", label: "تعداد گردش", value: filtered.length, kind: "number" },
      ],
      evidence: [{ label: "خرید و پرداخت", detail: `${scoped.length} سند خرید و ${scopedPayments.length} پرداخت در بازه.`, reportKey: "supplier-ledger" }],
      rowCount: filtered.length,
    };
  }

  if (mode === "compare") {
    const groups = new Map<string, { name: string; purchase: number; returned: number; paid: number; outstanding: number; invoices: number }>();
    for (const purchase of scoped) {
      const id = purchase.supplierId as string;
      const row = groups.get(id) ?? { name: supplierName(id), purchase: 0, returned: 0, paid: 0, outstanding: 0, invoices: 0 };
      if (purchase.kind === "return") row.returned += purchase.total;
      else {
        row.purchase += purchase.total;
        row.invoices += 1;
        row.outstanding += outstandingPurchase(purchase);
      }
      groups.set(id, row);
    }
    for (const payment of scopedPayments) {
      if (payment.partyType !== "supplier" || !payment.supplierId) continue;
      const row = groups.get(payment.supplierId as string);
      if (row) row.paid += payment.amount;
    }
    let rows: ReportRow[] = [...groups.values()].map((row) => ({
      ...row,
      net: row.purchase - row.returned,
      share: 0,
    }));
    const totalPurchase = rows.reduce((sum, row) => sum + Number(row.net), 0);
    rows = rows.map((row) => ({ ...row, share: percentage(Number(row.net), totalPurchase) }));
    rows = sortRows(filterSearch(rows, search), "net");
    const columns: ReportColumn[] = [
      { key: "name", label: "تأمین‌کننده", kind: "text" },
      { key: "invoices", label: "تعداد فاکتور", kind: "number" },
      { key: "purchase", label: "خرید", kind: "money" },
      { key: "returned", label: "برگشت", kind: "money" },
      { key: "net", label: "خرید خالص", kind: "money" },
      { key: "paid", label: "پرداخت", kind: "money" },
      { key: "outstanding", label: "مانده", kind: "money" },
      { key: "share", label: "سهم خرید", kind: "percent" },
    ];
    const totals = sumRows(rows, ["invoices", "purchase", "returned", "net", "paid", "outstanding"]);
    return {
      sections: [{ key: "compare", title: "مقایسه تأمین‌کنندگان", columns, rows, totals }],
      summary: [
        { key: "purchase", label: "خرید خالص", value: Number(totals.net ?? 0), kind: "money" },
        { key: "suppliers", label: "تأمین‌کنندگان", value: rows.length, kind: "number" },
        { key: "outstanding", label: "مانده بدهی", value: Number(totals.outstanding ?? 0), kind: "money" },
      ],
      chart: {
        title: "سهم خرید تأمین‌کنندگان",
        type: "bar",
        xKey: "label",
        series: [{ key: "net", label: "خرید خالص" }],
        data: rows.slice(0, 8).map((row) => ({ label: String(row.name), net: Number(row.net) })),
      },
      evidence: [{ label: "فاکتورهای خرید", detail: `${scoped.length} سند در بازه؛ سهم‌ها از خرید خالص محاسبه شد.`, reportKey: "supplier-compare" }],
      rowCount: rows.length,
    };
  }

  if (mode === "due" || mode === "debt") {
    const asOf = purchasesAll.filter(
      (row) =>
        row.status !== "draft" &&
        row.status !== "cancelled" &&
        row.kind === "purchase" &&
        row.issueDate <= to &&
        (!branchId || row.branchId === branchId),
    );
    const groups = new Map<string, { name: string; outstanding: number; overdue: number; dueSoon: number; later: number; invoices: number }>();
    for (const purchase of asOf) {
      const outstanding = outstandingPurchase(purchase);
      if (outstanding <= 0) continue;
      const id = purchase.supplierId as string;
      const row = groups.get(id) ?? { name: supplierName(id), outstanding: 0, overdue: 0, dueSoon: 0, later: 0, invoices: 0 };
      const due = purchase.dueDate ?? purchase.issueDate;
      row.outstanding += outstanding;
      row.invoices += 1;
      if (due < to) row.overdue += outstanding;
      else if (due <= to + 30 * DAY) row.dueSoon += outstanding;
      else row.later += outstanding;
      groups.set(id, row);
    }
    let rows: ReportRow[] = sortRows(filterSearch([...groups.values()], search), "outstanding");
    const totals = sumRows(rows, ["outstanding", "overdue", "dueSoon", "later", "invoices"]);
    const columns: ReportColumn[] = [
      { key: "name", label: "تأمین‌کننده", kind: "text" },
      { key: "invoices", label: "تعداد فاکتور", kind: "number" },
      { key: "outstanding", label: "بدهی", kind: "money" },
      { key: "overdue", label: "سررسیدشده", kind: "money" },
      { key: "dueSoon", label: "تا ۳۰ روز", kind: "money" },
      { key: "later", label: "بیش از ۳۰ روز", kind: "money" },
    ];
    return {
      sections: [{ key: "due", title: mode === "due" ? "سررسید بدهی تأمین‌کنندگان" : "بدهی تأمین‌کنندگان", columns, rows, totals, note: "مانده بر اساس فاکتورهای قطعی خرید تا پایان بازه و پس از کسر پرداخت است." }],
      summary: [
        { key: "outstanding", label: "کل بدهی", value: Number(totals.outstanding ?? 0), kind: "money" },
        { key: "overdue", label: "سررسیدشده", value: Number(totals.overdue ?? 0), kind: "money" },
        { key: "dueSoon", label: "سررسید ۳۰ روز آینده", value: Number(totals.dueSoon ?? 0), kind: "money" },
        { key: "suppliers", label: "تأمین‌کنندگان بدهکار", value: rows.length, kind: "number" },
      ],
      evidence: [{ label: "فاکتورهای خرید", detail: `${asOf.length} فاکتور تا پایان بازه برای مانده بدهی بررسی شد.`, reportKey: mode === "due" ? "supplier-due" : "supplier-debt" }],
      rowCount: rows.length,
    };
  }

  // top suppliers
  const groups = new Map<string, { name: string; invoices: number; purchase: number; returned: number; net: number; paid: number; outstanding: number }>();
  for (const purchase of scoped) {
    const id = purchase.supplierId as string;
    const row = groups.get(id) ?? { name: supplierName(id), invoices: 0, purchase: 0, returned: 0, net: 0, paid: 0, outstanding: 0 };
    if (purchase.kind === "purchase") {
      row.invoices += 1;
      row.purchase += purchase.total;
      row.outstanding += outstandingPurchase(purchase);
    } else row.returned += purchase.total;
    groups.set(id, row);
  }
  for (const payment of scopedPayments) {
    if (payment.partyType !== "supplier" || !payment.supplierId) continue;
    const row = groups.get(payment.supplierId as string);
    if (row) row.paid += payment.amount;
  }
  let rows: ReportRow[] = [...groups.values()].map((row) => ({ ...row, net: row.purchase - row.returned }));
  rows = sortRows(filterSearch(rows, search), "net").slice(0, 100);
  const columns: ReportColumn[] = [
    { key: "name", label: "تأمین‌کننده", kind: "text" },
    { key: "invoices", label: "تعداد فاکتور", kind: "number" },
    { key: "purchase", label: "خرید", kind: "money" },
    { key: "returned", label: "برگشت", kind: "money" },
    { key: "net", label: "خرید خالص", kind: "money" },
    { key: "paid", label: "پرداخت", kind: "money" },
    { key: "outstanding", label: "مانده", kind: "money" },
  ];
  const totals = sumRows(rows, ["invoices", "purchase", "returned", "net", "paid", "outstanding"]);
  return {
    sections: [{ key: "top", title: "تأمین‌کنندگان اصلی", columns, rows, totals }],
    summary: [
      { key: "purchase", label: "خرید خالص", value: Number(totals.net ?? 0), kind: "money" },
      { key: "suppliers", label: "تأمین‌کنندگان", value: rows.length, kind: "number" },
      { key: "outstanding", label: "مانده بدهی", value: Number(totals.outstanding ?? 0), kind: "money" },
    ],
    chart: {
      title: "تأمین‌کنندگان اصلی",
      type: "bar",
      xKey: "label",
      series: [{ key: "net", label: "خرید خالص" }],
      data: rows.slice(0, 8).map((row) => ({ label: String(row.name), net: Number(row.net) })),
    },
    evidence: [{ label: "فاکتورهای خرید", detail: `${scoped.length} سند خرید و ${scopedPayments.length} پرداخت بررسی شد.`, reportKey: "supplier-top" }],
    rowCount: rows.length,
  };
}

export async function inventoryWarehouseReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  to: number,
  branchId?: Id<"branches">,
): Promise<CommerceReportPayload> {
  const [transactions, warehouses, branches] =
    await Promise.all([
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
        .take(20_000),
      ctx.db
        .query("warehouses")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(500),
      ctx.db
        .query("branches")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .take(200),
    ]);
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const scoped = transactions.filter(
    (row) => row.occurredAt <= to && (!branchId || row.branchId === branchId),
  );
  const groups = new Map<string, { name: string; branch: string; items: number; quantity: number; value: number }>();
  for (const warehouse of warehouses) {
    if (branchId && warehouse.branchId !== branchId) continue;
    groups.set(warehouse._id as string, {
      name: warehouse.name,
      branch: branchMap.get(warehouse.branchId as string)?.name ?? "—",
      items: 0,
      quantity: 0,
      value: 0,
    });
  }
  const productSets = new Map<string, Set<string>>();
  for (const tx of scoped) {
    const key = tx.warehouseId as string;
    const row = groups.get(key) ?? {
      name: "انبار",
      branch: branchMap.get(tx.branchId as string)?.name ?? "—",
      items: 0,
      quantity: 0,
      value: 0,
    };
    const delta = tx.direction === "in" ? 1 : -1;
    row.quantity += delta * tx.quantityMilli;
    row.value += delta * tx.value;
    const set = productSets.get(key) ?? new Set<string>();
    set.add(tx.productId as string);
    productSets.set(key, set);
    groups.set(key, row);
  }
  const rows: ReportRow[] = [...groups.entries()].map(([id, row]) => ({
    name: row.name,
    branch: row.branch,
    items: productSets.get(id)?.size ?? 0,
    quantity: qty(row.quantity),
    value: row.value,
  }));
  const columns: ReportColumn[] = [
    { key: "name", label: "انبار", kind: "text" },
    { key: "branch", label: "شعبه", kind: "text" },
    { key: "items", label: "تعداد کالا", kind: "number" },
    { key: "quantity", label: "موجودی", kind: "number" },
    { key: "value", label: "ارزش موجودی", kind: "money" },
  ];
  const totals = sumRows(rows, ["items", "quantity", "value"]);
  return {
    sections: [{ key: "warehouses", title: "موجودی هر انبار", columns, rows, totals }],
    summary: [
      { key: "value", label: "ارزش موجودی", value: Number(totals.value ?? 0), kind: "money" },
      { key: "warehouses", label: "انبارها", value: rows.length, kind: "number" },
      { key: "quantity", label: "جمع مقدار", value: Number(totals.quantity ?? 0), kind: "number" },
    ],
    chart: {
      title: "ارزش موجودی انبارها",
      type: "bar",
      xKey: "label",
      series: [{ key: "value", label: "ارزش" }],
      data: sortRows(rows, "value").map((row) => ({ label: String(row.name), value: Number(row.value) })),
    },
    evidence: [{ label: "گردش انبار", detail: `${scoped.length} گردش انبار تا تاریخ گزارش محاسبه شد.`, reportKey: "inventory-by-warehouse" }],
    rowCount: rows.length,
  };
}

export async function inventoryTurnover(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<CommerceReportPayload> {
  const [transactions, products, invoicesAll, returns] = await Promise.all([
    ctx.db
      .query("inventoryTransactions")
      .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
      .take(20_000),
    ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(3000),
    ctx.db
      .query("invoices")
      .withIndex("by_business_issue", (q) => q.eq("businessId", businessId))
      .take(5000),
    ctx.db
      .query("salesReturns")
      .withIndex("by_business_occurred", (q) => q.eq("businessId", businessId))
      .take(4000),
  ]);
  const productMap = new Map(products.map((row) => [row._id as string, row]));
  const stock = new Map<string, number>();
  const value = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.occurredAt > to || (branchId && tx.branchId !== branchId)) continue;
    const key = tx.productId as string;
    const delta = tx.direction === "in" ? 1 : -1;
    stock.set(key, (stock.get(key) ?? 0) + delta * tx.quantityMilli);
    value.set(key, (value.get(key) ?? 0) + delta * tx.value);
  }
  const cogs = new Map<string, number>();
  const scoped = scopedInvoices(invoicesAll, from, to, branchId);
  for (const invoice of scoped) {
    if (!invoice.costOfGoods) continue;
    // cost at invoice level cannot be split reliably; use product-level cost when available
  }
  const items = await ctx.db
    .query("invoiceItems")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(15_000);
  const invoiceIds = new Set(scoped.map((row) => row._id as string));
  for (const item of items) {
    if (!item.productId || !invoiceIds.has(item.invoiceId as string)) continue;
    cogs.set(item.productId as string, (cogs.get(item.productId as string) ?? 0) + (item.costTotal ?? 0));
  }
  for (const ret of returns) {
    if (ret.status !== "posted" || ret.occurredAt < from || ret.occurredAt > to) continue;
    if (branchId && ret.branchId !== branchId) continue;
    // product-level return cost is subtracted below when the return item is available
  }
  const rows: ReportRow[] = [...stock.entries()]
    .map(([productId, quantity]) => {
      const product = productMap.get(productId);
      const inventoryValue = Math.max(0, value.get(productId) ?? 0);
      const productCogs = Math.max(0, cogs.get(productId) ?? 0);
      const ratio = inventoryValue > 0 ? productCogs / inventoryValue : 0;
      return {
        name: product?.name ?? "—",
        quantity: qty(quantity),
        inventoryValue,
        cogs: productCogs,
        turnover: Math.round(ratio * 100) / 100,
        days: ratio > 0 ? Math.round(365 / ratio) : 0,
      };
    })
    .filter((row) => Number(row.quantity) !== 0 || Number(row.inventoryValue) !== 0)
    .sort((a, b) => Number(b.inventoryValue) - Number(a.inventoryValue));
  const columns: ReportColumn[] = [
    { key: "name", label: "کالا", kind: "text" },
    { key: "quantity", label: "موجودی", kind: "number" },
    { key: "inventoryValue", label: "ارزش موجودی", kind: "money" },
    { key: "cogs", label: "بهای فروش‌رفته بازه", kind: "money" },
    { key: "turnover", label: "گردش", kind: "number" },
    { key: "days", label: "روز گردش", kind: "number" },
  ];
  const totalValue = rows.reduce((sum, row) => sum + Number(row.inventoryValue), 0);
  const totalCogs = rows.reduce((sum, row) => sum + Number(row.cogs), 0);
  return {
    sections: [{
      key: "turnover",
      title: "گردش موجودی کالاها",
      columns,
      rows,
      totals: { inventoryValue: totalValue, cogs: totalCogs },
      note: "نسبت گردش = بهای تمام‌شده فروش بازه ÷ ارزش جاری موجودی. این نسبت برای مقایسه استفاده می‌شود، نه به‌عنوان تاریخ دقیق فروش.",
    }],
    summary: [
      { key: "inventoryValue", label: "ارزش موجودی", value: totalValue, kind: "money" },
      { key: "cogs", label: "بهای فروش‌رفته", value: totalCogs, kind: "money" },
      { key: "turnover", label: "گردش کل", value: totalValue ? Math.round((totalCogs / totalValue) * 100) / 100 : 0, kind: "number" },
      { key: "items", label: "اقلام دارای موجودی", value: rows.length, kind: "number" },
    ],
    evidence: [{ label: "گردش انبار و ردیف فروش", detail: `${transactions.length} گردش انبار و ${scoped.length} فاکتور برای محاسبه استفاده شد.`, reportKey: "inventory-turnover" }],
    rowCount: rows.length,
  };
}

export async function inventoryCountDifferences(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<CommerceReportPayload> {
  const [documents, branches, warehouses] = await Promise.all([
    ctx.db
      .query("inventoryDocuments")
      .withIndex("by_business_date", (q) => q.eq("businessId", businessId))
      .take(5000),
    ctx.db
      .query("branches")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(200),
    ctx.db
      .query("warehouses")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .take(500),
  ]);
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const warehouseMap = new Map(warehouses.map((row) => [row._id as string, row]));
  const scoped = documents.filter(
    (row) =>
      row.occurredAt >= from &&
      row.occurredAt <= to &&
      row.status === "posted" &&
      (row.type === "count" || row.type === "adjustment") &&
      (!branchId || row.branchId === branchId),
  );
  let rows: ReportRow[] = scoped.map((row) => ({
    number: row.number,
    date: row.occurredAt,
    description: row.description,
    type: row.type === "count" ? "شمارش" : "اصلاح",
    direction: row.adjustmentDirection === "out" ? "کاهش" : row.adjustmentDirection === "in" ? "افزایش" : "—",
    branch: branchMap.get(row.branchId as string)?.name ?? "—",
    warehouse: warehouseMap.get((row.toWarehouseId ?? row.fromWarehouseId ?? "") as string)?.name ?? "—",
    value: row.totalValue,
    documentId: row.accountingDocumentId,
  }));
  rows = filterSearch(sortRows(rows, "date", "desc"), search);
  const columns: ReportColumn[] = [
    { key: "number", label: "شماره سند", kind: "doc" },
    { key: "date", label: "تاریخ", kind: "date" },
    { key: "type", label: "نوع", kind: "text" },
    { key: "direction", label: "جهت", kind: "text" },
    { key: "branch", label: "شعبه", kind: "text" },
    { key: "warehouse", label: "انبار", kind: "text" },
    { key: "description", label: "شرح", kind: "text" },
    { key: "value", label: "ارزش", kind: "money" },
  ];
  const totals = sumRows(rows, ["value"]);
  return {
    sections: [{
      key: "counts",
      title: "اسناد انبارگردانی و اصلاح موجودی",
      columns,
      rows,
      totals,
      note: "این گزارش اسناد شمارش/اصلاح ثبت‌شده را نشان می‌دهد. اگر سند شمارش اختلافی ثبت نشده باشد، اختلافی برای نمایش وجود ندارد.",
    }],
    summary: [
      { key: "documents", label: "اسناد", value: rows.length, kind: "number" },
      { key: "value", label: "ارزش اصلاحات", value: Number(totals.value ?? 0), kind: "money" },
    ],
    evidence: [{ label: "اسناد انبار", detail: `${scoped.length} سند شمارش یا اصلاح در بازه تأیید شده است.`, reportKey: "inventory-count-differences" }],
    rowCount: rows.length,
  };
}
