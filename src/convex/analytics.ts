import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership } from "./lib/tenant";
import { permissionsFor } from "./lib/hr";
import { getFiscalYear } from "./lib/accounting";
import {
  loadBusinessAccounts,
  loadFinalizedLines,
  toAccountLike,
  toLineLike,
  type FinalizedLine,
} from "./lib/ledger";
import { trialBalance } from "./lib/accountingMath";
import {
  jalaliDateLabel,
  jalaliMonthEnd,
  jalaliMonthLabel,
  jalaliMonthStart,
  timestampToJalali,
} from "./lib/calendar";
import {
  reportCategoryLabel,
  reportDefinition,
  type ReportPermission,
} from "./lib/reportCatalog";
import {
  customerReport,
  inventoryCountDifferences,
  inventoryTurnover,
  inventoryWarehouseReport,
  invoiceAverage,
  productSales,
  purchaseReport,
  salesByCategory,
  salesMargin,
} from "./lib/commerceReportData";
import {
  emptyTotals,
  growth,
  moneySection,
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
  type ReportPayload,
  type ReportRow,
  type ReportSection,
  type ReportSummaryItem,
} from "./lib/reportTypes";

const DAY = 24 * 60 * 60 * 1000;
const STATUS_LABELS: Record<string, string> = {
  draft: "پیش‌نویس",
  pending: "در انتظار تأیید",
  posted: "قطعی",
  reversed: "معکوس‌شده",
  cancelled: "لغوشده",
  paid: "پرداخت‌شده",
  void: "ابطال‌شده",
  open: "باز",
  filed: "ارسال‌شده",
  closed: "بسته",
  calculated: "محاسبه‌شده",
  approved: "تأییدشده",
};
const KIND_LABELS: Record<string, string> = {
  normal: "عادی",
  opening: "افتتاحیه",
  closing: "اختتامیه",
};
const OPERATION_LABELS: Record<string, string> = {
  opening: "مانده ابتدای دوره",
  receipt: "دریافت وجه",
  payment: "پرداخت وجه",
  income: "درآمد",
  expense: "هزینه",
  "sales-invoice": "دریافت فاکتور فروش",
  "sales-return": "برگشت وجه فروش",
  "purchase-invoice": "پرداخت فاکتور خرید",
  "purchase-return": "دریافت برگشت خرید",
  "transfer-out": "انتقال از حساب",
  "transfer-in": "انتقال به حساب",
  "transfer-fee": "کارمزد انتقال",
  "payroll-payment": "پرداخت حقوق",
  "employee-loan": "وام کارمند",
  "employee-advance": "مساعده کارمند",
  "loan-installment": "قسط وام کارمند",
  "fixed-asset-purchase": "خرید دارایی ثابت",
  "asset-repair": "تعمیر دارایی",
  "asset-sale": "فروش دارایی",
  "check-collection": "وصول چک",
  "check-payment": "پرداخت چک",
  "purchase-opening": "مانده افتتاحیه",
  "bank-opening": "مانده افتتاحیه بانک",
  "fund-opening": "مانده افتتاحیه صندوق",
};

function assertRange(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new ConvexError("بازه تاریخ گزارش معتبر نیست.");
  }
  if (to - from > 3 * 365 * DAY) {
    throw new ConvexError("بازه گزارش نمی‌تواند بیش از سه سال باشد.");
  }
}

async function authorizeReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  permission: ReportPermission,
) {
  const access = await requireMembership(ctx, businessId);
  const granted = permissionsFor(access.membership);
  if (permission === "payroll" && !granted.includes("payroll.view")) {
    throw new ConvexError("مجوز مشاهده گزارش‌های حقوق و دستمزد را ندارید.");
  }
  if (permission === "tax" && !granted.includes("tax.view")) {
    throw new ConvexError("مجوز مشاهده گزارش‌های مالیاتی را ندارید.");
  }
  if (permission === "assets" && !granted.includes("assets.view")) {
    throw new ConvexError("مجوز مشاهده گزارش‌های دارایی ثابت را ندارید.");
  }
  if (permission === "sensitive" && access.membership.role === "viewer") {
    throw new ConvexError("این گزارش شامل اطلاعات مالی تفصیلی است و برای نقش شما مجاز نیست.");
  }
  return { ...access, granted };
}

async function resolveFiscalYear(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  fiscalYearId?: Id<"fiscalYears">,
) {
  if (fiscalYearId) return await getFiscalYear(ctx, businessId, fiscalYearId);
  const years = await ctx.db
    .query("fiscalYears")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(50);
  if (years.length === 0) {
    throw new ConvexError("دوره مالی برای این کسب‌وکار ثبت نشده است.");
  }
  const now = Date.now();
  const active = years.find((year) => year.startAt <= now && year.endAt >= now);
  return active ?? years.sort((a, b) => b.startAt - a.startAt)[0];
}

interface AccountingData {
  accounts: Doc<"accounts">[];
  accountMap: Map<string, Doc<"accounts">>;
  entries: FinalizedLine[];
}

async function loadAccounting(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  fiscalYearId: Id<"fiscalYears">,
  branchId: Id<"branches"> | undefined,
  to: number,
): Promise<AccountingData> {
  const [accounts, entries] = await Promise.all([
    loadBusinessAccounts(ctx, businessId),
    loadFinalizedLines(ctx, businessId, fiscalYearId, 0, to),
  ]);
  return {
    accounts,
    accountMap: new Map(accounts.map((account) => [account._id as string, account])),
    entries: branchId
      ? entries.filter((entry) => entry.document.branchId === branchId)
      : entries,
  };
}

function nearestLedger(
  account: Doc<"accounts"> | undefined,
  map: Map<string, Doc<"accounts">>,
) {
  let current = account;
  let guard = 0;
  while (current && current.level !== "ledger" && guard < 12) {
    current = current.parentId ? map.get(current.parentId as string) : undefined;
    guard += 1;
  }
  return current?.level === "ledger" ? current : undefined;
}

interface IncomePart {
  revenue: ReportRow[];
  cogs: ReportRow[];
  opex: ReportRow[];
  otherIncome: ReportRow[];
  otherExpenses: ReportRow[];
  totals: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    opex: number;
    operatingProfit: number;
    otherIncome: number;
    otherExpenses: number;
    netProfit: number;
    margin: number;
  };
  lineCount: number;
  documentCount: number;
}

function computeIncome(
  data: AccountingData,
  from: number,
  to: number,
): IncomePart {
  const groups = new Map<
    string,
    { code: string; name: string; amount: number; bucket: keyof Pick<IncomePart, "revenue" | "cogs" | "opex" | "otherIncome" | "otherExpenses"> }
  >();
  const docIds = new Set<string>();
  let lineCount = 0;
  for (const entry of data.entries) {
    const { document, line } = entry;
    if (document.documentDate < from || document.documentDate > to) continue;
    if (document.kind === "opening" || document.kind === "closing") continue;
    const account = data.accountMap.get(line.accountId as string);
    if (!account) continue;
    const ledger = nearestLedger(account, data.accountMap);
    if (!ledger || (ledger.type !== "income" && ledger.type !== "expense")) continue;
    const bucket: keyof Pick<IncomePart, "revenue" | "cogs" | "opex" | "otherIncome" | "otherExpenses"> =
      ledger.code.startsWith("42")
        ? "otherIncome"
        : ledger.type === "income"
          ? "revenue"
          : ledger.code.startsWith("51")
            ? "cogs"
            : ledger.code.startsWith("53")
              ? "otherExpenses"
              : "opex";
    const amount =
      ledger.type === "income"
        ? line.credit - line.debit
        : line.debit - line.credit;
    const key = `${bucket}:${ledger._id}`;
    const row = groups.get(key) ?? {
      code: ledger.code,
      name: ledger.name,
      amount: 0,
      bucket,
    };
    row.amount += amount;
    groups.set(key, row);
    docIds.add(document._id as string);
    lineCount += 1;
  }
  const buckets: Record<string, ReportRow[]> = {
    revenue: [],
    cogs: [],
    opex: [],
    otherIncome: [],
    otherExpenses: [],
  };
  for (const row of groups.values()) {
    if (row.amount === 0) continue;
    buckets[row.bucket].push({
      code: row.code,
      name: row.name,
      amount: row.amount,
    });
  }
  for (const rows of Object.values(buckets)) {
    rows.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  }
  const sum = (rows: ReportRow[]) =>
    rows.reduce((total, row) => total + Number(row.amount), 0);
  const revenue = sum(buckets.revenue);
  const cogs = sum(buckets.cogs);
  const opex = sum(buckets.opex);
  const otherIncome = sum(buckets.otherIncome);
  const otherExpenses = sum(buckets.otherExpenses);
  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - opex;
  const netProfit = operatingProfit + otherIncome - otherExpenses;
  return {
    revenue: buckets.revenue,
    cogs: buckets.cogs,
    opex: buckets.opex,
    otherIncome: buckets.otherIncome,
    otherExpenses: buckets.otherExpenses,
    totals: {
      revenue,
      cogs,
      grossProfit,
      opex,
      operatingProfit,
      otherIncome,
      otherExpenses,
      netProfit,
      margin: percentage(netProfit, revenue),
    },
    lineCount,
    documentCount: docIds.size,
  };
}

function incomeSections(part: IncomePart): ReportSection[] {
  return [
    moneySection("revenue", "درآمد فروش", part.revenue),
    moneySection("cogs", "بهای تمام‌شده کالای فروش‌رفته", part.cogs),
    moneySection("opex", "هزینه‌های عملیاتی", part.opex),
    moneySection("other-income", "سایر درآمدها", part.otherIncome),
    moneySection("other-expenses", "سایر هزینه‌ها", part.otherExpenses),
  ];
}

function incomeSummary(part: IncomePart): ReportSummaryItem[] {
  return [
    { key: "revenue", label: "مجموع فروش", value: part.totals.revenue, kind: "money" },
    { key: "cogs", label: "بهای تمام‌شده", value: part.totals.cogs, kind: "money" },
    { key: "gross", label: "سود ناخالص", value: part.totals.grossProfit, kind: "money" },
    { key: "opex", label: "هزینه‌های عملیاتی", value: part.totals.opex, kind: "money" },
    { key: "operating", label: "سود عملیاتی", value: part.totals.operatingProfit, kind: "money" },
    { key: "other-income", label: "سایر درآمدها", value: part.totals.otherIncome, kind: "money" },
    { key: "other-expense", label: "سایر هزینه‌ها", value: part.totals.otherExpenses, kind: "money" },
    { key: "net", label: "سود (زیان) خالص", value: part.totals.netProfit, kind: "money" },
    { key: "margin", label: "حاشیه سود خالص", value: part.totals.margin, kind: "percent" },
  ];
}

function monthlyBuckets(from: number, to: number, max = 36) {
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

function basePayload(
  definition: NonNullable<ReturnType<typeof reportDefinition>>,
  access: Awaited<ReturnType<typeof authorizeReport>>,
  fiscalYear: Doc<"fiscalYears">,
  branchName: string | undefined,
  from: number,
  to: number,
  content: {
    sections: ReportSection[];
    summary: ReportSummaryItem[];
    chart?: ReportPayload["chart"];
    evidence: ReportEvidence[];
    note?: string;
  },
): ReportPayload {
  return {
    key: definition.key,
    title: definition.title,
    category: reportCategoryLabel(definition.category),
    generatedAt: Date.now(),
    meta: {
      businessName: access.business.name,
      legalName: access.business.legalName,
      currency: access.business.currency,
      fiscalYear: fiscalYear.name,
      branchName,
      from,
      to,
      rowCount: content.sections.reduce((sum, section) => sum + section.rows.length, 0),
      permissions: access.granted,
    },
    sections: content.sections,
    summary: content.summary,
    chart: content.chart,
    evidence: content.evidence,
    note: content.note,
  };
}

async function loadCashTransactions(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  to: number,
  branchId?: Id<"branches">,
) {
  const rows = await ctx.db
    .query("financialTransactions")
    .withIndex("by_business_occurred", (q) =>
      q.eq("businessId", businessId).gte("occurredAt", 0).lte("occurredAt", to),
    )
    .take(20_000);
  return branchId ? rows.filter((row) => row.branchId === branchId) : rows;
}

function balanceSheetReport(data: AccountingData): {
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
  note?: string;
} {
  const accounts = data.accounts.map(toAccountLike);
  const lines = data.entries.map((entry) => toLineLike(entry.line));
  const tb = trialBalance(accounts, [], lines, "ledger");
  const assets: ReportRow[] = [];
  const liabilities: ReportRow[] = [];
  const equity: ReportRow[] = [];
  let incomeExpenseNet = 0;
  for (const row of tb.rows) {
    if (row.type === "asset") {
      if (row.closingNet !== 0) {
        assets.push({ code: row.code, name: row.name, amount: row.closingNet });
      }
    } else if (row.type === "liability") {
      if (row.closingNet !== 0) {
        liabilities.push({ code: row.code, name: row.name, amount: -row.closingNet });
      }
    } else if (row.type === "equity") {
      if (row.closingNet !== 0) {
        equity.push({ code: row.code, name: row.name, amount: -row.closingNet });
      }
    } else if (row.type === "income" || row.type === "expense") {
      incomeExpenseNet += row.closingNet;
    }
  }
  const currentEarnings = -incomeExpenseNet;
  if (currentEarnings !== 0) {
    equity.push({
      code: "—",
      name: "سود (زیان) دوره جاری",
      amount: currentEarnings,
    });
  }
  const totalAssets = assets.reduce((sum, row) => sum + Number(row.amount), 0);
  const totalLiabilities = liabilities.reduce((sum, row) => sum + Number(row.amount), 0);
  const totalEquity = equity.reduce((sum, row) => sum + Number(row.amount), 0);
  const difference = totalAssets - totalLiabilities - totalEquity;
  const note =
    difference === 0
      ? undefined
      : `اختلاف کنترل ترازنامه ${difference.toLocaleString("fa-IR")} است. این اختلاف از داده واقعی محاسبه شده و باید با بررسی اسناد افتتاحیه/بستن و سندهای ناقص پیگیری شود.`;
  return {
    sections: [
      moneySection("assets", "دارایی‌ها", assets),
      moneySection("liabilities", "بدهی‌ها", liabilities),
      moneySection("equity", "سرمایه و حقوق صاحبان سهام", equity),
    ],
    summary: [
      { key: "assets", label: "جمع دارایی‌ها", value: totalAssets, kind: "money" },
      { key: "liabilities", label: "جمع بدهی‌ها", value: totalLiabilities, kind: "money" },
      { key: "equity", label: "جمع سرمایه", value: totalEquity, kind: "money" },
      { key: "earnings", label: "سود (زیان) دوره", value: currentEarnings, kind: "money" },
      { key: "difference", label: "اختلاف کنترل", value: difference, kind: "money" },
    ],
    chart: {
      title: "ترکیب ترازنامه",
      type: "bar",
      xKey: "label",
      series: [{ key: "amount", label: "مبلغ" }],
      data: [
        { label: "دارایی", amount: totalAssets },
        { label: "بدهی", amount: totalLiabilities },
        { label: "سرمایه", amount: totalEquity },
      ],
    },
    evidence: [
      {
        label: "اسناد قطعی",
        detail: `${data.entries.length} ردیف از اسناد قطعی/معکوس تا تاریخ گزارش استفاده شد.`,
        reportKey: "balance-sheet",
      },
    ],
    note,
  };
}

function trialBalanceReport(
  data: AccountingData,
  from: number,
  to: number,
): {
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  evidence: ReportEvidence[];
} {
  const accounts = data.accounts.map(toAccountLike);
  const opening = data.entries
    .filter((entry) => entry.document.documentDate < from)
    .map((entry) => toLineLike(entry.line));
  const period = data.entries
    .filter(
      (entry) =>
        entry.document.documentDate >= from && entry.document.documentDate <= to,
    )
    .map((entry) => toLineLike(entry.line));
  const tb = trialBalance(accounts, opening, period, "ledger");
  const rows: ReportRow[] = tb.rows.map((row) => ({
    code: row.code,
    name: row.name,
    opening: row.openingNet,
    debit: row.periodDebit,
    credit: row.periodCredit,
    debitBalance: row.debitBalance,
    creditBalance: row.creditBalance,
  }));
  const columns: ReportColumn[] = [
    { key: "code", label: "کد", kind: "text" },
    { key: "name", label: "حساب", kind: "text" },
    { key: "opening", label: "مانده اول دوره", kind: "money" },
    { key: "debit", label: "گردش بدهکار", kind: "money" },
    { key: "credit", label: "گردش بستانکار", kind: "money" },
    { key: "debitBalance", label: "مانده بدهکار", kind: "money" },
    { key: "creditBalance", label: "مانده بستانکار", kind: "money" },
  ];
  return {
    sections: [
      {
        key: "trial-balance",
        title: "تراز آزمایشی حساب‌های دفتر کل",
        columns,
        rows,
        totals: {
          opening: rows.reduce((sum, row) => sum + Number(row.opening), 0),
          debit: tb.totalDebit,
          credit: tb.totalCredit,
          debitBalance: tb.totalDebitBalance,
          creditBalance: tb.totalCreditBalance,
        },
        note: tb.balanced
          ? "گردش و مانده حساب‌ها متوازن است."
          : "عدم توازن در داده واقعی دیده می‌شود؛ برای پیگیری به اسناد ناقص مراجعه کنید.",
      },
    ],
    summary: [
      { key: "debit", label: "جمع گردش بدهکار", value: tb.totalDebit, kind: "money" },
      { key: "credit", label: "جمع گردش بستانکار", value: tb.totalCredit, kind: "money" },
      { key: "debit-balance", label: "جمع مانده بدهکار", value: tb.totalDebitBalance, kind: "money" },
      { key: "credit-balance", label: "جمع مانده بستانکار", value: tb.totalCreditBalance, kind: "money" },
      { key: "difference", label: "اختلاف کنترل", value: tb.closingDifference, kind: "money" },
      { key: "accounts", label: "تعداد حساب", value: rows.length, kind: "number" },
    ],
    evidence: [
      {
        label: "مانده و گردش واقعی",
        detail: `${data.entries.length} ردیف سند برای محاسبه استفاده شد.`,
        reportKey: "trial-balance",
      },
    ],
  };
}

function journalReport(
  data: AccountingData,
  from: number,
  to: number,
  search: string | undefined,
): {
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  evidence: ReportEvidence[];
} {
  const needle = normaliseSearch(search);
  const rows = data.entries
    .filter((entry) => {
      const date = entry.document.documentDate;
      if (date < from || date > to) return false;
      if (!needle) return true;
      const account = data.accountMap.get(entry.line.accountId as string);
      return [
        entry.document.number,
        entry.document.description,
        entry.line.description,
        account?.code,
        account?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("fa").includes(needle));
    })
    .sort(
      (a, b) =>
        a.document.documentDate - b.document.documentDate ||
        a.document.number.localeCompare(b.document.number) ||
        a.line.position - b.line.position,
    );
  const accountMap = data.accountMap;
  const rowsOut: ReportRow[] = rows.slice(0, 2000).map((entry) => {
    const account = accountMap.get(entry.line.accountId as string);
    return {
      date: entry.document.documentDate,
      number: entry.document.number,
      documentId: entry.document._id,
      description: entry.line.description,
      account: `${account?.code ?? "—"} — ${account?.name ?? "—"}`,
      debit: entry.line.debit,
      credit: entry.line.credit,
    };
  });
  const columns: ReportColumn[] = [
    { key: "date", label: "تاریخ", kind: "date" },
    { key: "number", label: "شماره سند", kind: "doc" },
    { key: "description", label: "شرح", kind: "text" },
    { key: "account", label: "حساب", kind: "text" },
    { key: "debit", label: "بدهکار", kind: "money" },
    { key: "credit", label: "بستانکار", kind: "money" },
  ];
  const totals = sumRows(rowsOut, ["debit", "credit"]);
  return {
    sections: [
      {
        key: "journal",
        title: "دفتر روزنامه",
        columns,
        rows: rowsOut,
        totals,
        note: rows.length > rowsOut.length ? "برای خوانایی و سقف خروجی، ۲۰۰۰ ردیف اول نمایش داده شده است." : undefined,
      },
    ],
    summary: [
      { key: "debit", label: "جمع بدهکار", value: Number(totals.debit ?? 0), kind: "money" },
      { key: "credit", label: "جمع بستانکار", value: Number(totals.credit ?? 0), kind: "money" },
      { key: "rows", label: "ردیف‌های نمایش‌داده‌شده", value: rowsOut.length, kind: "number" },
      { key: "all-rows", label: "کل ردیف‌های بازه", value: rows.length, kind: "number" },
    ],
    evidence: [
      {
        label: "اسناد قطعی",
        detail: `${new Set(rows.map((entry) => entry.document.number)).size} سند و ${rows.length} ردیف در بازه.`,
        reportKey: "journal",
      },
    ],
  };
}

async function documentReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  fiscalYearId: Id<"fiscalYears">,
  from: number,
  to: number,
  mode: "posted" | "draft" | "correction" | "opening-closing" | "register",
  branchId: Id<"branches"> | undefined,
  search: string | undefined,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  evidence: ReportEvidence[];
  note?: string;
}> {
  const documents = await ctx.db
    .query("accountingDocuments")
    .withIndex("by_business_fiscal_date", (q) =>
      q
        .eq("businessId", businessId)
        .eq("fiscalYearId", fiscalYearId)
        .gte("documentDate", from)
        .lte("documentDate", to),
    )
    .order("desc")
    .take(5000);
  const needle = normaliseSearch(search);
  const filtered = documents.filter((document) => {
    if (branchId && document.branchId !== branchId) return false;
    if (mode === "posted" && document.status !== "posted" && document.status !== "reversed") return false;
    if (mode === "draft" && document.status !== "draft" && document.status !== "pending") return false;
    if (
      mode === "correction" &&
      !document.reversalOfId &&
      !document.correctionOfId &&
      document.status !== "reversed"
    ) {
      return false;
    }
    if (mode === "opening-closing" && document.kind === "normal") return false;
    if (needle) {
      const haystack = [document.number, document.description, document.sourceType]
        .filter(Boolean)
        .map((value) => String(value).toLocaleLowerCase("fa"));
      if (!haystack.some((value) => value.includes(needle))) return false;
    }
    return true;
  });
  const rows: ReportRow[] = filtered.map((document) => ({
    number: document.number,
    documentId: document._id,
    date: document.documentDate,
    description: document.description,
    status: STATUS_LABELS[document.status] ?? document.status,
    kind: KIND_LABELS[document.kind] ?? document.kind,
    debit: document.totalDebit,
    credit: document.totalCredit,
    source: document.sourceType ?? "دستی",
  }));
  const columns: ReportColumn[] = [
    { key: "number", label: "شماره سند", kind: "doc" },
    { key: "date", label: "تاریخ", kind: "date" },
    { key: "description", label: "شرح", kind: "text" },
    { key: "status", label: "وضعیت", kind: "text" },
    { key: "kind", label: "نوع", kind: "text" },
    { key: "debit", label: "بدهکار", kind: "money" },
    { key: "credit", label: "بستانکار", kind: "money" },
    { key: "source", label: "منبع", kind: "text" },
  ];
  const totals = sumRows(rows, ["debit", "credit"]);
  const title =
    mode === "posted"
      ? "اسناد قطعی"
      : mode === "draft"
        ? "اسناد پیش‌نویس و در انتظار"
        : mode === "correction"
          ? "اسناد اصلاحی و معکوس"
          : mode === "opening-closing"
            ? "اسناد افتتاحیه و اختتامیه"
            : "دفتر ثبت اسناد";
  return {
    sections: [
      {
        key: "documents",
        title,
        columns,
        rows,
        totals,
        note:
          mode === "draft"
            ? "این اسناد هنوز در مانده گزارش‌های رسمی لحاظ نمی‌شوند."
            : undefined,
      },
    ],
    summary: [
      { key: "count", label: "تعداد سند", value: rows.length, kind: "number" },
      { key: "debit", label: "جمع بدهکار", value: Number(totals.debit ?? 0), kind: "money" },
      { key: "credit", label: "جمع بستانکار", value: Number(totals.credit ?? 0), kind: "money" },
    ],
    evidence: [
      {
        label: "دفتر اسناد حسابداری",
        detail: `${rows.length} سند از ${documents.length} سند بازه مطابق فیلتر انتخاب شد.`,
        reportKey: mode === "opening-closing" ? "documents-opening-closing" : `documents-${mode}`,
      },
    ],
  };
}

function cashFlowStatementReport(
  transactions: Doc<"financialTransactions">[],
  from: number,
  to: number,
): {
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
} {
  const opening = transactions
    .filter((row) => row.occurredAt < from)
    .reduce((sum, row) => sum + (row.direction === "in" ? row.amount : -row.amount), 0);
  const scoped = transactions.filter(
    (row) => row.occurredAt >= from && row.occurredAt <= to,
  );
  const groups = new Map<string, { label: string; inflow: number; outflow: number; count: number }>();
  for (const row of scoped) {
    const group = groups.get(row.operationType) ?? {
      label: OPERATION_LABELS[row.operationType] ?? row.operationType,
      inflow: 0,
      outflow: 0,
      count: 0,
    };
    if (row.direction === "in") group.inflow += row.amount;
    else group.outflow += row.amount;
    group.count += 1;
    groups.set(row.operationType, group);
  }
  const rows: ReportRow[] = [...groups.values()]
    .map((row) => ({
      label: row.label,
      inflow: row.inflow,
      outflow: row.outflow,
      net: row.inflow - row.outflow,
      count: row.count,
    }))
    .sort((a, b) => Math.abs(Number(b.net)) - Math.abs(Number(a.net)));
  const inflow = rows.reduce((sum, row) => sum + Number(row.inflow), 0);
  const outflow = rows.reduce((sum, row) => sum + Number(row.outflow), 0);
  const net = inflow - outflow;
  const closing = opening + net;
  const columns: ReportColumn[] = [
    { key: "label", label: "نوع عملیات", kind: "text" },
    { key: "count", label: "تعداد", kind: "number" },
    { key: "inflow", label: "ورودی وجه", kind: "money" },
    { key: "outflow", label: "خروجی وجه", kind: "money" },
    { key: "net", label: "جریان خالص", kind: "money" },
  ];
  return {
    sections: [
      {
        key: "cash-flow",
        title: "جریان وجوه نقد به تفکیک عملیات",
        columns,
        rows,
        totals: { inflow, outflow, net, count: scoped.length },
        note: "جریان‌ها از حرکات واقعی بانک و صندوق ساخته شده‌اند؛ انتقال داخلی به‌صورت دو طرفه نمایش داده می‌شود.",
      },
    ],
    summary: [
      { key: "opening", label: "مانده ابتدای دوره", value: opening, kind: "money" },
      { key: "inflow", label: "ورودی وجه", value: inflow, kind: "money" },
      { key: "outflow", label: "خروجی وجه", value: outflow, kind: "money" },
      { key: "net", label: "جریان خالص", value: net, kind: "money" },
      { key: "closing", label: "مانده پایان دوره", value: closing, kind: "money" },
    ],
    chart: {
      title: "ورود و خروج نقد",
      type: "bar",
      xKey: "label",
      series: [
        { key: "inflow", label: "ورودی" },
        { key: "outflow", label: "خروجی" },
      ],
      data: rows.slice(0, 10).map((row) => ({
        label: String(row.label),
        inflow: Number(row.inflow),
        outflow: Number(row.outflow),
      })),
    },
    evidence: [
      {
        label: "حرکات مالی",
        detail: `${scoped.length} حرکت بانکی/صندوق در بازه و ${transactions.length} حرکت تا پایان بازه بررسی شد.`,
        reportKey: "cash-flow-statement",
      },
    ],
  };
}

async function profitAnalysis(
  data: AccountingData,
  from: number,
  to: number,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const current = computeIncome(data, from, to);
  const span = to - from + 1;
  const previousFrom = from - span;
  const previousTo = from - 1;
  const previous = computeIncome(data, previousFrom, previousTo);
  const comparisonRows: ReportRow[] = [
    { metric: "فروش", current: current.totals.revenue, previous: previous.totals.revenue, change: growth(current.totals.revenue, previous.totals.revenue) },
    { metric: "بهای تمام‌شده", current: current.totals.cogs, previous: previous.totals.cogs, change: growth(current.totals.cogs, previous.totals.cogs) },
    { metric: "سود ناخالص", current: current.totals.grossProfit, previous: previous.totals.grossProfit, change: growth(current.totals.grossProfit, previous.totals.grossProfit) },
    { metric: "هزینه عملیاتی", current: current.totals.opex, previous: previous.totals.opex, change: growth(current.totals.opex, previous.totals.opex) },
    { metric: "سود خالص", current: current.totals.netProfit, previous: previous.totals.netProfit, change: growth(current.totals.netProfit, previous.totals.netProfit) },
    { metric: "حاشیه سود خالص", current: current.totals.margin, previous: previous.totals.margin, change: Math.round((current.totals.margin - previous.totals.margin) * 100) / 100 },
  ];
  const monthly = monthlyBuckets(from, to).map((bucket) => {
    const part = computeIncome(data, bucket.from, bucket.to);
    return {
      label: bucket.label,
      revenue: part.totals.revenue,
      net: part.totals.netProfit,
      margin: part.totals.margin,
    };
  });
  return {
    sections: [
      {
        key: "comparison",
        title: "مقایسه با دوره مشابه قبل",
        columns: [
          { key: "metric", label: "شاخص", kind: "text" },
          { key: "current", label: "دوره جاری", kind: "money" },
          { key: "previous", label: "دوره قبل", kind: "money" },
          { key: "change", label: "تغییر ٪", kind: "percent" },
        ],
        rows: comparisonRows,
        totals: {}, 
        note: `دوره مقایسه: ${jalaliDateLabel(previousFrom)} تا ${jalaliDateLabel(previousTo)}`,
      },
      ...incomeSections(current),
    ],
    summary: incomeSummary(current),
    chart: {
      title: "روند ماهانه فروش و سود خالص",
      type: "line",
      xKey: "label",
      series: [
        { key: "revenue", label: "فروش" },
        { key: "net", label: "سود خالص" },
      ],
      data: monthly,
    },
    evidence: [
      {
        label: "اسناد سود و زیان",
        detail: `${current.documentCount} سند و ${current.lineCount} ردیف در دوره جاری؛ دوره قبل ${previous.documentCount} سند.`,
        reportKey: "profit-analysis",
      },
    ],
  };
}

async function cashFlowForecastReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  to: number,
  horizonDays: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
  note: string;
}> {
  const asOf = to;
  const horizonEnd = asOf + horizonDays * DAY;
  const [transactions, invoices, purchases, receivedChecks, issuedChecks, installments, taxPeriods, taxRecords, payrollPeriods, branches] = await Promise.all([
    loadCashTransactions(ctx, businessId, asOf, branchId),
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(5000),
    ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(5000),
    ctx.db.query("receivedChecks").withIndex("by_business_due", (q) => q.eq("businessId", businessId).gte("dueDate", 0).lte("dueDate", horizonEnd)).take(3000),
    ctx.db.query("issuedChecks").withIndex("by_business_due", (q) => q.eq("businessId", businessId).gte("dueDate", 0).lte("dueDate", horizonEnd)).take(3000),
    ctx.db.query("loanInstallments").withIndex("by_business_status_due", (q) => q.eq("businessId", businessId).eq("status", "pending").lte("dueDate", horizonEnd)).take(3000),
    ctx.db.query("taxPeriods").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(500),
    ctx.db.query("taxRecords").withIndex("by_business_period", (q) => q.eq("businessId", businessId)).take(3000),
    ctx.db.query("payrollPeriods").withIndex("by_business_status", (q) => q.eq("businessId", businessId).eq("status", "approved")).take(500),
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(200),
  ]);
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const cash = transactions.reduce((sum, row) => sum + (row.direction === "in" ? row.amount : -row.amount), 0);
  const rows: ReportRow[] = [];
  let overdueReceivables = 0;
  let overduePayables = 0;
  for (const invoice of invoices) {
    if (branchId && invoice.branchId !== branchId) continue;
    if (invoice.status === "draft" || invoice.status === "void") continue;
    const outstanding = outstandingInvoice(invoice);
    if (outstanding <= 0) continue;
    const due = invoice.dueDate ?? invoice.issueDate;
    if (due < asOf) {
      overdueReceivables += outstanding;
      continue;
    }
    if (due > horizonEnd) continue;
    rows.push({
      due,
      direction: "in",
      title: `دریافت فاکتور ${invoice.number}`,
      source: "فروش",
      amount: outstanding,
      certainty: "سررسید ثبت‌شده",
      branch: branchMap.get((invoice.branchId as string) ?? "")?.name ?? "—",
    });
  }
  for (const purchase of purchases) {
    if (branchId && purchase.branchId !== branchId) continue;
    if (purchase.status === "draft" || purchase.status === "cancelled" || purchase.kind === "return") continue;
    const outstanding = outstandingPurchase(purchase);
    if (outstanding <= 0) continue;
    const due = purchase.dueDate ?? purchase.issueDate;
    if (due < asOf) {
      overduePayables += outstanding;
      continue;
    }
    if (due > horizonEnd) continue;
    rows.push({
      due,
      direction: "out",
      title: `پرداخت فاکتور ${purchase.number}`,
      source: "خرید",
      amount: outstanding,
      certainty: "سررسید ثبت‌شده",
      branch: branchMap.get(purchase.branchId as string)?.name ?? "—",
    });
  }
  for (const check of receivedChecks) {
    if (branchId && check.branchId !== branchId) continue;
    if (!["received", "pending", "assigned"].includes(check.status)) continue;
    if (check.dueDate < asOf) {
      overdueReceivables += check.amount;
      continue;
    }
    rows.push({ due: check.dueDate, direction: "in", title: `وصول چک ${check.checkNumber}`, source: "چک دریافتی", amount: check.amount, certainty: "سررسید ثبت‌شده", branch: branchMap.get(check.branchId as string)?.name ?? "—" });
  }
  for (const check of issuedChecks) {
    if (branchId && check.branchId !== branchId) continue;
    if (!["issued", "delivered"].includes(check.status)) continue;
    if (check.dueDate < asOf) {
      overduePayables += check.amount;
      continue;
    }
    rows.push({ due: check.dueDate, direction: "out", title: `پرداخت چک ${check.checkNumber}`, source: "چک پرداختی", amount: check.amount, certainty: "سررسید ثبت‌شده", branch: branchMap.get(check.branchId as string)?.name ?? "—" });
  }
  for (const installment of installments) {
    if (installment.dueDate < asOf) continue;
    rows.push({ due: installment.dueDate, direction: "out", title: `قسط وام شماره ${installment.number}`, source: "قسط وام", amount: installment.amount, certainty: "سررسید ثبت‌شده", branch: "—" });
  }
  const taxByPeriod = new Map<string, number>();
  for (const record of taxRecords) {
    const key = record.periodId as string;
    taxByPeriod.set(key, (taxByPeriod.get(key) ?? 0) + record.taxAmount);
  }
  for (const period of taxPeriods) {
    if (period.status !== "open" && period.status !== "filed") continue;
    const amount = taxByPeriod.get(period._id as string) ?? 0;
    if (amount <= 0) continue;
    if (period.dueDate < asOf) {
      overduePayables += amount;
      continue;
    }
    if (period.dueDate > horizonEnd) continue;
    rows.push({ due: period.dueDate, direction: "out", title: `مالیات ${period.title}`, source: "مالیات", amount, certainty: "سررسید ثبت‌شده", branch: "—" });
  }
  for (const period of payrollPeriods) {
    if (branchId) continue;
    if (period.endAt < asOf || period.endAt > horizonEnd) continue;
    if (period.netTotal <= 0) continue;
    rows.push({ due: period.endAt, direction: "out", title: `حقوق ${period.title}`, source: "حقوق و دستمزد", amount: period.netTotal, certainty: "دوره تأییدشده", branch: "—" });
  }
  rows.sort((a, b) => Number(a.due) - Number(b.due));
  const expectedIn = rows.filter((row) => row.direction === "in").reduce((sum, row) => sum + Number(row.amount), 0);
  const expectedOut = rows.filter((row) => row.direction === "out").reduce((sum, row) => sum + Number(row.amount), 0);
  const columns: ReportColumn[] = [
    { key: "due", label: "سررسید", kind: "date" },
    { key: "title", label: "شرح", kind: "text" },
    { key: "source", label: "منبع", kind: "text" },
    { key: "direction", label: "جهت", kind: "text" },
    { key: "amount", label: "مبلغ", kind: "money" },
    { key: "certainty", label: "مبنای پیش‌بینی", kind: "text" },
  ];
  const displayRows = rows.map((row) => ({ ...row, direction: row.direction === "in" ? "ورود" : "خروج" }));
  const buckets = [
    { label: "تا ۷ روز", end: asOf + 7 * DAY },
    { label: "۸ تا ۱۴ روز", end: asOf + 14 * DAY },
    { label: "۱۵ تا ۳۰ روز", end: asOf + 30 * DAY },
    { label: "۳۱ روز تا پایان افق", end: horizonEnd },
  ];
  return {
    sections: [
      {
        key: "forecast",
        title: "سررسیدهای ثبت‌شده در افق پیش‌بینی",
        columns,
        rows: displayRows,
        totals: { amount: expectedIn + expectedOut },
      },
    ],
    summary: [
      { key: "cash", label: "نقد و بانک فعلی", value: cash, kind: "money" },
      { key: "in", label: "ورودی مورد انتظار", value: expectedIn, kind: "money" },
      { key: "out", label: "خروجی مورد انتظار", value: expectedOut, kind: "money" },
      { key: "projected", label: "مانده پیش‌بینی‌شده", value: cash + expectedIn - expectedOut, kind: "money" },
      { key: "overdue-ar", label: "مطالبات معوق (خارج از پیش‌بینی)", value: overdueReceivables, kind: "money" },
      { key: "overdue-ap", label: "بدهی معوق (خارج از پیش‌بینی)", value: overduePayables, kind: "money" },
    ],
    chart: {
      title: "زمان‌بندی جریان نقد مورد انتظار",
      type: "bar",
      xKey: "label",
      series: [
        { key: "inflow", label: "ورودی" },
        { key: "outflow", label: "خروجی" },
      ],
      data: buckets.map((bucket, index) => {
        const previous = index === 0 ? asOf : buckets[index - 1].end;
        const scoped = rows.filter((row) => Number(row.due) > previous && Number(row.due) <= bucket.end);
        return {
          label: bucket.label,
          inflow: scoped.filter((row) => row.direction === "in").reduce((sum, row) => sum + Number(row.amount), 0),
          outflow: scoped.filter((row) => row.direction === "out").reduce((sum, row) => sum + Number(row.amount), 0),
        };
      }),
    },
    evidence: [
      { label: "سررسیدهای واقعی", detail: `${invoices.length} فاکتور، ${purchases.length} فاکتور خرید، ${receivedChecks.length + issuedChecks.length} چک و ${installments.length} قسط بررسی شد.`, reportKey: "cash-flow-forecast" },
    ],
    note: `پیش‌بینی فقط از سررسیدهای ثبت‌شده در ${horizonDays} روز آینده ساخته شده است. مبالغ معوق در پیش‌بینی لحاظ نشده و جدا نشان داده می‌شوند. این عدد قطعی نیست و به وصول/پرداخت واقعی در تاریخ سررسید وابسته است.`,
  };
}

async function bankOrCashReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  type: "bank" | "cash",
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [bankAccounts, cashFunds, branches, transactions] = await Promise.all([
    ctx.db.query("bankAccounts").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(500),
    ctx.db.query("cashFunds").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(500),
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(200),
    loadCashTransactions(ctx, businessId, to, branchId),
  ]);
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const accounts = type === "bank" ? bankAccounts : cashFunds;
  const rows: ReportRow[] = accounts.map((account) => {
    const id = account._id as string;
    const accountTxs = transactions.filter((row) =>
      type === "bank"
        ? row.accountType === "bank" && row.bankAccountId === account._id
        : row.accountType === "cash" && row.cashFundId === account._id,
    );
    const opening = accountTxs
      .filter((row) => row.occurredAt < from)
      .reduce((sum, row) => sum + (row.direction === "in" ? row.amount : -row.amount), 0);
    const period = accountTxs.filter(
      (row) => row.occurredAt >= from && row.occurredAt <= to,
    );
    const inflow = period
      .filter((row) => row.direction === "in")
      .reduce((sum, row) => sum + row.amount, 0);
    const outflow = period
      .filter((row) => row.direction === "out")
      .reduce((sum, row) => sum + row.amount, 0);
    return {
      name: account.name,
      branch: branchMap.get((account.branchId as string) ?? "")?.name ?? "—",
      opening,
      inflow,
      outflow,
      balance: opening + inflow - outflow,
    };
  });
  const columns: ReportColumn[] = [
    { key: "name", label: type === "bank" ? "حساب بانکی" : "صندوق", kind: "text" },
    { key: "branch", label: "شعبه", kind: "text" },
    { key: "opening", label: "مانده ابتدا", kind: "money" },
    { key: "inflow", label: "ورودی", kind: "money" },
    { key: "outflow", label: "خروجی", kind: "money" },
    { key: "balance", label: "مانده پایان", kind: "money" },
  ];
  const totals = sumRows(rows, ["opening", "inflow", "outflow", "balance"]);
  return {
    sections: [
      {
        key: type,
        title: type === "bank" ? "گردش و مانده حساب‌های بانکی" : "گردش و مانده صندوق‌ها",
        columns,
        rows,
        totals,
        note: "شماره حساب کامل به‌صورت عمدی در گزارش نمایش داده نمی‌شود؛ مانده از حرکات ثبت‌شده محاسبه شده است.",
      },
    ],
    summary: [
      { key: "balance", label: type === "bank" ? "مانده بانک" : "مانده صندوق", value: Number(totals.balance ?? 0), kind: "money" },
      { key: "inflow", label: "ورودی بازه", value: Number(totals.inflow ?? 0), kind: "money" },
      { key: "outflow", label: "خروجی بازه", value: Number(totals.outflow ?? 0), kind: "money" },
      { key: "accounts", label: "تعداد حساب", value: rows.length, kind: "number" },
    ],
    chart: {
      title: type === "bank" ? "مانده حساب‌های بانکی" : "مانده صندوق‌ها",
      type: "bar",
      xKey: "label",
      series: [{ key: "balance", label: "مانده" }],
      data: rows.map((row) => ({ label: String(row.name), balance: Number(row.balance) })),
    },
    evidence: [
      {
        label: "حرکات مالی",
        detail: `${transactions.length} حرکت مالی برای محاسبه مانده و گردش استفاده شد.`,
        reportKey: type === "bank" ? "bank-summary" : "cash-summary",
      },
    ],
  };
}

interface InventoryItem {
  productId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  value: number;
  minQuantity: number;
  expiryDate?: number;
  categoryId?: string;
  lastOut?: number;
  lastMovement?: number;
}

async function inventorySnapshot(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  to: number,
  branchId?: Id<"branches">,
) {
  const [transactions, products, categories] = await Promise.all([
    ctx.db.query("inventoryTransactions").withIndex("by_business_occurred", (q) => q.eq("businessId", businessId)).take(25_000),
    ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(4000),
    ctx.db.query("productCategories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000),
  ]);
  const categoryMap = new Map(categories.map((row) => [row._id as string, row]));
  const items = new Map<string, InventoryItem>();
  for (const product of products) {
    items.set(product._id as string, {
      productId: product._id as string,
      code: product.code,
      name: product.name,
      unit: product.unit,
      quantity: 0,
      value: 0,
      minQuantity: product.minStockMilli,
      expiryDate: product.expiryDate,
      categoryId: product.categoryId as string | undefined,
    });
  }
  for (const tx of transactions) {
    if (tx.occurredAt > to) continue;
    if (branchId && tx.branchId !== branchId) continue;
    const item = items.get(tx.productId as string);
    if (!item) continue;
    const delta = tx.direction === "in" ? 1 : -1;
    item.quantity += delta * tx.quantityMilli;
    item.value += delta * tx.value;
    item.lastMovement = Math.max(item.lastMovement ?? 0, tx.occurredAt);
    if (tx.direction === "out") item.lastOut = Math.max(item.lastOut ?? 0, tx.occurredAt);
    if (tx.expiryDate) item.expiryDate = tx.expiryDate;
  }
  const rows = [...items.values()];
  return {
    rows,
    categoryMap,
    totalValue: rows.reduce((sum, row) => sum + Math.max(0, row.value), 0),
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    lowCount: rows.filter((row) => row.quantity > 0 && row.quantity <= row.minQuantity).length,
  };
}

async function branchComparisonReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  fiscalYear: Doc<"fiscalYears">,
  data: AccountingData,
  from: number,
  to: number,
  branchId?: Id<"branches">,
  mode: "comparison" | "profit" = "comparison",
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [branches, invoices, purchases, transactions, warehouses] = await Promise.all([
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(200),
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("inventoryTransactions").withIndex("by_business_occurred", (q) => q.eq("businessId", businessId)).take(25_000),
    ctx.db.query("warehouses").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(500),
  ]);
  const primary = branches.find((row) => row.isPrimary) ?? branches[0];
  const warehouseMap = new Map(warehouses.map((row) => [row._id as string, row]));
  const selected = branchId ? branches.filter((row) => row._id === branchId) : branches;
  const rows: ReportRow[] = selected.map((branch) => {
    const branchInvoices = scopedInvoices(invoices, from, to, branch._id).filter(
      (row) => (row.branchId ?? primary?._id) === branch._id,
    );
    const branchPurchases = purchases.filter(
      (row) =>
        row.branchId === branch._id &&
        row.issueDate >= from &&
        row.issueDate <= to &&
        row.status !== "draft" &&
        row.status !== "cancelled",
    );
    const part = computeIncome(
      { ...data, entries: data.entries.filter((entry) => entry.document.branchId === branch._id) },
      from,
      to,
    );
    const branchTransactions = transactions.filter(
      (row) => row.branchId === branch._id && row.occurredAt <= to,
    );
    const inventoryValue = branchTransactions.reduce((sum, row) => {
      const warehouse = warehouseMap.get(row.warehouseId as string);
      if (!warehouse || warehouse.branchId !== branch._id) return sum;
      return sum + (row.direction === "in" ? row.value : -row.value);
    }, 0);
    const receivables = invoices
      .filter((row) => (row.branchId ?? primary?._id) === branch._id && row.issueDate <= to && row.status !== "draft" && row.status !== "void")
      .reduce((sum, row) => sum + outstandingInvoice(row), 0);
    const payables = purchases
      .filter((row) => row.branchId === branch._id && row.issueDate <= to && row.status !== "draft" && row.status !== "cancelled" && row.kind === "purchase")
      .reduce((sum, row) => sum + outstandingPurchase(row), 0);
    return {
      name: branch.name,
      code: branch.code,
      sales: branchInvoices.reduce((sum, row) => sum + row.total, 0),
      purchases: branchPurchases.filter((row) => row.kind === "purchase").reduce((sum, row) => sum + row.total, 0),
      revenue: part.totals.revenue,
      expenses: part.totals.cogs + part.totals.opex + part.totals.otherExpenses,
      profit: part.totals.netProfit,
      inventory: Math.max(0, inventoryValue),
      receivables,
      payables,
    };
  });
  const columns: ReportColumn[] = mode === "profit"
    ? [
        { key: "name", label: "شعبه", kind: "text" },
        { key: "revenue", label: "درآمد", kind: "money" },
        { key: "expenses", label: "هزینه", kind: "money" },
        { key: "profit", label: "سود", kind: "money" },
      ]
    : [
        { key: "name", label: "شعبه", kind: "text" },
        { key: "sales", label: "فروش", kind: "money" },
        { key: "purchases", label: "خرید", kind: "money" },
        { key: "revenue", label: "درآمد حسابداری", kind: "money" },
        { key: "expenses", label: "هزینه", kind: "money" },
        { key: "profit", label: "سود", kind: "money" },
        { key: "inventory", label: "موجودی انبار", kind: "money" },
        { key: "receivables", label: "مطالبات", kind: "money" },
        { key: "payables", label: "بدهی", kind: "money" },
      ];
  const numeric = columns.filter((column) => column.kind === "money").map((column) => column.key);
  const totals = sumRows(rows, numeric);
  return {
    sections: [{
      key: "branches",
      title: mode === "profit" ? "سود و زیان شعب" : "مقایسه عملکرد شعب",
      columns,
      rows: sortRows(rows, "sales"),
      totals,
    }],
    summary: [
      { key: "sales", label: "فروش شعب", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "profit", label: "سود شعب", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "inventory", label: "موجودی انبار", value: Number(totals.inventory ?? 0), kind: "money" },
      { key: "receivables", label: "مطالبات", value: Number(totals.receivables ?? 0), kind: "money" },
      { key: "payables", label: "بدهی", value: Number(totals.payables ?? 0), kind: "money" },
      { key: "branches", label: "تعداد شعبه", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "مقایسه فروش و سود شعب",
      type: "bar",
      xKey: "label",
      series: [
        { key: "sales", label: "فروش" },
        { key: "profit", label: "سود" },
      ],
      data: rows.map((row) => ({ label: String(row.name), sales: Number(row.sales), profit: Number(row.profit) })),
    },
    evidence: [
      { label: "داده شعب", detail: `${branches.length} شعبه، ${invoices.length} فاکتور و ${transactions.length} گردش انبار بررسی شد.`, reportKey: mode === "profit" ? "branch-profit" : "branch-comparison" },
    ],
  };
}

function receivableBalance(invoices: Doc<"invoices">[], asOf: number, branchId?: Id<"branches">) {
  return invoices
    .filter((row) => row.issueDate <= asOf && row.status !== "draft" && row.status !== "void" && (!branchId || row.branchId === branchId))
    .reduce((sum, row) => sum + outstandingInvoice(row), 0);
}

function payableBalance(purchases: Doc<"purchaseInvoices">[], asOf: number, branchId?: Id<"branches">) {
  return purchases
    .filter((row) => row.issueDate <= asOf && row.kind === "purchase" && row.status !== "draft" && row.status !== "cancelled" && (!branchId || row.branchId === branchId))
    .reduce((sum, row) => sum + outstandingPurchase(row), 0);
}

function cashBalance(transactions: Doc<"financialTransactions">[]) {
  return transactions.reduce((sum, row) => sum + (row.direction === "in" ? row.amount : -row.amount), 0);
}

async function financialAlertsReport(
  ctx: QueryCtx,
  userId: Id<"users">,
  businessId: Id<"businesses">,
  data: AccountingData,
  fiscalYear: Doc<"fiscalYears">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  evidence: ReportEvidence[];
  note: string;
}> {
  const span = to - from + 1;
  const current = computeIncome(data, from, to);
  const previous = computeIncome(data, from - span, from - 1);
  const [invoices, purchases, transactions, snapshot, dismissals] = await Promise.all([
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(6000),
    loadCashTransactions(ctx, businessId, to, branchId),
    inventorySnapshot(ctx, businessId, to, branchId),
    ctx.db.query("financialAlerts").withIndex("by_business_user", (q) => q.eq("businessId", businessId).eq("userId", userId)).take(500),
  ]);
  const dismissed = new Set(dismissals.map((row) => row.alertKey));
  const ar = receivableBalance(invoices, to, branchId);
  const arPrevious = receivableBalance(invoices, from - 1, branchId);
  const ap = payableBalance(purchases, to, branchId);
  const apPrevious = payableBalance(purchases, from - 1, branchId);
  const cash = cashBalance(transactions);
  const cashPrevious = cashBalance(transactions.filter((row) => row.occurredAt <= from - 1));
  const alerts: ReportRow[] = [];
  const add = (input: {
    key: string;
    severity: "info" | "warning" | "critical";
    category: string;
    title: string;
    reason: string;
    evidence: string;
    suggestion: string;
    metric: string;
    observed: number;
    threshold: string;
  }) => {
    if (dismissed.has(input.key)) return;
    alerts.push({
      ...input,
      period: `${jalaliDateLabel(from)} تا ${jalaliDateLabel(to)}`,
      severityLabel: input.severity === "critical" ? "بحرانی" : input.severity === "warning" ? "هشدار" : "اطلاع",
    });
  };
  const expenseChange = growth(current.totals.cogs + current.totals.opex + current.totals.otherExpenses, previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses);
  if (expenseChange >= 20 && previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses > 0) {
    add({
      key: `expense-growth-${fiscalYear._id}-${from}-${to}`,
      severity: expenseChange >= 40 ? "critical" : "warning",
      category: "هزینه",
      title: "افزایش غیرعادی هزینه",
      reason: `جمع هزینه‌های دوره ${expenseChange.toLocaleString("fa-IR")}٪ نسبت به دوره مشابه قبل افزایش یافته است.`,
      evidence: `هزینه دوره جاری ${(current.totals.cogs + current.totals.opex + current.totals.otherExpenses).toLocaleString("fa-IR")} و دوره قبل ${(previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses).toLocaleString("fa-IR")} است.`,
      suggestion: "گزارش هزینه‌های عملیاتی و سایر هزینه‌ها را باز کنید و بزرگ‌ترین حساب‌های افزایش‌یافته را با اسناد پشتیبان بررسی کنید.",
      metric: "expense",
      observed: expenseChange,
      threshold: "افزایش ۲۰٪ یا بیشتر",
    });
  }
  const salesChange = growth(current.totals.revenue, previous.totals.revenue);
  if (salesChange <= -15 && previous.totals.revenue > 0) {
    add({
      key: `sales-drop-${fiscalYear._id}-${from}-${to}`,
      severity: salesChange <= -30 ? "critical" : "warning",
      category: "فروش",
      title: "کاهش فروش",
      reason: `فروش دوره ${Math.abs(salesChange).toLocaleString("fa-IR")}٪ نسبت به دوره قبل کاهش یافته است.`,
      evidence: `فروش دوره جاری ${current.totals.revenue.toLocaleString("fa-IR")} و دوره قبل ${previous.totals.revenue.toLocaleString("fa-IR")} است.`,
      suggestion: "گزارش فروش به تفکیک مشتری و کالا را بررسی کنید و علت کاهش را با فاکتورهای واقعی تطبیق دهید.",
      metric: "sales",
      observed: salesChange,
      threshold: "کاهش ۱۵٪ یا بیشتر",
    });
  }
  const arChange = growth(ar, arPrevious);
  if (arChange >= 25 && arPrevious > 0) {
    add({
      key: `ar-growth-${fiscalYear._id}-${from}-${to}`,
      severity: arChange >= 50 ? "critical" : "warning",
      category: "مطالبات",
      title: "افزایش مطالبات",
      reason: `مانده مطالبات ${arChange.toLocaleString("fa-IR")}٪ رشد کرده است.`,
      evidence: `مانده مطالبات پایان دوره ${ar.toLocaleString("fa-IR")} و پایان دوره قبل ${arPrevious.toLocaleString("fa-IR")} است.`,
      suggestion: "گزارش سالخوردگی مطالبات را باز کنید و فاکتورهای معوق را برای پیگیری وصول علامت‌گذاری کنید.",
      metric: "receivables",
      observed: arChange,
      threshold: "رشد ۲۵٪ یا بیشتر",
    });
  }
  const apChange = growth(ap, apPrevious);
  if (apChange >= 25 && apPrevious > 0) {
    add({
      key: `ap-growth-${fiscalYear._id}-${from}-${to}`,
      severity: apChange >= 50 ? "critical" : "warning",
      category: "بدهی",
      title: "افزایش بدهی",
      reason: `بدهی تأمین‌کنندگان ${apChange.toLocaleString("fa-IR")}٪ رشد کرده است.`,
      evidence: `بدهی پایان دوره ${ap.toLocaleString("fa-IR")} و پایان دوره قبل ${apPrevious.toLocaleString("fa-IR")} است.`,
      suggestion: "گزارش سررسید پرداخت تأمین‌کنندگان را بررسی و برای پرداخت‌های نزدیک سررسید برنامه‌ریزی کنید.",
      metric: "payables",
      observed: apChange,
      threshold: "رشد ۲۵٪ یا بیشتر",
    });
  }
  if (snapshot.lowCount > 0) {
    add({
      key: `low-stock-${fiscalYear._id}-${from}-${to}`,
      severity: "warning",
      category: "انبار",
      title: "کالاهای زیر حداقل موجودی",
      reason: `${snapshot.lowCount.toLocaleString("fa-IR")} کالای دارای موجودی در سطح یا زیر حداقل تعیین‌شده است.`,
      evidence: `این تعداد از ${snapshot.rows.length.toLocaleString("fa-IR")} کالای ثبت‌شده در انبار محاسبه شده است.`,
      suggestion: "گزارش کالاهای کم‌موجودی را باز کنید و سفارش خرید یا انتقال بین انبارها را بررسی کنید.",
      metric: "low-stock",
      observed: snapshot.lowCount,
      threshold: "هر کالای زیر حداقل موجودی",
    });
  }
  const cashChange = growth(cash, cashPrevious);
  if (cash < cashPrevious && cashChange <= -20 && cashPrevious > 0) {
    add({
      key: `cash-drop-${fiscalYear._id}-${from}-${to}`,
      severity: cash < 0 ? "critical" : "warning",
      category: "نقدینگی",
      title: "کاهش نقدینگی",
      reason: `مانده نقد و بانک ${Math.abs(cashChange).toLocaleString("fa-IR")}٪ کاهش یافته است.`,
      evidence: `مانده فعلی ${cash.toLocaleString("fa-IR")} و مانده پیش از دوره ${cashPrevious.toLocaleString("fa-IR")} است.`,
      suggestion: "گزارش تحلیل و پیش‌بینی نقدینگی را باز کنید و سررسیدهای خروجی نزدیک را با ورودی‌های مورد انتظار مقایسه کنید.",
      metric: "cash",
      observed: cashChange,
      threshold: "کاهش ۲۰٪ یا بیشتر",
    });
  }
  const marginChange = current.totals.margin - previous.totals.margin;
  if (Math.abs(marginChange) >= 5 && previous.totals.revenue > 0) {
    add({
      key: `margin-change-${fiscalYear._id}-${from}-${to}`,
      severity: Math.abs(marginChange) >= 10 ? "critical" : "warning",
      category: "سودآوری",
      title: "تغییر غیرمعمول حاشیه سود",
      reason: `حاشیه سود خالص ${Math.abs(marginChange).toLocaleString("fa-IR")} واحد درصد تغییر کرده است.`,
      evidence: `حاشیه سود دوره جاری ${current.totals.margin.toLocaleString("fa-IR")}٪ و دوره قبل ${previous.totals.margin.toLocaleString("fa-IR")}٪ است.`,
      suggestion: "صورت سود و زیان و گزارش حاشیه سود فروش را بررسی کنید تا تغییر بهای تمام‌شده یا هزینه‌ها مشخص شود.",
      metric: "margin",
      observed: marginChange,
      threshold: "تغییر ۵ واحد درصد یا بیشتر",
    });
  }
  const columns: ReportColumn[] = [
    { key: "severityLabel", label: "شدت", kind: "text" },
    { key: "title", label: "هشدار", kind: "text" },
    { key: "reason", label: "دلیل", kind: "text" },
    { key: "evidence", label: "داده پشتیبان", kind: "text" },
    { key: "period", label: "بازه", kind: "text" },
    { key: "suggestion", label: "پیشنهاد بررسی", kind: "text" },
  ];
  const critical = alerts.filter((row) => row.severity === "critical").length;
  return {
    sections: [{ key: "alerts", title: "هشدارهای تحلیلی فعال", columns, rows: alerts, totals: {} }],
    summary: [
      { key: "alerts", label: "هشدار فعال", value: alerts.length, kind: "number" },
      { key: "critical", label: "هشدار بحرانی", value: critical, kind: "number" },
      { key: "expense-change", label: "تغییر هزینه", value: expenseChange, kind: "percent" },
      { key: "sales-change", label: "تغییر فروش", value: salesChange, kind: "percent" },
      { key: "ar", label: "مطالبات", value: ar, kind: "money" },
      { key: "ap", label: "بدهی", value: ap, kind: "money" },
    ],
    evidence: [
      { label: "مقایسه دوره‌ای", detail: `دوره جاری با ${jalaliDateLabel(from - span)} تا ${jalaliDateLabel(from - 1)} مقایسه شد.`, reportKey: "financial-alerts" },
    ],
    note: alerts.length === 0
      ? "هیچ شاخصی از آستانه‌های تعریف‌شده عبور نکرده است. هشدار فقط از داده واقعی و آستانه‌های شفاف ساخته می‌شود."
      : "هر هشدار از داده واقعی همین کسب‌وکار و مقایسه با دوره مشابه قبل ساخته شده است. شدت هشدار با آستانه‌های نوشته‌شده تعیین می‌شود.",
  };
}

async function payrollReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [periods, records] = await Promise.all([
    ctx.db.query("payrollPeriods").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(500),
    branchId
      ? ctx.db.query("payrollRecords").withIndex("by_business_branch", (q) => q.eq("businessId", businessId).eq("branchId", branchId)).take(10_000)
      : Promise.resolve([] as Doc<"payrollRecords">[]),
  ]);
  const scoped = periods.filter(
    (period) => period.startAt <= to && period.endAt >= from && period.status !== "draft",
  );
  const byPeriod = new Map<string, { gross: number; insurance: number; tax: number; net: number; employer: number; employees: number }>();
  for (const record of records) {
    const key = record.periodId as string;
    const row = byPeriod.get(key) ?? { gross: 0, insurance: 0, tax: 0, net: 0, employer: 0, employees: 0 };
    row.gross += record.gross;
    row.insurance += record.insuranceEmployee;
    row.tax += record.tax;
    row.net += record.net;
    row.employer += record.employerInsurance;
    row.employees += 1;
    byPeriod.set(key, row);
  }
  const rows: ReportRow[] = scoped.map((period) => {
    const branchFigures = byPeriod.get(period._id as string);
    return {
      title: period.title,
      periodId: period._id,
      from: period.startAt,
      to: period.endAt,
      status: STATUS_LABELS[period.status] ?? period.status,
      employees: branchFigures?.employees ?? period.employeeCount,
      gross: branchFigures?.gross ?? period.grossTotal,
      insurance: branchFigures?.insurance ?? period.employeeInsuranceTotal,
      tax: branchFigures?.tax ?? period.taxTotal,
      net: branchFigures?.net ?? period.netTotal,
      employer: branchFigures?.employer ?? period.employerInsuranceTotal,
      documentId: period.accountingDocumentId,
    };
  }).filter((row) => !branchId || Number(row.employees) > 0);
  const columns: ReportColumn[] = [
    { key: "title", label: "دوره", kind: "text" },
    { key: "status", label: "وضعیت", kind: "text" },
    { key: "employees", label: "نفرات", kind: "number" },
    { key: "gross", label: "جمع حقوق", kind: "money" },
    { key: "insurance", label: "بیمه کارمند", kind: "money" },
    { key: "tax", label: "مالیات", kind: "money" },
    { key: "employer", label: "بیمه کارفرما", kind: "money" },
    { key: "net", label: "پرداخت خالص", kind: "money" },
  ];
  const totals = sumRows(rows, ["employees", "gross", "insurance", "tax", "employer", "net"]);
  return {
    sections: [{ key: "payroll", title: "دوره‌های حقوق و دستمزد", columns, rows, totals, note: "فقط دوره‌های محاسبه‌شده، تأییدشده یا پرداخت‌شده نمایش داده می‌شوند." }],
    summary: [
      { key: "gross", label: "جمع حقوق و مزایا", value: Number(totals.gross ?? 0), kind: "money" },
      { key: "net", label: "خالص پرداختی", value: Number(totals.net ?? 0), kind: "money" },
      { key: "insurance", label: "بیمه سهم کارمند", value: Number(totals.insurance ?? 0), kind: "money" },
      { key: "tax", label: "مالیات حقوق", value: Number(totals.tax ?? 0), kind: "money" },
      { key: "periods", label: "دوره‌ها", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "خالص پرداختی دوره‌ها",
      type: "bar",
      xKey: "label",
      series: [{ key: "net", label: "خالص" }],
      data: rows.map((row) => ({ label: String(row.title), net: Number(row.net) })),
    },
    evidence: [{ label: "دوره‌های حقوق", detail: `${periods.length} دوره و ${records.length} رکورد پرسنلی برای این گزارش بررسی شد.`, reportKey: "payroll-summary" }],
  };
}

async function taxReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [periods, records] = await Promise.all([
    ctx.db.query("taxPeriods").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000),
    ctx.db.query("taxRecords").withIndex("by_business_period", (q) => q.eq("businessId", businessId)).take(5000),
  ]);
  const scopedPeriods = periods.filter((period) => period.startAt <= to && period.endAt >= from);
  const byPeriod = new Map<string, { base: number; tax: number }>();
  const byType = new Map<string, number>();
  const labels: Record<string, string> = { sales: "فروش", purchase: "خرید", payroll: "حقوق", vat: "ارزش افزوده", other: "سایر" };
  for (const record of records) {
    const key = record.periodId as string;
    const row = byPeriod.get(key) ?? { base: 0, tax: 0 };
    row.base += record.taxableBase;
    row.tax += record.taxAmount;
    byPeriod.set(key, row);
    byType.set(record.taxType, (byType.get(record.taxType) ?? 0) + record.taxAmount);
  }
  const rows: ReportRow[] = scopedPeriods.map((period) => {
    const figures = byPeriod.get(period._id as string) ?? { base: 0, tax: 0 };
    return {
      title: period.title,
      from: period.startAt,
      to: period.endAt,
      due: period.dueDate,
      status: STATUS_LABELS[period.status] ?? period.status,
      base: figures.base,
      tax: figures.tax,
      filedAt: period.filedAt,
      paidAt: period.paidAt,
    };
  });
  const columns: ReportColumn[] = [
    { key: "title", label: "دوره مالیاتی", kind: "text" },
    { key: "from", label: "از", kind: "date" },
    { key: "to", label: "تا", kind: "date" },
    { key: "due", label: "سررسید", kind: "date" },
    { key: "status", label: "وضعیت", kind: "text" },
    { key: "base", label: "مأخذ مالیات", kind: "money" },
    { key: "tax", label: "مبلغ مالیات", kind: "money" },
  ];
  const totals = sumRows(rows, ["base", "tax"]);
  return {
    sections: [{ key: "tax", title: "دوره‌های مالیاتی و رکوردهای بازبینی‌شده", columns, rows, totals }],
    summary: [
      { key: "tax", label: "جمع مالیات", value: Number(totals.tax ?? 0), kind: "money" },
      { key: "base", label: "جمع مأخذ", value: Number(totals.base ?? 0), kind: "money" },
      { key: "open", label: "دوره‌های باز/ارسال‌شده", value: rows.filter((row) => row.status === "باز" || row.status === "ارسال‌شده").length, kind: "number" },
      { key: "periods", label: "دوره‌ها", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "ترکیب مالیات بر اساس نوع",
      type: "bar",
      xKey: "label",
      series: [{ key: "tax", label: "مالیات" }],
      data: [...byType.entries()].map(([type, tax]) => ({ label: labels[type] ?? type, tax })),
    },
    evidence: [{ label: "دوره‌ها و رکوردهای مالیاتی", detail: `${scopedPeriods.length} دوره و ${records.length} رکورد بررسی شد.`, reportKey: "tax-summary" }],
  };
}

async function assetReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [assets, depreciations, branches] = await Promise.all([
    ctx.db.query("fixedAssets").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(3000),
    ctx.db.query("assetDepreciations").withIndex("by_business_period", (q) => q.eq("businessId", businessId)).take(20_000),
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(200),
  ]);
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const accumulated = new Map<string, number>();
  for (const row of depreciations) {
    if (row.periodEnd > to) continue;
    if (branchId && row.branchId !== branchId) continue;
    accumulated.set(row.assetId as string, (accumulated.get(row.assetId as string) ?? 0) + row.amount);
  }
  const scoped = assets.filter((asset) => asset.purchaseDate <= to && (!branchId || asset.branchId === branchId));
  const rows: ReportRow[] = scoped.map((asset) => {
    const acc = accumulated.get(asset._id as string) ?? 0;
    return {
      code: asset.code,
      name: asset.name,
      group: asset.group,
      branch: branchMap.get(asset.branchId as string)?.name ?? "—",
      purchaseDate: asset.purchaseDate,
      cost: asset.cost,
      accumulated: acc,
      bookValue: asset.cost - acc,
      status: asset.status === "active" ? "فعال" : asset.status === "fully_depreciated" ? "مستهلک‌شده" : asset.status === "sold" ? "فروخته‌شده" : "کنارگذاشته",
    };
  });
  const columns: ReportColumn[] = [
    { key: "code", label: "کد", kind: "text" },
    { key: "name", label: "دارایی", kind: "text" },
    { key: "group", label: "گروه", kind: "text" },
    { key: "branch", label: "شعبه", kind: "text" },
    { key: "purchaseDate", label: "تاریخ خرید", kind: "date" },
    { key: "cost", label: "بهای تمام‌شده", kind: "money" },
    { key: "accumulated", label: "استهلاک انباشته", kind: "money" },
    { key: "bookValue", label: "ارزش دفتری", kind: "money" },
    { key: "status", label: "وضعیت", kind: "text" },
  ];
  const totals = sumRows(rows, ["cost", "accumulated", "bookValue"]);
  const byGroup = new Map<string, number>();
  for (const row of rows) byGroup.set(String(row.group), (byGroup.get(String(row.group)) ?? 0) + Number(row.bookValue));
  return {
    sections: [{ key: "assets", title: "دارایی‌های ثابت و ارزش دفتری", columns, rows, totals }],
    summary: [
      { key: "cost", label: "بهای تمام‌شده", value: Number(totals.cost ?? 0), kind: "money" },
      { key: "accumulated", label: "استهلاک انباشته", value: Number(totals.accumulated ?? 0), kind: "money" },
      { key: "book", label: "ارزش دفتری", value: Number(totals.bookValue ?? 0), kind: "money" },
      { key: "assets", label: "تعداد دارایی", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "ارزش دفتری بر اساس گروه",
      type: "bar",
      xKey: "label",
      series: [{ key: "bookValue", label: "ارزش دفتری" }],
      data: [...byGroup.entries()].map(([group, bookValue]) => ({ label: group, bookValue })),
    },
    evidence: [{ label: "دارایی و استهلاک", detail: `${assets.length} دارایی و ${depreciations.length} ثبت استهلاک بررسی شد.`, reportKey: "asset-summary" }],
  };
}

async function inventorySimpleReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  to: number,
  mode: "value" | "low" | "dead" | "expiry",
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
  note?: string;
}> {
  const snapshot = await inventorySnapshot(ctx, businessId, to, branchId);
  let rows: ReportRow[] = [];
  let columns: ReportColumn[] = [];
  let title = "";
  if (mode === "value") {
    rows = snapshot.rows
      .filter((row) => row.quantity !== 0 || row.value !== 0)
      .map((row) => ({
        code: row.code,
        name: row.name,
        category: row.categoryId ? snapshot.categoryMap.get(row.categoryId)?.name ?? "—" : "—",
        quantity: Math.round(row.quantity) / 1000,
        unit: row.unit,
        averageCost: row.quantity ? Math.round(row.value / (row.quantity / 1000)) : 0,
        value: row.value,
      }));
    columns = [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "کالا", kind: "text" },
      { key: "category", label: "دسته", kind: "text" },
      { key: "quantity", label: "موجودی", kind: "number" },
      { key: "unit", label: "واحد", kind: "text" },
      { key: "averageCost", label: "بهای واحد", kind: "money" },
      { key: "value", label: "ارزش موجودی", kind: "money" },
    ];
    title = "ارزش موجودی کالاها";
  } else if (mode === "low") {
    rows = snapshot.rows
      .filter((row) => row.minQuantity > 0 && row.quantity <= row.minQuantity)
      .map((row) => ({
        code: row.code,
        name: row.name,
        quantity: Math.round(row.quantity) / 1000,
        minQuantity: Math.round(row.minQuantity) / 1000,
        shortage: Math.max(0, Math.round((row.minQuantity - row.quantity) / 10) / 100),
        value: Math.max(0, row.value),
      }));
    columns = [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "کالا", kind: "text" },
      { key: "quantity", label: "موجودی", kind: "number" },
      { key: "minQuantity", label: "حداقل", kind: "number" },
      { key: "shortage", label: "کمبود", kind: "number" },
      { key: "value", label: "ارزش موجودی", kind: "money" },
    ];
    title = "کالاهای کم‌موجودی";
  } else if (mode === "dead") {
    const threshold = to - 90 * DAY;
    rows = snapshot.rows
      .filter((row) => row.value > 0 && (!row.lastOut || row.lastOut < threshold))
      .map((row) => ({
        code: row.code,
        name: row.name,
        quantity: Math.round(row.quantity) / 1000,
        value: row.value,
        lastOut: row.lastOut ?? 0,
        days: row.lastOut ? Math.floor((to - row.lastOut) / DAY) : null,
      }));
    columns = [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "کالا", kind: "text" },
      { key: "quantity", label: "موجودی", kind: "number" },
      { key: "value", label: "ارزش", kind: "money" },
      { key: "lastOut", label: "آخرین خروج", kind: "date" },
      { key: "days", label: "روز بدون گردش", kind: "number" },
    ];
    title = "کالاهای بدون گردش ۹۰ روز اخیر";
  } else {
    const horizon = to + 90 * DAY;
    rows = snapshot.rows
      .filter((row) => row.value > 0 && row.expiryDate && row.expiryDate <= horizon)
      .map((row) => {
        const daysLeft = row.expiryDate ? Math.ceil((row.expiryDate - to) / DAY) : 0;
        return {
          code: row.code,
          name: row.name,
          quantity: Math.round(row.quantity) / 1000,
          value: row.value,
          expiryDate: row.expiryDate,
          daysLeft,
          status: daysLeft < 0 ? "منقضی‌شده" : "نزدیک انقضا",
        };
      });
    columns = [
      { key: "code", label: "کد", kind: "text" },
      { key: "name", label: "کالا", kind: "text" },
      { key: "quantity", label: "موجودی", kind: "number" },
      { key: "value", label: "ارزش", kind: "money" },
      { key: "expiryDate", label: "تاریخ انقضا", kind: "date" },
      { key: "daysLeft", label: "روز مانده", kind: "number" },
      { key: "status", label: "وضعیت", kind: "text" },
    ];
    title = "کالاهای نزدیک انقضا";
  }
  const totals = sumRows(rows, ["quantity", "value", "minQuantity", "shortage"]);
  return {
    sections: [{
      key: mode,
      title,
      columns,
      rows: sortRows(rows, "value"),
      totals,
      note: mode === "expiry" ? "تاریخ انقضا در سطح کالا/آخرین گردش ثبت‌شده است؛ برای اقلام دارای سری ساخت، سوابق همان کالا را در کاردکس بررسی کنید." : undefined,
    }],
    summary: [
      { key: "value", label: "ارزش موجودی", value: Number(totals.value ?? 0), kind: "money" },
      { key: "items", label: "تعداد اقلام", value: rows.length, kind: "number" },
      { key: "quantity", label: "جمع مقدار", value: Number(totals.quantity ?? 0), kind: "number" },
    ],
    chart: {
      title: "اقلام با بیشترین ارزش",
      type: "bar",
      xKey: "label",
      series: [{ key: "value", label: "ارزش" }],
      data: rows.slice(0, 8).map((row) => ({ label: String(row.name), value: Number(row.value) })),
    },
    evidence: [{ label: "گردش انبار", detail: `${snapshot.rows.length} کالا و گردش انبار تا تاریخ گزارش بررسی شد.`, reportKey: mode === "value" ? "inventory-value" : `inventory-${mode}` }],
  };
}

async function purchaseByProductReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
  search?: string,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [purchases, items, products] = await Promise.all([
    ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("purchaseInvoiceItems").withIndex("by_business_product", (q) => q.eq("businessId", businessId)).take(20_000),
    ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(4000),
  ]);
  const productMap = new Map(products.map((row) => [row._id as string, row]));
  const invoiceMap = new Map(
    purchases
      .filter((row) => row.issueDate >= from && row.issueDate <= to && row.status !== "draft" && row.status !== "cancelled" && (!branchId || row.branchId === branchId))
      .filter((row) => row.kind === "purchase")
      .map((row) => [row._id as string, row]),
  );
  const groups = new Map<string, { name: string; quantity: number; total: number; invoices: Set<string> }>();
  for (const item of items) {
    if (!invoiceMap.has(item.invoiceId as string)) continue;
    const key = item.productId as string;
    const row = groups.get(key) ?? { name: productMap.get(key)?.name ?? item.description, quantity: 0, total: 0, invoices: new Set<string>() };
    row.quantity += item.quantityMilli;
    row.total += item.lineTotal;
    row.invoices.add(item.invoiceId as string);
    groups.set(key, row);
  }
  const needle = normaliseSearch(search);
  const rows: ReportRow[] = [...groups.values()]
    .map((row) => ({
      name: row.name,
      invoices: row.invoices.size,
      quantity: Math.round(row.quantity) / 1000,
      total: row.total,
      average: row.quantity ? Math.round(row.total / (row.quantity / 1000)) : 0,
    }))
    .filter((row) => !needle || String(row.name).toLocaleLowerCase("fa").includes(needle))
    .sort((a, b) => Number(b.total) - Number(a.total));
  const columns: ReportColumn[] = [
    { key: "name", label: "کالا", kind: "text" },
    { key: "invoices", label: "تعداد فاکتور", kind: "number" },
    { key: "quantity", label: "مقدار خرید", kind: "number" },
    { key: "average", label: "میانگین بهای واحد", kind: "money" },
    { key: "total", label: "جمع خرید", kind: "money" },
  ];
  const totals = sumRows(rows, ["invoices", "quantity", "total"]);
  return {
    sections: [{ key: "products", title: "خرید به تفکیک کالا", columns, rows, totals }],
    summary: [
      { key: "total", label: "جمع خرید", value: Number(totals.total ?? 0), kind: "money" },
      { key: "items", label: "تعداد کالا", value: rows.length, kind: "number" },
      { key: "quantity", label: "جمع مقدار", value: Number(totals.quantity ?? 0), kind: "number" },
    ],
    chart: {
      title: "بیشترین خرید کالا",
      type: "bar",
      xKey: "label",
      series: [{ key: "total", label: "خرید" }],
      data: rows.slice(0, 8).map((row) => ({ label: String(row.name), total: Number(row.total) })),
    },
    evidence: [{ label: "فاکتور خرید", detail: `${invoiceMap.size} فاکتور قطعی و ${items.length} ردیف بررسی شد.`, reportKey: "purchase-by-product" }],
  };
}

async function salesByBranchReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [invoices, branches] = await Promise.all([
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(200),
  ]);
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const primary = branches.find((row) => row.isPrimary) ?? branches[0];
  const scoped = scopedInvoices(invoices, from, to, branchId);
  const groups = new Map<string, { name: string; count: number; sales: number; tax: number; discount: number; profit: number; outstanding: number }>();
  for (const invoice of scoped) {
    const key = (invoice.branchId ?? primary?._id ?? "") as string;
    const row = groups.get(key) ?? { name: branchMap.get(key)?.name ?? "شعبه اصلی", count: 0, sales: 0, tax: 0, discount: 0, profit: 0, outstanding: 0 };
    row.count += 1;
    row.sales += invoice.total;
    row.tax += invoice.taxAmount;
    row.discount += invoice.discount;
    row.profit += invoice.total - (invoice.returnedAmount ?? 0) - (invoice.costOfGoods ?? 0);
    row.outstanding += outstandingInvoice(invoice);
    groups.set(key, row);
  }
  const rows: ReportRow[] = [...groups.values()].sort((a, b) => b.sales - a.sales);
  const columns: ReportColumn[] = [
    { key: "name", label: "شعبه", kind: "text" },
    { key: "count", label: "تعداد فاکتور", kind: "number" },
    { key: "sales", label: "فروش", kind: "money" },
    { key: "tax", label: "مالیات", kind: "money" },
    { key: "discount", label: "تخفیف", kind: "money" },
    { key: "profit", label: "سود ناخالص", kind: "money" },
    { key: "outstanding", label: "مطالبات", kind: "money" },
  ];
  const totals = sumRows(rows, ["count", "sales", "tax", "discount", "profit", "outstanding"]);
  return {
    sections: [{ key: "branches", title: "فروش به تفکیک شعبه", columns, rows, totals }],
    summary: [
      { key: "sales", label: "فروش", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "profit", label: "سود ناخالص", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "outstanding", label: "مطالبات", value: Number(totals.outstanding ?? 0), kind: "money" },
      { key: "branches", label: "شعبه", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "فروش شعب",
      type: "bar",
      xKey: "label",
      series: [{ key: "sales", label: "فروش" }],
      data: rows.map((row) => ({ label: String(row.name), sales: Number(row.sales) })),
    },
    evidence: [{ label: "فاکتورهای فروش", detail: `${scoped.length} فاکتور در بازه بین ${branches.length} شعبه بررسی شد.`, reportKey: "sales-by-branch" }],
  };
}

async function salesByUserReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const [invoices, users] = await Promise.all([
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("users").take(1000),
  ]);
  const userMap = new Map(users.map((row) => [row._id as string, row]));
  const scoped = scopedInvoices(invoices, from, to, branchId);
  const groups = new Map<string, { name: string; count: number; sales: number; profit: number; outstanding: number }>();
  for (const invoice of scoped) {
    const key = invoice.createdBy as string;
    const row = groups.get(key) ?? { name: userMap.get(key)?.name ?? userMap.get(key)?.email ?? "کاربر", count: 0, sales: 0, profit: 0, outstanding: 0 };
    row.count += 1;
    row.sales += invoice.total;
    row.profit += invoice.total - (invoice.returnedAmount ?? 0) - (invoice.costOfGoods ?? 0);
    row.outstanding += outstandingInvoice(invoice);
    groups.set(key, row);
  }
  const rows: ReportRow[] = [...groups.values()].sort((a, b) => b.sales - a.sales);
  const columns: ReportColumn[] = [
    { key: "name", label: "کاربر", kind: "text" },
    { key: "count", label: "تعداد فاکتور", kind: "number" },
    { key: "sales", label: "فروش", kind: "money" },
    { key: "profit", label: "سود ناخالص", kind: "money" },
    { key: "outstanding", label: "مطالبات", kind: "money" },
  ];
  const totals = sumRows(rows, ["count", "sales", "profit", "outstanding"]);
  return {
    sections: [{ key: "users", title: "فروش به تفکیک کاربر ثبت‌کننده", columns, rows, totals }],
    summary: [
      { key: "sales", label: "فروش", value: Number(totals.sales ?? 0), kind: "money" },
      { key: "profit", label: "سود ناخالص", value: Number(totals.profit ?? 0), kind: "money" },
      { key: "users", label: "کاربران", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "فروش کاربران",
      type: "bar",
      xKey: "label",
      series: [{ key: "sales", label: "فروش" }],
      data: rows.slice(0, 10).map((row) => ({ label: String(row.name), sales: Number(row.sales) })),
    },
    evidence: [{ label: "فاکتورهای فروش", detail: `${scoped.length} فاکتور بررسی شد.`, reportKey: "sales-by-user" }],
  };
}

async function purchaseTrendReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const purchases = await ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(6000);
  const scoped = purchases.filter((row) => row.issueDate >= from && row.issueDate <= to && row.status !== "draft" && row.status !== "cancelled" && (!branchId || row.branchId === branchId));
  const rows: ReportRow[] = monthlyBuckets(from, to).map((bucket) => {
    const inBucket = scoped.filter((row) => row.issueDate >= bucket.from && row.issueDate <= bucket.to);
    const purchasesTotal = inBucket.filter((row) => row.kind === "purchase").reduce((sum, row) => sum + row.total, 0);
    const returnsTotal = inBucket.filter((row) => row.kind === "return").reduce((sum, row) => sum + row.total, 0);
    return {
      month: bucket.label,
      count: inBucket.filter((row) => row.kind === "purchase").length,
      purchases: purchasesTotal,
      returns: returnsTotal,
      net: purchasesTotal - returnsTotal,
    };
  });
  const columns: ReportColumn[] = [
    { key: "month", label: "ماه", kind: "text" },
    { key: "count", label: "تعداد فاکتور", kind: "number" },
    { key: "purchases", label: "خرید", kind: "money" },
    { key: "returns", label: "برگشت", kind: "money" },
    { key: "net", label: "خرید خالص", kind: "money" },
  ];
  const totals = sumRows(rows, ["count", "purchases", "returns", "net"]);
  return {
    sections: [{ key: "trend", title: "روند ماهانه خرید", columns, rows, totals }],
    summary: [
      { key: "net", label: "خرید خالص", value: Number(totals.net ?? 0), kind: "money" },
      { key: "purchases", label: "جمع خرید", value: Number(totals.purchases ?? 0), kind: "money" },
      { key: "returns", label: "جمع برگشت", value: Number(totals.returns ?? 0), kind: "money" },
      { key: "months", label: "ماه", value: rows.length, kind: "number" },
    ],
    chart: {
      title: "روند ماهانه خرید و برگشت",
      type: "line",
      xKey: "label",
      series: [
        { key: "purchases", label: "خرید" },
        { key: "returns", label: "برگشت" },
      ],
      data: rows.map((row) => ({ label: String(row.month), purchases: Number(row.purchases), returns: Number(row.returns) })),
    },
    evidence: [{ label: "فاکتورهای خرید", detail: `${scoped.length} سند خرید/برگشت در بازه بررسی شد.`, reportKey: "purchase-trend" }],
  };
}

async function managementKpiReport(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  data: AccountingData,
  from: number,
  to: number,
  branchId?: Id<"branches">,
): Promise<{
  sections: ReportSection[];
  summary: ReportSummaryItem[];
  chart: ReportPayload["chart"];
  evidence: ReportEvidence[];
}> {
  const span = to - from + 1;
  const current = computeIncome(data, from, to);
  const previous = computeIncome(data, from - span, from - 1);
  const [invoices, purchases, transactions, snapshot] = await Promise.all([
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(6000),
    loadCashTransactions(ctx, businessId, to, branchId),
    inventorySnapshot(ctx, businessId, to, branchId),
  ]);
  const ar = receivableBalance(invoices, to, branchId);
  const ap = payableBalance(purchases, to, branchId);
  const cash = cashBalance(transactions);
  const monthly = monthlyBuckets(from, to).map((bucket) => {
    const part = computeIncome(data, bucket.from, bucket.to);
    return { label: bucket.label, revenue: part.totals.revenue, net: part.totals.netProfit };
  });
  const comparison: ReportRow[] = [
    { metric: "فروش", current: current.totals.revenue, previous: previous.totals.revenue, change: growth(current.totals.revenue, previous.totals.revenue) },
    { metric: "سود خالص", current: current.totals.netProfit, previous: previous.totals.netProfit, change: growth(current.totals.netProfit, previous.totals.netProfit) },
    { metric: "هزینه", current: current.totals.cogs + current.totals.opex + current.totals.otherExpenses, previous: previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses, change: growth(current.totals.cogs + current.totals.opex + current.totals.otherExpenses, previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses) },
  ];
  const topExpenses = [...current.opex].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 8);
  return {
    sections: [
      {
        key: "comparison",
        title: "مقایسه شاخص‌های کلیدی با دوره قبل",
        columns: [
          { key: "metric", label: "شاخص", kind: "text" },
          { key: "current", label: "دوره جاری", kind: "money" },
          { key: "previous", label: "دوره قبل", kind: "money" },
          { key: "change", label: "تغییر ٪", kind: "percent" },
        ],
        rows: comparison,
        totals: {},
      },
      moneySection("top-expenses", "بیشترین هزینه‌های عملیاتی", topExpenses),
    ],
    summary: [
      { key: "sales", label: "فروش", value: current.totals.revenue, kind: "money" },
      { key: "net", label: "سود خالص", value: current.totals.netProfit, kind: "money" },
      { key: "margin", label: "حاشیه سود", value: current.totals.margin, kind: "percent" },
      { key: "cash", label: "نقد و بانک", value: cash, kind: "money" },
      { key: "ar", label: "مطالبات", value: ar, kind: "money" },
      { key: "ap", label: "بدهی", value: ap, kind: "money" },
      { key: "inventory", label: "ارزش موجودی", value: snapshot.totalValue, kind: "money" },
      { key: "low-stock", label: "کالاهای کم‌موجودی", value: snapshot.lowCount, kind: "number" },
    ],
    chart: {
      title: "روند فروش و سود",
      type: "line",
      xKey: "label",
      series: [
        { key: "revenue", label: "فروش" },
        { key: "net", label: "سود خالص" },
      ],
      data: monthly,
    },
    evidence: [
      { label: "داده واقعی کسب‌وکار", detail: `${current.documentCount} سند، ${invoices.length} فاکتور و ${transactions.length} حرکت مالی بررسی شد.`, reportKey: "management-kpi" },
    ],
  };
}

export const run = query({
  args: {
    businessId: v.id("businesses"),
    reportKey: v.string(),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    horizonDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const definition = reportDefinition(args.reportKey);
    if (!definition) throw new ConvexError("گزارش انتخاب‌شده در مرکز گزارش وجود ندارد.");
    if (definition.mode !== "run") {
      throw new ConvexError("این گزارش در صفحه تخصصی خود اجرا می‌شود.");
    }
    const access = await authorizeReport(ctx, args.businessId, definition.permission);
    const fiscalYear = await resolveFiscalYear(ctx, args.businessId, args.fiscalYearId);
    const from = args.from ?? fiscalYear.startAt;
    const to = args.to ?? fiscalYear.endAt;
    assertRange(from, to);
    const branch = args.branchId ? await ctx.db.get(args.branchId) : null;
    if (args.branchId && (!branch || branch.businessId !== args.businessId)) {
      throw new ConvexError("شعبه انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }
    let accountingData: AccountingData | undefined;
    const accounting = async () => {
      accountingData ??= await loadAccounting(
        ctx,
        args.businessId,
        fiscalYear._id,
        args.branchId,
        to,
      );
      return accountingData;
    };
    let content: {
      sections: ReportSection[];
      summary: ReportSummaryItem[];
      chart?: ReportPayload["chart"];
      evidence: ReportEvidence[];
      note?: string;
    };
    switch (args.reportKey) {
      case "balance-sheet":
        content = balanceSheetReport(await accounting());
        break;
      case "income-statement": {
        const part = computeIncome(await accounting(), from, to);
        content = {
          sections: incomeSections(part),
          summary: incomeSummary(part),
          evidence: [{ label: "اسناد سود و زیان", detail: `${part.documentCount} سند قطعی و ${part.lineCount} ردیف در بازه استفاده شد.`, reportKey: "income-statement" }],
        };
        break;
      }
      case "profit-analysis":
        content = await profitAnalysis(await accounting(), from, to);
        break;
      case "trial-balance":
        content = trialBalanceReport(await accounting(), from, to);
        break;
      case "account-balances": {
        const trial = trialBalanceReport(await accounting(), from, to);
        content = {
          ...trial,
          sections: trial.sections.map((section) => ({
            ...section,
            title: "مانده حساب‌های دفتر کل",
            note: "مانده پایان دوره بر پایه گردش و مانده واقعی اسناد قطعی محاسبه شده است.",
          })),
        };
        break;
      }
      case "journal":
        content = journalReport(await accounting(), from, to, args.search);
        break;
      case "documents-posted":
        content = await documentReport(ctx, args.businessId, fiscalYear._id, from, to, "posted", args.branchId, args.search);
        break;
      case "documents-draft":
        content = await documentReport(ctx, args.businessId, fiscalYear._id, from, to, "draft", args.branchId, args.search);
        break;
      case "documents-correction":
        content = await documentReport(ctx, args.businessId, fiscalYear._id, from, to, "correction", args.branchId, args.search);
        break;
      case "documents-opening-closing":
        content = await documentReport(ctx, args.businessId, fiscalYear._id, from, to, "opening-closing", args.branchId, args.search);
        break;
      case "document-register":
        content = await documentReport(ctx, args.businessId, fiscalYear._id, from, to, "register", args.branchId, args.search);
        break;
      case "cash-flow-statement": {
        const transactions = await loadCashTransactions(ctx, args.businessId, to, args.branchId);
        content = cashFlowStatementReport(transactions, from, to);
        break;
      }
      case "cash-flow-forecast":
        content = await cashFlowForecastReport(
          ctx,
          args.businessId,
          to,
          Math.min(365, Math.max(7, Math.round(args.horizonDays ?? 30))),
          args.branchId,
        );
        break;
      case "bank-summary":
        content = await bankOrCashReport(ctx, args.businessId, "bank", from, to, args.branchId);
        break;
      case "cash-summary":
        content = await bankOrCashReport(ctx, args.businessId, "cash", from, to, args.branchId);
        break;
      case "sales-by-customer":
        content = await customerReport(ctx, args.businessId, "top", from, to, args.branchId, args.search);
        break;
      case "sales-by-product":
        content = await productSales(ctx, args.businessId, from, to, "all", args.branchId, args.search);
        break;
      case "sales-by-category":
        content = await salesByCategory(ctx, args.businessId, from, to, args.branchId, args.search);
        break;
      case "sales-by-branch":
        content = await salesByBranchReport(ctx, args.businessId, from, to, args.branchId);
        break;
      case "sales-by-user":
        content = await salesByUserReport(ctx, args.businessId, from, to, args.branchId);
        break;
      case "sales-top-products":
        content = await productSales(ctx, args.businessId, from, to, "top", args.branchId, args.search);
        break;
      case "sales-slow-products":
        content = await productSales(ctx, args.businessId, from, to, "slow", args.branchId, args.search);
        break;
      case "invoice-average":
        content = await invoiceAverage(ctx, args.businessId, from, to, args.branchId, args.search);
        break;
      case "sales-margin":
        content = await salesMargin(ctx, args.businessId, from, to, args.branchId, args.search);
        break;
      case "purchase-by-supplier":
        content = await purchaseReport(ctx, args.businessId, "top", from, to, args.branchId, args.search);
        break;
      case "purchase-by-product":
        content = await purchaseByProductReport(ctx, args.businessId, from, to, args.branchId, args.search);
        break;
      case "purchase-price-comparison":
        content = await purchaseReport(ctx, args.businessId, "price", from, to, args.branchId, args.search);
        break;
      case "purchase-trend":
        content = await purchaseTrendReport(ctx, args.businessId, from, to, args.branchId);
        break;
      case "purchase-frequent":
        content = await purchaseReport(ctx, args.businessId, "frequent", from, to, args.branchId, args.search);
        break;
      case "inventory-value":
        content = await inventorySimpleReport(ctx, args.businessId, to, "value", args.branchId);
        break;
      case "inventory-by-warehouse":
        content = await inventoryWarehouseReport(ctx, args.businessId, to, args.branchId);
        break;
      case "inventory-low":
        content = await inventorySimpleReport(ctx, args.businessId, to, "low", args.branchId);
        break;
      case "inventory-dead":
        content = await inventorySimpleReport(ctx, args.businessId, to, "dead", args.branchId);
        break;
      case "inventory-expiry":
        content = await inventorySimpleReport(ctx, args.businessId, to, "expiry", args.branchId);
        break;
      case "inventory-profitability":
        content = await productSales(ctx, args.businessId, from, to, "profitability", args.branchId, args.search);
        break;
      case "inventory-turnover":
        content = await inventoryTurnover(ctx, args.businessId, from, to, args.branchId);
        break;
      case "inventory-count-differences":
        content = await inventoryCountDifferences(ctx, args.businessId, from, to, args.branchId, args.search);
        break;
      case "customer-top":
        content = await customerReport(ctx, args.businessId, "top", from, to, args.branchId, args.search);
        break;
      case "customer-debt":
        content = await customerReport(ctx, args.businessId, "debt", from, to, args.branchId, args.search);
        break;
      case "customer-aging":
        content = await customerReport(ctx, args.businessId, "aging", from, to, args.branchId, args.search);
        break;
      case "customer-ledger":
        content = await customerReport(ctx, args.businessId, "ledger", from, to, args.branchId, args.search);
        break;
      case "customer-trend":
        content = await customerReport(ctx, args.businessId, "trend", from, to, args.branchId, args.search);
        break;
      case "supplier-top":
        content = await purchaseReport(ctx, args.businessId, "top", from, to, args.branchId, args.search);
        break;
      case "supplier-debt":
        content = await purchaseReport(ctx, args.businessId, "debt", from, to, args.branchId, args.search);
        break;
      case "supplier-due":
        content = await purchaseReport(ctx, args.businessId, "due", from, to, args.branchId, args.search);
        break;
      case "supplier-ledger":
        content = await purchaseReport(ctx, args.businessId, "ledger", from, to, args.branchId, args.search);
        break;
      case "supplier-compare":
        content = await purchaseReport(ctx, args.businessId, "compare", from, to, args.branchId, args.search);
        break;
      case "payroll-summary":
        content = await payrollReport(ctx, args.businessId, from, to, args.branchId);
        break;
      case "tax-summary":
        content = await taxReport(ctx, args.businessId, from, to);
        break;
      case "asset-summary":
        content = await assetReport(ctx, args.businessId, to, args.branchId);
        break;
      case "branch-comparison":
        content = await branchComparisonReport(ctx, args.businessId, fiscalYear, await accounting(), from, to, args.branchId, "comparison");
        break;
      case "branch-profit":
        content = await branchComparisonReport(ctx, args.businessId, fiscalYear, await accounting(), from, to, args.branchId, "profit");
        break;
      case "management-kpi":
        content = await managementKpiReport(ctx, args.businessId, await accounting(), from, to, args.branchId);
        break;
      case "financial-alerts":
        content = await financialAlertsReport(ctx, access.user._id, args.businessId, await accounting(), fiscalYear, from, to, args.branchId);
        break;
      default:
        throw new ConvexError("اجرای این گزارش در موتور مرکزی تعریف نشده است.");
    }
    return basePayload(definition, access, fiscalYear, branch?.name, from, to, content);
  },
});

/**
 * Phase 9 — evidence snapshot for Vira AI and management summaries.
 *
 * This function is intentionally not a public Convex query. The AI action
 * authenticates the caller and passes an explicit membership to this builder,
 * so an internal call cannot read another tenant's books by guessing an id.
 */
export async function buildAssistantSnapshot(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  membership: Doc<"businessMembers">,
) {
  const [business, years] = await Promise.all([
    ctx.db.get(businessId),
    ctx.db.query("fiscalYears").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(50),
  ]);
  if (!business) throw new ConvexError("کسب‌وکار یافت نشد.");
  const now = Date.now();
  const jalaliNow = timestampToJalali(now);
  const monthStart = jalaliMonthStart(jalaliNow.jy, jalaliNow.jm);
  const monthEnd = jalaliMonthEnd(jalaliNow.jy, jalaliNow.jm);
  const currentTo = Math.min(now, monthEnd);
  const previousMonth = jalaliNow.jm === 1 ? { jy: jalaliNow.jy - 1, jm: 12 } : { jy: jalaliNow.jy, jm: jalaliNow.jm - 1 };
  const previousFrom = jalaliMonthStart(previousMonth.jy, previousMonth.jm);
  const previousTo = jalaliMonthEnd(previousMonth.jy, previousMonth.jm);
  const currentYear = years.find((year) => year.startAt <= now && year.endAt >= now) ?? years.sort((a, b) => b.startAt - a.startAt)[0];
  if (!currentYear) throw new ConvexError("دوره مالی برای تحلیل یافت نشد.");
  const data = await loadAccounting(ctx, businessId, currentYear._id, undefined, currentTo);
  const current = computeIncome(data, monthStart, currentTo);
  const previous = computeIncome(data, previousFrom, Math.min(previousTo, currentTo));
  const [invoices, purchases, transactions, snapshot, users, customers, branches] = await Promise.all([
    ctx.db.query("invoices").withIndex("by_business_issue", (q) => q.eq("businessId", businessId)).take(6000),
    ctx.db.query("purchaseInvoices").withIndex("by_business_date", (q) => q.eq("businessId", businessId)).take(6000),
    loadCashTransactions(ctx, businessId, currentTo),
    inventorySnapshot(ctx, businessId, currentTo),
    ctx.db.query("users").take(1000),
    ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(3000),
    ctx.db.query("branches").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(200),
  ]);
  void users;
  const customerMap = new Map(customers.map((row) => [row._id as string, row]));
  const branchMap = new Map(branches.map((row) => [row._id as string, row]));
  const ar = receivableBalance(invoices, currentTo);
  const ap = payableBalance(purchases, currentTo);
  const cash = cashBalance(transactions);
  const canSeeSensitive = membership.role !== "viewer";
  const debtors = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.issueDate > currentTo || invoice.status === "draft" || invoice.status === "void") continue;
    const amount = outstandingInvoice(invoice);
    if (amount <= 0) continue;
    const id = invoice.customerId as string;
    debtors.set(id, (debtors.get(id) ?? 0) + amount);
  }
  const topDebtors = canSeeSensitive
    ? [...debtors.entries()]
        .map(([id, amount]) => ({ name: customerMap.get(id)?.name ?? "—", amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    : [];
  const topExpenses = [...current.opex]
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5)
    .map((row) => ({ name: String(row.name), amount: Number(row.amount) }));
  const lowStock = snapshot.rows
    .filter((row) => row.minQuantity > 0 && row.quantity <= row.minQuantity)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 8)
    .map((row) => ({ name: row.name, quantity: Math.round(row.quantity) / 1000, minQuantity: Math.round(row.minQuantity) / 1000, unit: row.unit }));
  const byBranch = branches.map((branch) => {
    const scoped = scopedInvoices(invoices, monthStart, currentTo).filter((row) => row.branchId === branch._id);
    return { name: branch.name, sales: scoped.reduce((sum, row) => sum + row.total, 0) };
  }).filter((row) => row.sales > 0).sort((a, b) => b.sales - a.sales);
  const granted = permissionsFor(membership);
  const canPayroll = granted.includes("payroll.view");
  const canTax = granted.includes("tax.view");
  let payrollOpen = 0;
  let taxOpen = 0;
  if (canPayroll) {
    const periods = await ctx.db.query("payrollPeriods").withIndex("by_business_status", (q) => q.eq("businessId", businessId).eq("status", "approved")).take(500);
    payrollOpen = periods.reduce((sum, row) => sum + row.netTotal, 0);
  }
  if (canTax) {
    const [periods, records] = await Promise.all([
      ctx.db.query("taxPeriods").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000),
      ctx.db.query("taxRecords").withIndex("by_business_period", (q) => q.eq("businessId", businessId)).take(5000),
    ]);
    const openPeriods = new Set(periods.filter((row) => row.status === "open" || row.status === "filed").map((row) => row._id as string));
    taxOpen = records.filter((row) => openPeriods.has(row.periodId as string)).reduce((sum, row) => sum + row.taxAmount, 0);
  }
  const generatedAlerts: { title: string; reason: string; severity: string }[] = [];
  const expenseChange = growth(current.totals.cogs + current.totals.opex + current.totals.otherExpenses, previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses);
  if (previous.totals.revenue > 0 && current.totals.revenue < previous.totals.revenue * 0.85) {
    generatedAlerts.push({ title: "کاهش فروش", reason: `${Math.abs(growth(current.totals.revenue, previous.totals.revenue)).toLocaleString("fa-IR")}٪ کاهش نسبت به ماه قبل`, severity: "warning" });
  }
  if (expenseChange >= 20 && previous.totals.cogs + previous.totals.opex + previous.totals.otherExpenses > 0) {
    generatedAlerts.push({ title: "افزایش هزینه", reason: `${expenseChange.toLocaleString("fa-IR")}٪ افزایش نسبت به ماه قبل`, severity: expenseChange >= 40 ? "critical" : "warning" });
  }
  if (snapshot.lowCount > 0) {
    generatedAlerts.push({ title: "کمبود موجودی", reason: `${snapshot.lowCount.toLocaleString("fa-IR")} کالا در حد یا زیر حداقل موجودی`, severity: "warning" });
  }
  const salesByBranch = byBranch.map((row) => ({ name: row.name, sales: row.sales }));
  const periodLabel = `${jalaliMonthLabel(jalaliNow.jy, jalaliNow.jm)} ${jalaliNow.jy}`;
  const previousLabel = `${jalaliMonthLabel(previousMonth.jy, previousMonth.jm)} ${previousMonth.jy}`;
  const citations: { label: string; detail: string; reportKey?: string }[] = [
    { label: "صورت سود و زیان", detail: `دوره ${periodLabel}، از ${jalaliDateLabel(monthStart)} تا ${jalaliDateLabel(currentTo)}`, reportKey: "income-statement" },
    { label: "تحلیل فروش", detail: `${scopedInvoices(invoices, monthStart, currentTo).length} فاکتور قطعی در دوره`, reportKey: "sales-by-customer" },
    { label: "نقدینگی", detail: `${transactions.length} حرکت بانکی/صندوق تا ${jalaliDateLabel(currentTo)}`, reportKey: "cash-flow-forecast" },
    { label: "انبار", detail: `${snapshot.rows.length} کالا و ${snapshot.totalValue.toLocaleString("fa-IR")} ارزش موجودی`, reportKey: "inventory-value" },
  ];
  if (canSeeSensitive) citations.push({ label: "مطالبات", detail: `${debtors.size} مشتری بدهکار تا ${jalaliDateLabel(currentTo)}`, reportKey: "customer-debt" });
  if (canTax) citations.push({ label: "مالیات", detail: `${taxOpen.toLocaleString("fa-IR")} بدهی مالیاتی دوره‌های باز/ارسال‌شده`, reportKey: "tax-summary" });
  if (canPayroll) citations.push({ label: "حقوق", detail: `${payrollOpen.toLocaleString("fa-IR")} حقوق تأییدشده و پرداخت‌نشده`, reportKey: "payroll-summary" });
  return {
    businessName: business.name,
    currency: business.currency,
    fiscalYear: currentYear.name,
    periodLabel,
    previousLabel,
    from: monthStart,
    to: currentTo,
    generatedAt: now,
    revenue: current.totals.revenue,
    previousRevenue: previous.totals.revenue,
    salesChange: growth(current.totals.revenue, previous.totals.revenue),
    cogs: current.totals.cogs,
    opex: current.totals.opex,
    otherIncome: current.totals.otherIncome,
    otherExpenses: current.totals.otherExpenses,
    netProfit: current.totals.netProfit,
    previousNetProfit: previous.totals.netProfit,
    margin: current.totals.margin,
    previousMargin: previous.totals.margin,
    cash,
    receivables: ar,
    payables: ap,
    inventoryValue: snapshot.totalValue,
    lowStockCount: snapshot.lowCount,
    lowStock,
    topExpenses,
    topDebtors,
    salesByBranch,
    taxOpen,
    payrollOpen,
    canPayroll,
    canTax,
    canSeeSensitive,
    alerts: generatedAlerts,
    citations,
    invoiceCount: scopedInvoices(invoices, monthStart, currentTo).length,
    documentCount: current.documentCount,
    branchNames: branches.map((row) => ({ id: row._id as string, name: branchMap.get(row._id as string)?.name ?? "—" })),
  };
}

export type AssistantSnapshot = Awaited<ReturnType<typeof buildAssistantSnapshot>>;
