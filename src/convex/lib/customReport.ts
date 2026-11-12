import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { permissionsFor } from "./hr";
import { jalaliDateLabel, timestampToJalali } from "./calendar";
import { outstandingInvoice, outstandingPurchase, percentage } from "./reportTypes";

export type CustomFieldKind = "text" | "money" | "number" | "date" | "percent";
export interface CustomField {
  key: string;
  label: string;
  kind: CustomFieldKind;
  sensitive?: boolean;
}
export interface CustomModule {
  key: string;
  label: string;
  permission: "general" | "hr" | "payroll" | "tax" | "assets" | "financial";
  fields: CustomField[];
}

export const CUSTOM_MODULES: CustomModule[] = [
  {
    key: "invoices",
    label: "فروش و فاکتورها",
    permission: "general",
    fields: [
      { key: "number", label: "شماره فاکتور", kind: "text" },
      { key: "date", label: "تاریخ", kind: "date" },
      { key: "customer", label: "مشتری", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "user", label: "ثبت‌کننده", kind: "text" },
      { key: "total", label: "مبلغ کل", kind: "money" },
      { key: "tax", label: "مالیات", kind: "money" },
      { key: "discount", label: "تخفیف", kind: "money" },
      { key: "paid", label: "دریافت‌شده", kind: "money" },
      { key: "outstanding", label: "مانده", kind: "money", sensitive: true },
      { key: "cost", label: "بهای تمام‌شده", kind: "money", sensitive: true },
      { key: "profit", label: "سود ناخالص", kind: "money", sensitive: true },
    ],
  },
  {
    key: "purchases",
    label: "خرید و فاکتورهای خرید",
    permission: "general",
    fields: [
      { key: "number", label: "شماره سند", kind: "text" },
      { key: "date", label: "تاریخ", kind: "date" },
      { key: "supplier", label: "تأمین‌کننده", kind: "text" },
      { key: "kind", label: "نوع", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "total", label: "مبلغ کل", kind: "money" },
      { key: "tax", label: "مالیات", kind: "money" },
      { key: "paid", label: "پرداخت‌شده", kind: "money" },
      { key: "outstanding", label: "مانده", kind: "money", sensitive: true },
    ],
  },
  {
    key: "inventory",
    label: "موجودی انبار",
    permission: "general",
    fields: [
      { key: "code", label: "کد کالا", kind: "text" },
      { key: "product", label: "کالا", kind: "text" },
      { key: "category", label: "دسته", kind: "text" },
      { key: "warehouse", label: "انبار", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "quantity", label: "موجودی", kind: "number" },
      { key: "minStock", label: "حداقل موجودی", kind: "number" },
      { key: "value", label: "ارزش موجودی", kind: "money", sensitive: true },
      { key: "expiryDate", label: "تاریخ انقضا", kind: "date" },
    ],
  },
  {
    key: "customers",
    label: "مشتریان",
    permission: "general",
    fields: [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "نام", kind: "text" },
      { key: "phone", label: "تلفن", kind: "text" },
      { key: "active", label: "فعال", kind: "text" },
      { key: "balance", label: "مانده مطالبات", kind: "money", sensitive: true },
      { key: "creditLimit", label: "سقف اعتبار", kind: "money", sensitive: true },
    ],
  },
  {
    key: "suppliers",
    label: "تأمین‌کنندگان",
    permission: "general",
    fields: [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "نام", kind: "text" },
      { key: "phone", label: "تلفن", kind: "text" },
      { key: "active", label: "فعال", kind: "text" },
      { key: "balance", label: "مانده بدهی", kind: "money", sensitive: true },
      { key: "creditLimit", label: "سقف اعتبار", kind: "money", sensitive: true },
    ],
  },
  {
    key: "employees",
    label: "پرسنل",
    permission: "hr",
    fields: [
      { key: "code", label: "کد پرسنلی", kind: "text" },
      { key: "name", label: "نام", kind: "text" },
      { key: "jobTitle", label: "عنوان شغلی", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "employmentType", label: "نوع همکاری", kind: "text" },
      { key: "hireDate", label: "تاریخ استخدام", kind: "date" },
    ],
  },
  {
    key: "payroll",
    label: "حقوق و دستمزد",
    permission: "payroll",
    fields: [
      { key: "period", label: "دوره", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "employee", label: "پرسنل", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "base", label: "حقوق پایه", kind: "money" },
      { key: "gross", label: "جمع حقوق", kind: "money" },
      { key: "insurance", label: "بیمه کارمند", kind: "money" },
      { key: "tax", label: "مالیات", kind: "money" },
      { key: "net", label: "خالص پرداختی", kind: "money" },
      { key: "employerInsurance", label: "بیمه کارفرما", kind: "money" },
    ],
  },
  {
    key: "tax",
    label: "مالیات",
    permission: "tax",
    fields: [
      { key: "period", label: "دوره", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "type", label: "نوع مالیات", kind: "text" },
      { key: "dueDate", label: "سررسید", kind: "date" },
      { key: "base", label: "مأخذ", kind: "money" },
      { key: "tax", label: "مبلغ مالیات", kind: "money" },
    ],
  },
  {
    key: "assets",
    label: "دارایی ثابت",
    permission: "assets",
    fields: [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "دارایی", kind: "text" },
      { key: "group", label: "گروه", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "purchaseDate", label: "تاریخ خرید", kind: "date" },
      { key: "cost", label: "بهای تمام‌شده", kind: "money" },
      { key: "accumulated", label: "استهلاک انباشته", kind: "money" },
      { key: "bookValue", label: "ارزش دفتری", kind: "money" },
    ],
  },
  {
    key: "documents",
    label: "اسناد حسابداری",
    permission: "financial",
    fields: [
      { key: "number", label: "شماره سند", kind: "text" },
      { key: "date", label: "تاریخ", kind: "date" },
      { key: "description", label: "شرح", kind: "text" },
      { key: "status", label: "وضعیت", kind: "text" },
      { key: "kind", label: "نوع", kind: "text" },
      { key: "branch", label: "شعبه", kind: "text" },
      { key: "source", label: "منبع", kind: "text" },
      { key: "debit", label: "بدهکار", kind: "money" },
      { key: "credit", label: "بستانکار", kind: "money" },
    ],
  },
];

export const CUSTOM_MODULE_MAP = new Map(CUSTOM_MODULES.map((module) => [module.key, module]));

const GROUPABLE = new Set([
  "status",
  "branch",
  "warehouse",
  "category",
  "kind",
  "group",
  "active",
  "employmentType",
  "period",
  "type",
  "user",
  "product",
  "customer",
  "supplier",
]);

export interface CustomReportConfig {
  module: string;
  fields: string[];
  groupBy?: string;
  sortKey?: string;
  sortDirection: "asc" | "desc";
  search?: string;
}

export function parseCustomConfig(value: string): CustomReportConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ConvexError("قالب گزارش معتبر نیست.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ConvexError("قالب گزارش معتبر نیست.");
  }
  const config = parsed as Partial<CustomReportConfig>;
  const module = CUSTOM_MODULE_MAP.get(String(config.module ?? ""));
  if (!module) throw new ConvexError("ماژول گزارش انتخاب‌شده مجاز نیست.");
  if (!Array.isArray(config.fields) || config.fields.length === 0) {
    throw new ConvexError("حداقل یک ستون برای گزارش انتخاب کنید.");
  }
  const fields = [...new Set(config.fields.map(String))];
  const allowed = new Set(module.fields.map((field) => field.key));
  if (fields.some((field) => !allowed.has(field))) {
    throw new ConvexError("یکی از ستون‌های انتخابی برای این ماژول مجاز نیست.");
  }
  if (config.groupBy && !fields.includes(config.groupBy)) {
    throw new ConvexError("ستون گروه‌بندی باید یکی از ستون‌های انتخابی باشد.");
  }
  if (config.groupBy && !GROUPABLE.has(config.groupBy)) {
    throw new ConvexError("گروه‌بندی روی این ستون مجاز نیست.");
  }
  const sortKey = config.sortKey && fields.includes(config.sortKey) ? config.sortKey : fields[0];
  return {
    module: module.key,
    fields,
    groupBy: config.groupBy,
    sortKey,
    sortDirection: config.sortDirection === "asc" ? "asc" : "desc",
    search: typeof config.search === "string" ? config.search.slice(0, 100) : undefined,
  };
}

interface CustomResult {
  module: string;
  moduleLabel: string;
  title: string;
  columns: { key: string; label: string; kind: CustomFieldKind }[];
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
  rowCount: number;
  from: number;
  to: number;
  businessName: string;
  fiscalYearName: string;
  generatedAt: number;
  note: string;
}

export async function runCustomReport(
  ctx: QueryCtx,
  options: {
    businessId: Id<"businesses">;
    fiscalYearId: Id<"fiscalYears">;
    userId: Id<"users">;
    membership: Doc<"businessMembers">;
    configValue: string;
    from: number;
    to: number;
    branchId?: Id<"branches">;
    search?: string;
  },
): Promise<CustomResult> {
  const config = parseCustomConfig(options.configValue);
  const module = CUSTOM_MODULE_MAP.get(config.module)!;
  const granted = permissionsFor(options.membership);
  if (module.permission === "payroll" && !granted.includes("payroll.view")) {
    throw new ConvexError("مجوز مشاهده اطلاعات حقوق و دستمزد را ندارید.");
  }
  if (module.permission === "tax" && !granted.includes("tax.view")) {
    throw new ConvexError("مجوز مشاهده اطلاعات مالیاتی را ندارید.");
  }
  if (module.permission === "assets" && !granted.includes("assets.view")) {
    throw new ConvexError("مجوز مشاهده اطلاعات دارایی ثابت را ندارید.");
  }
  if (module.permission === "hr" && !granted.includes("hr.view")) {
    throw new ConvexError("مجوز مشاهده اطلاعات پرسنلی را ندارید.");
  }
  if (module.permission === "financial" && options.membership.role === "viewer") {
    throw new ConvexError("این ماژول برای نقش شما مجاز نیست.");
  }
  const fieldMap = new Map(module.fields.map((field) => [field.key, field]));
  for (const key of config.fields) {
    const field = fieldMap.get(key)!;
    if (field.sensitive && options.membership.role === "viewer") {
      throw new ConvexError("ستون حساس برای نقش شما مجاز نیست.");
    }
  }
  const [business, fiscalYear, branches, users] = await Promise.all([
    ctx.db.get(options.businessId),
    ctx.db.get(options.fiscalYearId),
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(200),
    ctx.db.query("users").take(1000),
  ]);
  if (!business || !fiscalYear) throw new ConvexError("اطلاعات کسب‌وکار یا دوره مالی یافت نشد.");
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const userMap = new Map(users.map((row) => [row._id as string, row]));
  const branchName = (id: unknown) => branchMap.get(String(id ?? ""))?.name ?? "—";
  let raw: Record<string, unknown>[] = [];
  if (config.module === "invoices") {
    const [invoices, customers] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", options.businessId)).take(6000),
      ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(3000),
    ]);
    const customerMap = new Map(customers.map((row) => [row._id as string, row]));
    raw = invoices
      .filter((row) => row.issueDate >= options.from && row.issueDate <= options.to && (!options.branchId || row.branchId === options.branchId))
      .map((row) => ({
        number: row.number,
        date: row.issueDate,
        customer: customerMap.get(row.customerId as string)?.name ?? "—",
        status: row.status,
        branch: branchName(row.branchId),
        user: userMap.get(row.createdBy as string)?.name ?? "—",
        total: row.total,
        tax: row.taxAmount,
        discount: row.discount,
        paid: row.paidAmount ?? 0,
        outstanding: outstandingInvoice(row),
        cost: row.costOfGoods ?? 0,
        profit: row.total - (row.returnedAmount ?? 0) - (row.costOfGoods ?? 0),
      }));
  } else if (config.module === "purchases") {
    const [purchases, suppliers] = await Promise.all([
      ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", options.businessId)).take(6000),
      ctx.db.query("suppliers").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(3000),
    ]);
    const supplierMap = new Map(suppliers.map((row) => [row._id as string, row]));
    raw = purchases
      .filter((row) => row.issueDate >= options.from && row.issueDate <= options.to && (!options.branchId || row.branchId === options.branchId))
      .map((row) => ({
        number: row.number,
        date: row.issueDate,
        supplier: supplierMap.get(row.supplierId as string)?.name ?? "—",
        kind: row.kind === "return" ? "برگشت" : "خرید",
        status: row.status,
        branch: branchName(row.branchId),
        total: row.total,
        tax: row.taxAmount,
        paid: row.paidAmount,
        outstanding: outstandingPurchase(row),
      }));
  } else if (config.module === "customers") {
    const [customers, invoices] = await Promise.all([
      ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(4000),
      ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", options.businessId)).take(6000),
    ]);
    const balances = new Map<string, number>();
    for (const invoice of invoices) {
      if (invoice.issueDate > options.to || invoice.status === "draft" || invoice.status === "void") continue;
      if (options.branchId && invoice.branchId !== options.branchId) continue;
      balances.set(invoice.customerId as string, (balances.get(invoice.customerId as string) ?? 0) + outstandingInvoice(invoice));
    }
    raw = customers.map((row) => ({
      code: row.code,
      name: row.name,
      phone: row.phone ?? row.mobile ?? "—",
      active: row.active === false ? "غیرفعال" : "فعال",
      balance: balances.get(row._id as string) ?? 0,
      creditLimit: row.creditLimit ?? 0,
    }));
  } else if (config.module === "suppliers") {
    const [suppliers, purchases] = await Promise.all([
      ctx.db.query("suppliers").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(4000),
      ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", options.businessId)).take(6000),
    ]);
    const balances = new Map<string, number>();
    for (const purchase of purchases) {
      if (purchase.issueDate > options.to || purchase.status === "draft" || purchase.status === "cancelled" || purchase.kind !== "purchase") continue;
      if (options.branchId && purchase.branchId !== options.branchId) continue;
      balances.set(purchase.supplierId as string, (balances.get(purchase.supplierId as string) ?? 0) + outstandingPurchase(purchase));
    }
    raw = suppliers.map((row) => ({
      code: row.code,
      name: row.name,
      phone: row.phone ?? row.mobile ?? "—",
      active: row.active ? "فعال" : "غیرفعال",
      balance: balances.get(row._id as string) ?? 0,
      creditLimit: row.creditLimit,
    }));
  } else if (config.module === "inventory") {
    const [transactions, products, categories, warehouses] = await Promise.all([
      ctx.db.query("inventoryTransactions").withIndex("by_business_occurred", (q) => q.eq("businessId", options.businessId)).take(25_000),
      ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(4000),
      ctx.db.query("productCategories").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(1000),
      ctx.db.query("warehouses").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(500),
    ]);
    const categoryMap = new Map(categories.map((row) => [row._id as string, row]));
    const warehouseMap = new Map(warehouses.map((row) => [row._id as string, row]));
    const groups = new Map<string, { quantity: number; value: number }>();
    for (const tx of transactions) {
      if (tx.occurredAt > options.to) continue;
      if (options.branchId && tx.branchId !== options.branchId) continue;
      const key = `${tx.productId}:${tx.warehouseId}`;
      const row = groups.get(key) ?? { quantity: 0, value: 0 };
      const delta = tx.direction === "in" ? 1 : -1;
      row.quantity += delta * tx.quantityMilli;
      row.value += delta * tx.value;
      groups.set(key, row);
    }
    raw = [...groups.entries()].map(([key, value]) => {
      const [productId, warehouseId] = key.split(":");
      const product = products.find((row) => row._id === productId);
      const warehouse = warehouseMap.get(warehouseId);
      return {
        code: product?.code ?? "—",
        product: product?.name ?? "—",
        category: product?.categoryId ? categoryMap.get(product.categoryId as string)?.name ?? "—" : "—",
        warehouse: warehouse?.name ?? "—",
        branch: warehouse ? branchName(warehouse.branchId) : "—",
        quantity: Math.round(value.quantity) / 1000,
        minStock: product ? Math.round(product.minStockMilli) / 1000 : 0,
        value: value.value,
        expiryDate: product?.expiryDate ?? 0,
      };
    });
  } else if (config.module === "employees") {
    const employees = await ctx.db.query("employees").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(5000);
    raw = employees
      .filter((row) => !options.branchId || row.branchId === options.branchId)
      .map((row) => ({
        code: row.code,
        name: `${row.firstName} ${row.lastName}`,
        jobTitle: row.jobTitle,
        branch: branchName(row.branchId),
        status: row.status,
        employmentType: row.employmentType,
        hireDate: row.hireDate,
      }));
  } else if (config.module === "payroll") {
    const [periods, records, employees] = await Promise.all([
      ctx.db.query("payrollPeriods").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(500),
      ctx.db.query("payrollRecords").withIndex("by_business_branch", (q) => q.eq("businessId", options.businessId)).take(10_000),
      ctx.db.query("employees").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(5000),
    ]);
    const periodMap = new Map(periods.map((row) => [row._id as string, row]));
    const employeeMap = new Map(employees.map((row) => [row._id as string, row]));
    raw = records
      .filter((row) => {
        const period = periodMap.get(row.periodId as string);
        return period && period.startAt <= options.to && period.endAt >= options.from && (!options.branchId || row.branchId === options.branchId);
      })
      .map((row) => {
        const period = periodMap.get(row.periodId as string)!;
        const employee = employeeMap.get(row.employeeId as string);
        return {
          period: period.title,
          status: period.status,
          employee: employee ? `${employee.firstName} ${employee.lastName}` : "—",
          branch: branchName(row.branchId),
          base: row.baseSalary,
          gross: row.gross,
          insurance: row.insuranceEmployee,
          tax: row.tax,
          net: row.net,
          employerInsurance: row.employerInsurance,
        };
      });
  } else if (config.module === "tax") {
    const [periods, records] = await Promise.all([
      ctx.db.query("taxPeriods").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(1000),
      ctx.db.query("taxRecords").withIndex("by_business_period", (q) => q.eq("businessId", options.businessId)).take(5000),
    ]);
    const periodMap = new Map(periods.map((row) => [row._id as string, row]));
    const labels: Record<string, string> = { sales: "فروش", purchase: "خرید", payroll: "حقوق", vat: "ارزش افزوده", other: "سایر" };
    raw = records
      .map((row) => {
        const period = periodMap.get(row.periodId as string);
        if (!period) return null;
        if (period.startAt > options.to || period.endAt < options.from) return null;
        return {
          period: period.title,
          status: period.status,
          type: labels[row.taxType] ?? row.taxType,
          dueDate: period.dueDate,
          base: row.taxableBase,
          tax: row.taxAmount,
        };
      })
      .filter(Boolean) as Record<string, unknown>[];
  } else if (config.module === "assets") {
    const [assets, depreciations] = await Promise.all([
      ctx.db.query("fixedAssets").withIndex("by_business", (q) => q.eq("businessId", options.businessId)).take(3000),
      ctx.db.query("assetDepreciations").withIndex("by_business_period", (q) => q.eq("businessId", options.businessId)).take(20_000),
    ]);
    const accumulated = new Map<string, number>();
    for (const row of depreciations) {
      if (row.periodEnd > options.to) continue;
      accumulated.set(row.assetId as string, (accumulated.get(row.assetId as string) ?? 0) + row.amount);
    }
    raw = assets
      .filter((row) => row.purchaseDate <= options.to && (!options.branchId || row.branchId === options.branchId))
      .map((row) => {
        const acc = accumulated.get(row._id as string) ?? 0;
        return {
          code: row.code,
          name: row.name,
          group: row.group,
          branch: branchName(row.branchId),
          status: row.status,
          purchaseDate: row.purchaseDate,
          cost: row.cost,
          accumulated: acc,
          bookValue: row.cost - acc,
        };
      });
  } else if (config.module === "documents") {
    const documents = await ctx.db.query("accountingDocuments").withIndex("by_business_fiscal_date", (q) => q.eq("businessId", options.businessId).eq("fiscalYearId", options.fiscalYearId).gte("documentDate", options.from).lte("documentDate", options.to)).take(6000);
    raw = documents
      .filter((row) => !options.branchId || row.branchId === options.branchId)
      .map((row) => ({
        number: row.number,
        date: row.documentDate,
        description: row.description,
        status: row.status,
        kind: row.kind,
        branch: branchName(row.branchId),
        source: row.sourceType ?? "دستی",
        debit: row.totalDebit,
        credit: row.totalCredit,
      }));
  }
  const needle = (options.search ?? config.search ?? "").trim().toLocaleLowerCase("fa");
  if (needle) {
    raw = raw.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase("fa").includes(needle)),
    );
  }
  const selectedFields = config.fields.map((key) => fieldMap.get(key)!);
  const numericFields = selectedFields.filter((field) => field.kind === "money" || field.kind === "number" || field.kind === "percent");
  const project = (row: Record<string, unknown>) => {
    const projected: Record<string, unknown> = {};
    for (const field of selectedFields) projected[field.key] = row[field.key] ?? "";
    return projected;
  };
  let rows = raw.map(project);
  let columns = selectedFields.map((field) => ({ key: field.key, label: field.label, kind: field.kind }));
  if (config.groupBy) {
    const groupField = fieldMap.get(config.groupBy)!;
    const grouped = new Map<string, Record<string, unknown>>();
    for (const source of raw) {
      let label = source[config.groupBy];
      if (groupField.kind === "date" && typeof label === "number") {
        const parts = timestampToJalali(label);
        label = `${parts.jy}-${String(parts.jm).padStart(2, "0")}`;
      }
      const key = String(label ?? "—");
      const aggregate = grouped.get(key) ?? {
        [config.groupBy]: groupField.kind === "date" ? key : label ?? "—",
        count: 0,
        ...Object.fromEntries(numericFields.map((field) => [field.key, 0])),
      };
      aggregate.count = Number(aggregate.count ?? 0) + 1;
      for (const field of numericFields) aggregate[field.key] = Number(aggregate[field.key] ?? 0) + Number(source[field.key] ?? 0);
      grouped.set(key, aggregate);
    }
    columns = [
      { key: config.groupBy, label: groupField.label, kind: groupField.kind },
      { key: "count", label: "تعداد", kind: "number" as const },
      ...numericFields.filter((field) => field.key !== config.groupBy).map((field) => ({ key: field.key, label: field.label, kind: field.kind })),
    ];
    rows = [...grouped.values()];
  }
  const sortKey = config.sortKey && rows.length && config.sortKey in rows[0] ? config.sortKey : columns[0]?.key;
  if (sortKey) {
    rows.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const factor = config.sortDirection === "asc" ? 1 : -1;
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return String(left ?? "").localeCompare(String(right ?? ""), "fa") * factor;
    });
  }
  const totals: Record<string, number> = {};
  for (const column of columns) {
    if (column.kind === "money" || column.kind === "number" || column.kind === "percent") {
      totals[column.key] = rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0);
    }
  }
  return {
    module: config.module,
    moduleLabel: module.label,
    title: `گزارش سفارشی ${module.label}`,
    columns,
    rows,
    totals,
    rowCount: rows.length,
    from: options.from,
    to: options.to,
    businessName: business.name,
    fiscalYearName: fiscalYear.name,
    generatedAt: Date.now(),
    note: config.groupBy
      ? `گروه‌بندی بر اساس «${fieldMap.get(config.groupBy)?.label}» و مجموع ستون‌های عددی محاسبه شده است.`
      : `این گزارش فقط از ${raw.length} رکورد مجاز کسب‌وکار ساخته شده است.`,
  };
}

export function customColumnLabel(moduleKey: string, fieldKey: string) {
  return CUSTOM_MODULE_MAP.get(moduleKey)?.fields.find((field) => field.key === fieldKey)?.label ?? fieldKey;
}

export function customDateLabel(value: number) {
  return jalaliDateLabel(value);
}

export function customShare(value: number, total: number) {
  return percentage(value, total);
}
