import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership } from "./lib/tenant";
import {
  dayBucketsBetween,
  jalaliDateLabel,
  monthBucketsBetween,
  weekBucketsBetween,
} from "./lib/calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

const reportKindValidator = v.union(
  v.literal("bank-ledger"),
  v.literal("cash-ledger"),
  v.literal("receipts"),
  v.literal("payments"),
  v.literal("incomes"),
  v.literal("expenses"),
  v.literal("received-checks"),
  v.literal("issued-checks"),
  v.literal("receivables"),
  v.literal("payables"),
  v.literal("cashflow"),
  v.literal("transfers"),
);

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestamp: number) {
  return startOfDay(timestamp) + DAY_MS - 1;
}

function sumBy<T>(rows: T[], get: (row: T) => number) {
  return rows.reduce((sum, row) => sum + get(row), 0);
}

function inRange(timestamp: number, from?: number, to?: number) {
  if (from !== undefined && timestamp < from) return false;
  if (to !== undefined && timestamp > to) return false;
  return true;
}

function bucketForRange(from: number, to: number) {
  const days = Math.max(1, (to - from) / DAY_MS);
  if (days <= 45) return dayBucketsBetween(from, to);
  if (days <= 180) return weekBucketsBetween(from, to);
  return monthBucketsBetween(from, to);
}

function invoiceOutstanding(invoice: Doc<"invoices">) {
  return Math.max(
    0,
    invoice.total -
      (invoice.returnedAmount ?? 0) -
      (invoice.paidAmount ?? 0),
  );
}

function expenseOutstanding(expense: Doc<"expenseRecords">) {
  return Math.max(0, expense.amount - expense.paidAmount);
}

const RECEIVED_OPEN = ["received", "pending", "assigned"];
const ISSUED_OPEN = ["issued", "delivered"];

function isOpenCheck(status: string, type: "received" | "issued") {
  return type === "received"
    ? RECEIVED_OPEN.includes(status)
    : ISSUED_OPEN.includes(status);
}

export const overview = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { business } = await requireMembership(ctx, args.businessId);
    const now = Date.now();
    const periodEnd =
      args.to !== undefined && Number.isFinite(args.to) ? args.to : now;
    const periodStart =
      args.from !== undefined && Number.isFinite(args.from)
        ? args.from
        : (() => {
            const date = new Date(periodEnd);
            date.setDate(1);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
          })();
    if (periodStart > periodEnd) {
      throw new ConvexError("بازه گزارش معتبر نیست.");
    }
    if (periodEnd - periodStart > 731 * DAY_MS) {
      throw new ConvexError("بازه گزارش حداکثر دو سال است.");
    }
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = now;
    const branchId = args.branchId;

    const [
      banks,
      funds,
      movements,
      receipts,
      paymentVouchers,
      incomes,
      expenses,
      invoices,
      receivedChecks,
      issuedChecks,
    ] = await Promise.all([
      ctx.db
        .query("bankAccounts")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(200),
      ctx.db
        .query("cashFunds")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(200),
      ctx.db
        .query("financialTransactions")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(10000),
      ctx.db
        .query("receipts")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000),
      ctx.db
        .query("paymentVouchers")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000),
      ctx.db
        .query("incomeRecords")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000),
      ctx.db
        .query("expenseRecords")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000),
      ctx.db
        .query("invoices")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(5000),
      ctx.db
        .query("receivedChecks")
        .withIndex("by_business_due", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(2000),
      ctx.db
        .query("issuedChecks")
        .withIndex("by_business_due", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(2000),
    ]);

    const scopedMovements = movements.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const bankBalances = new Map<string, number>();
    const cashBalances = new Map<string, number>();
    for (const row of scopedMovements) {
      if (row.bankAccountId) {
        const key = row.bankAccountId as string;
        bankBalances.set(
          key,
          (bankBalances.get(key) ?? 0) +
            (row.direction === "in" ? row.amount : -row.amount),
        );
      }
      if (row.cashFundId) {
        const key = row.cashFundId as string;
        cashBalances.set(
          key,
          (cashBalances.get(key) ?? 0) +
            (row.direction === "in" ? row.amount : -row.amount),
        );
      }
    }
    const totalBank = banks.reduce(
      (sum, row) => sum + (bankBalances.get(row._id as string) ?? 0),
      0,
    );
    const totalCash = funds.reduce(
      (sum, row) => sum + (cashBalances.get(row._id as string) ?? 0),
      0,
    );

    const scopedReceipts = receipts.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const scopedPayments = paymentVouchers.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const scopedIncomes = incomes.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const scopedExpenses = expenses.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const scopedInvoices = invoices.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const scopedReceived = receivedChecks.filter(
      (row) => !branchId || row.branchId === branchId,
    );
    const scopedIssued = issuedChecks.filter(
      (row) => !branchId || row.branchId === branchId,
    );

    const postedReceipts = scopedReceipts.filter(
      (row) => row.status === "posted",
    );
    const postedPayments = scopedPayments.filter(
      (row) => row.status === "posted",
    );
    const postedIncomes = scopedIncomes.filter(
      (row) => row.status === "posted",
    );
    const approvedExpenses = scopedExpenses.filter(
      (row) => row.status === "approved" || row.status === "paid",
    );

    const todayReceipts = sumBy(
      postedReceipts.filter((row) =>
        inRange(row.occurredAt, dayStart, dayEnd),
      ),
      (row) => row.amount,
    );
    const todayPayments = sumBy(
      postedPayments.filter((row) =>
        inRange(row.occurredAt, dayStart, dayEnd),
      ),
      (row) => row.amount,
    );
    const monthIncomes = sumBy(
      postedIncomes.filter((row) =>
        inRange(row.occurredAt, monthStart.getTime(), monthEnd),
      ),
      (row) => row.amount,
    );
    const monthSales = sumBy(
      scopedInvoices.filter(
        (row) =>
          (row.status === "issued" || row.status === "paid") &&
          inRange(row.issueDate, monthStart.getTime(), monthEnd),
      ),
      (row) => row.total,
    );
    const monthExpenses = sumBy(
      approvedExpenses.filter((row) =>
        inRange(row.occurredAt, monthStart.getTime(), monthEnd),
      ),
      (row) => row.amount,
    );
    const receivables = sumBy(
      scopedInvoices.filter((row) => row.status === "issued"),
      invoiceOutstanding,
    );
    const payables = sumBy(
      approvedExpenses.filter((row) => expenseOutstanding(row) > 0),
      expenseOutstanding,
    );

    const openReceivedChecks = scopedReceived.filter((row) =>
      isOpenCheck(row.status, "received"),
    );
    const openIssuedChecks = scopedIssued.filter((row) =>
      isOpenCheck(row.status, "issued"),
    );
    const dueSoon = [
      ...openReceivedChecks.map((row) => ({
        type: "received" as const,
        amount: row.amount,
        dueDate: row.dueDate,
        checkNumber: row.checkNumber,
        partyName: row.issuerName,
        status: row.status,
      })),
      ...openIssuedChecks.map((row) => ({
        type: "issued" as const,
        amount: row.amount,
        dueDate: row.dueDate,
        checkNumber: row.checkNumber,
        partyName: row.payeeName,
        status: row.status,
      })),
    ]
      .filter((row) => row.dueDate <= now + 14 * DAY_MS)
      .sort((a, b) => a.dueDate - b.dueDate);

    const external = scopedMovements.filter(
      (row) =>
        !row.operationType.startsWith("transfer-") &&
        row.occurredAt <= periodEnd,
    );
    const openingNet = sumBy(
      external.filter((row) => row.occurredAt < periodStart),
      (row) => (row.direction === "in" ? row.amount : -row.amount),
    );
    const buckets = bucketForRange(periodStart, periodEnd);
    let running = openingNet;
    const cashflowSeries = buckets.map((bucket) => {
      const bucketRows = external.filter((row) =>
        inRange(row.occurredAt, bucket.startAt, bucket.endAt),
      );
      const inflow = sumBy(
        bucketRows.filter((row) => row.direction === "in"),
        (row) => row.amount,
      );
      const outflow = sumBy(
        bucketRows.filter((row) => row.direction === "out"),
        (row) => row.amount,
      );
      running += inflow - outflow;
      return {
        key: bucket.key,
        label: bucket.label,
        inflow,
        outflow,
        balance: running,
      };
    });

    const periodNetCashflow = cashflowSeries.reduce(
      (sum, bucket) => sum + bucket.inflow - bucket.outflow,
      0,
    );

    const bankNameMap = new Map(
      banks.map((row) => [row._id as string, row.name]),
    );
    const fundNameMap = new Map(
      funds.map((row) => [row._id as string, row.name]),
    );
    const recentTransactions = scopedMovements
      .filter((row) => row.occurredAt <= now)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 15)
      .map((row) => ({
        _id: row._id as string,
        occurredAt: row.occurredAt,
        description: row.description,
        direction: row.direction,
        amount: row.amount,
        accountName:
          row.accountType === "bank"
            ? (bankNameMap.get(row.bankAccountId as string) ?? "بانک")
            : (fundNameMap.get(row.cashFundId as string) ?? "صندوق"),
        accountType: row.accountType,
        operationType: row.operationType,
        accountingDocumentId: row.accountingDocumentId
          ? (row.accountingDocumentId as string)
          : null,
      }));

    return {
      businessName: business.name,
      currency: business.currency,
      period: {
        from: periodStart,
        to: periodEnd,
        label: `${jalaliDateLabel(periodStart)} تا ${jalaliDateLabel(periodEnd)}`,
      },
      metrics: {
        totalBank,
        totalCash,
        todayReceipts,
        todayPayments,
        receivables,
        payables,
        receivedChecks: sumBy(openReceivedChecks, (row) => row.amount),
        receivedChecksCount: openReceivedChecks.length,
        issuedChecks: sumBy(openIssuedChecks, (row) => row.amount),
        issuedChecksCount: openIssuedChecks.length,
        dueSoonAmount: sumBy(dueSoon, (row) => row.amount),
        dueSoonCount: dueSoon.length,
        monthIncome: monthIncomes + monthSales,
        monthExpense: monthExpenses,
        netCashflow: periodNetCashflow,
      },
      cashflowSeries,
      dueSoon: dueSoon.slice(0, 8),
      recentTransactions,
      banks: banks.map((row) => ({
        _id: row._id as string,
        name: row.name,
        bankName: row.bankName,
        active: row.active,
        balance: bankBalances.get(row._id as string) ?? 0,
      })),
      funds: funds.map((row) => ({
        _id: row._id as string,
        name: row.name,
        responsibleName: row.responsibleName ?? null,
        active: row.active,
        balance: cashBalances.get(row._id as string) ?? 0,
      })),
    };
  },
});

export const receivables = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(5000);
    const scoped = invoices.filter(
      (row) =>
        (!args.branchId || row.branchId === args.branchId) &&
        (row.status === "issued" || row.status === "paid"),
    );
    const customerIds = [...new Set(scoped.map((row) => row.customerId))];
    const customers = await Promise.all(
      customerIds.map((id) => ctx.db.get(id)),
    );
    const customerMap = new Map(
      customers
        .filter((row): row is Doc<"customers"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const now = Date.now();
    const groups = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        phone: string | null;
        total: number;
        paid: number;
        outstanding: number;
        invoiceCount: number;
        dueDate: number | null;
        overdue: boolean;
        invoices: {
          id: string;
          number: string;
          outstanding: number;
          dueDate: number | null;
        }[];
      }
    >();
    for (const invoice of scoped) {
      const key = invoice.customerId as string;
      const customer = customerMap.get(key);
      const outstanding = invoiceOutstanding(invoice);
      const existing = groups.get(key) ?? {
        customerId: key,
        customerName: customer?.name ?? "—",
        phone: customer?.phone ?? null,
        total: 0,
        paid: 0,
        outstanding: 0,
        invoiceCount: 0,
        dueDate: null,
        overdue: false,
        invoices: [],
      };
      if (outstanding > 0) {
        existing.invoices.push({
          id: invoice._id as string,
          number: invoice.number,
          outstanding,
          dueDate: invoice.dueDate ?? null,
        });
      }
      existing.total += invoice.total;
      existing.paid += invoice.paidAmount ?? 0;
      existing.outstanding += outstanding;
      existing.invoiceCount += 1;
      if (
        outstanding > 0 &&
        invoice.dueDate &&
        (existing.dueDate === null || invoice.dueDate < existing.dueDate)
      ) {
        existing.dueDate = invoice.dueDate;
      }
      if (outstanding > 0 && invoice.dueDate && invoice.dueDate < now) {
        existing.overdue = true;
      }
      groups.set(key, existing);
    }
    const needle = args.search?.trim().toLowerCase();
    const rows = [...groups.values()]
      .filter((row) => row.outstanding > 0)
      .filter((row) => {
        if (!needle) return true;
        return `${row.customerName} ${row.phone ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.outstanding - a.outstanding);
    return {
      rows,
      totals: {
        total: sumBy(rows, (row) => row.total),
        paid: sumBy(rows, (row) => row.paid),
        outstanding: sumBy(rows, (row) => row.outstanding),
        overdue: rows.filter((row) => row.overdue).length,
      },
    };
  },
});

export const payables = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const expenses = await ctx.db
      .query("expenseRecords")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(5000);
    const scoped = expenses.filter(
      (row) =>
        (!args.branchId || row.branchId === args.branchId) &&
        (row.status === "approved" || row.status === "paid"),
    );
    const now = Date.now();
    const groups = new Map<
      string,
      {
        supplierName: string;
        total: number;
        paid: number;
        outstanding: number;
        count: number;
        dueDate: number | null;
        overdue: boolean;
        expenses: {
          id: string;
          number: string;
          outstanding: number;
          dueDate: number | null;
        }[];
      }
    >();
    for (const expense of scoped) {
      const key = expense.supplierName?.trim() || "بدون تأمین‌کننده";
      const existing = groups.get(key) ?? {
        supplierName: key,
        total: 0,
        paid: 0,
        outstanding: 0,
        count: 0,
        dueDate: null,
        overdue: false,
        expenses: [],
      };
      const outstanding = expenseOutstanding(expense);
      if (outstanding > 0) {
        existing.expenses.push({
          id: expense._id as string,
          number: expense.number,
          outstanding,
          dueDate: expense.dueDate ?? null,
        });
      }
      existing.total += expense.amount;
      existing.paid += expense.paidAmount;
      existing.outstanding += outstanding;
      existing.count += 1;
      if (
        outstanding > 0 &&
        expense.dueDate &&
        (existing.dueDate === null || expense.dueDate < existing.dueDate)
      ) {
        existing.dueDate = expense.dueDate;
      }
      if (outstanding > 0 && expense.dueDate && expense.dueDate < now) {
        existing.overdue = true;
      }
      groups.set(key, existing);
    }
    const needle = args.search?.trim().toLowerCase();
    const rows = [...groups.values()]
      .filter((row) => row.outstanding > 0)
      .filter((row) =>
        needle
          ? row.supplierName.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => b.outstanding - a.outstanding);
    return {
      rows,
      totals: {
        total: sumBy(rows, (row) => row.total),
        paid: sumBy(rows, (row) => row.paid),
        outstanding: sumBy(rows, (row) => row.outstanding),
        overdue: rows.filter((row) => row.overdue).length,
      },
    };
  },
});

/** Party statement for receivables (customer) and payables (supplier name). */
export const partyStatement = query({
  args: {
    businessId: v.id("businesses"),
    kind: v.union(v.literal("customer"), v.literal("supplier")),
    partyId: v.optional(v.string()),
    partyName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows: {
      id: string;
      date: number;
      number: string;
      description: string;
      debit: number;
      credit: number;
      status: string;
      href: string | null;
    }[] = [];
    if (args.kind === "customer") {
      if (!args.partyId) throw new ConvexError("مشتری را انتخاب کنید.");
      const customerId = args.partyId as Id<"customers">;
      const [invoices, receipts] = await Promise.all([
        ctx.db
          .query("invoices")
          .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
          .take(5000),
        ctx.db
          .query("receipts")
          .withIndex("by_business_occurred", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(5000),
      ]);
      for (const invoice of invoices) {
        if (invoice.customerId !== customerId || invoice.status === "void") continue;
        rows.push({
          id: invoice._id as string,
          date: invoice.issueDate,
          number: invoice.number,
          description: `فاکتور فروش${invoice.dueDate ? ` — سررسید ${jalaliDateLabel(invoice.dueDate)}` : ""}`,
          debit: invoice.total,
          credit: 0,
          status: invoice.status,
          href: `/dashboard/invoices`,
        });
      }
      for (const receipt of receipts) {
        if (receipt.customerId !== customerId || receipt.status !== "posted") {
          continue;
        }
        rows.push({
          id: receipt._id as string,
          date: receipt.occurredAt,
          number: receipt.number,
          description: receipt.description,
          debit: 0,
          credit: receipt.amount,
          status: receipt.status,
          href: receipt.accountingDocumentId
            ? `/dashboard/accounting/documents/${receipt.accountingDocumentId}`
            : null,
        });
      }
    } else {
      const supplier = args.partyName?.trim() || "بدون تأمین‌کننده";
      const [expenses, payments] = await Promise.all([
        ctx.db
          .query("expenseRecords")
          .withIndex("by_business_occurred", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(5000),
        ctx.db
          .query("paymentVouchers")
          .withIndex("by_business_occurred", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(5000),
      ]);
      for (const expense of expenses) {
        if ((expense.supplierName?.trim() || "بدون تأمین‌کننده") !== supplier) {
          continue;
        }
        if (expense.status !== "approved" && expense.status !== "paid") continue;
        rows.push({
          id: expense._id as string,
          date: expense.occurredAt,
          number: expense.number,
          description: expense.description,
          debit: 0,
          credit: expense.amount,
          status: expense.status,
          href: expense.accountingDocumentId
            ? `/dashboard/accounting/documents/${expense.accountingDocumentId}`
            : null,
        });
      }
      for (const payment of payments) {
        if (payment.status !== "posted") continue;
        if ((payment.partyName.trim() || "بدون تأمین‌کننده") !== supplier) {
          continue;
        }
        rows.push({
          id: payment._id as string,
          date: payment.occurredAt,
          number: payment.number,
          description: payment.description,
          debit: payment.amount,
          credit: 0,
          status: payment.status,
          href: payment.accountingDocumentId
            ? `/dashboard/accounting/documents/${payment.accountingDocumentId}`
            : null,
        });
      }
    }
    rows.sort((a, b) => a.date - b.date);
    const debit = sumBy(rows, (row) => row.debit);
    const credit = sumBy(rows, (row) => row.credit);
    return {
      rows,
      totals: { debit, credit, balance: debit - credit },
    };
  },
});

interface ReportRow {
  id: string;
  date: number;
  number: string;
  party: string;
  description: string;
  account: string;
  debit: number;
  credit: number;
  amount: number;
  status: string;
  extra: string | null;
  href: string | null;
}

function reportTitle(kind: string) {
  const titles: Record<string, string> = {
    "bank-ledger": "گردش حساب بانکی",
    "cash-ledger": "گردش صندوق",
    receipts: "گزارش دریافت‌ها",
    payments: "گزارش پرداخت‌ها",
    incomes: "گزارش درآمدها",
    expenses: "گزارش هزینه‌ها",
    "received-checks": "گزارش چک‌های دریافتی",
    "issued-checks": "گزارش چک‌های پرداختی",
    receivables: "گزارش مطالبات",
    payables: "گزارش بدهی‌ها",
    cashflow: "گزارش جریان نقدینگی",
    transfers: "گزارش انتقال وجه",
  };
  return titles[kind] ?? "گزارش مالی";
}

export const report = query({
  args: {
    businessId: v.id("businesses"),
    kind: reportKindValidator,
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    accountType: v.optional(v.union(v.literal("bank"), v.literal("cash"))),
    accountRefId: v.optional(v.string()),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const branchId = args.branchId;
    const from = args.from;
    const to = args.to;
    if (
      (from !== undefined && !Number.isFinite(from)) ||
      (to !== undefined && !Number.isFinite(to))
    ) {
      throw new ConvexError("بازه گزارش معتبر نیست.");
    }
    const needle = args.search?.trim().toLowerCase();
    let rows: ReportRow[] = [];
    let openingBalance: number | null = null;

    if (args.kind === "bank-ledger" || args.kind === "cash-ledger") {
      const type = args.kind === "bank-ledger" ? "bank" : "cash";
      if (!args.accountRefId) {
        throw new ConvexError("حساب مالی را انتخاب کنید.");
      }
      const refId = args.accountRefId;
      const account =
        type === "bank"
          ? await ctx.db.get(refId as Id<"bankAccounts">)
          : await ctx.db.get(refId as Id<"cashFunds">);
      if (!account || account.businessId !== args.businessId) {
        throw new ConvexError("حساب مالی یافت نشد.");
      }
      const allRows = await ctx.db
        .query("financialTransactions")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(10000);
      const relevant = allRows
        .filter((row) =>
          type === "bank"
            ? row.bankAccountId === refId
            : row.cashFundId === refId,
        )
        .filter((row) => !branchId || row.branchId === branchId)
        .sort((a, b) => a.occurredAt - b.occurredAt);
      openingBalance = sumBy(
        relevant.filter((row) => from !== undefined && row.occurredAt < from),
        (row) => (row.direction === "in" ? row.amount : -row.amount),
      );
      let running = openingBalance;
      rows = relevant
        .filter((row) => inRange(row.occurredAt, from, to))
        .map((row) => {
          running += row.direction === "in" ? row.amount : -row.amount;
          return {
            id: row._id as string,
            date: row.occurredAt,
            number: row.operationId ?? "—",
            party: account.name,
            description: row.description,
            account: account.name,
            debit: row.direction === "in" ? row.amount : 0,
            credit: row.direction === "out" ? row.amount : 0,
            amount: row.amount,
            status: row.operationType,
            extra: `مانده ${running}`,
            href: row.accountingDocumentId
              ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
              : null,
          };
        });
    } else if (args.kind === "receipts") {
      const rowsRaw = await ctx.db
        .query("receipts")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.occurredAt, from, to))
        .filter((row) =>
          !args.accountRefId
            ? true
            : args.accountType === "cash"
              ? row.cashFundId === args.accountRefId
              : row.bankAccountId === args.accountRefId,
        )
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.number,
          party: row.partyName,
          description: row.description,
          account: row.method,
          debit: row.amount,
          credit: 0,
          amount: row.amount,
          status: row.status,
          extra: row.trackingNumber ?? null,
          href: row.accountingDocumentId
            ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "payments") {
      const rowsRaw = await ctx.db
        .query("paymentVouchers")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.occurredAt, from, to))
        .filter((row) =>
          !args.accountRefId
            ? true
            : args.accountType === "cash"
              ? row.cashFundId === args.accountRefId
              : row.bankAccountId === args.accountRefId,
        )
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.number,
          party: row.partyName,
          description: row.description,
          account: row.method,
          debit: 0,
          credit: row.amount,
          amount: row.amount,
          status: row.status,
          extra: row.trackingNumber ?? null,
          href: row.accountingDocumentId
            ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "incomes") {
      const rowsRaw = await ctx.db
        .query("incomeRecords")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.occurredAt, from, to))
        .filter((row) =>
          !args.accountRefId
            ? true
            : args.accountType === "cash"
              ? row.cashFundId === args.accountRefId
              : row.bankAccountId === args.accountRefId,
        )
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.number,
          party: row.partyName ?? "—",
          description: row.description,
          account: row.category,
          debit: row.amount,
          credit: 0,
          amount: row.amount,
          status: row.status,
          extra: null,
          href: row.accountingDocumentId
            ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "expenses") {
      const rowsRaw = await ctx.db
        .query("expenseRecords")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.occurredAt, from, to))
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.number,
          party: row.supplierName ?? "—",
          description: row.description,
          account: row.category,
          debit: 0,
          credit: row.amount,
          amount: row.amount,
          status: row.status,
          extra: `پرداخت‌شده ${row.paidAmount}`,
          href: row.accountingDocumentId
            ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "received-checks") {
      const rowsRaw = await ctx.db
        .query("receivedChecks")
        .withIndex("by_business_due", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.issueDate, from, to))
        .map((row) => ({
          id: row._id as string,
          date: row.issueDate,
          number: row.checkNumber,
          party: row.issuerName,
          description: row.description ?? "چک دریافتی",
          account: row.bankName,
          debit: row.amount,
          credit: 0,
          amount: row.amount,
          status: row.status,
          extra: `سررسید ${jalaliDateLabel(row.dueDate)}`,
          href: row.lastAccountingDocumentId
            ? `/dashboard/accounting/documents/${row.lastAccountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "issued-checks") {
      const rowsRaw = await ctx.db
        .query("issuedChecks")
        .withIndex("by_business_due", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.issueDate, from, to))
        .map((row) => ({
          id: row._id as string,
          date: row.issueDate,
          number: row.checkNumber,
          party: row.payeeName,
          description: row.description ?? "چک پرداختی",
          account: "حساب بانکی",
          debit: 0,
          credit: row.amount,
          amount: row.amount,
          status: row.status,
          extra: `سررسید ${jalaliDateLabel(row.dueDate)}`,
          href: row.lastAccountingDocumentId
            ? `/dashboard/accounting/documents/${row.lastAccountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "receivables") {
      const rowsRaw = await ctx.db
        .query("invoices")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      const customerIds = [
        ...new Set(rowsRaw.map((row) => row.customerId)),
      ];
      const customers = await Promise.all(
        customerIds.map((id) => ctx.db.get(id)),
      );
      const names = new Map(
        customers
          .filter((row): row is Doc<"customers"> => Boolean(row))
          .map((row) => [row._id as string, row.name]),
      );
      rows = rowsRaw
        .filter(
          (row) =>
            (!branchId || row.branchId === branchId) &&
            (row.status === "issued" || row.status === "paid") &&
            inRange(row.issueDate, from, to),
        )
        .map((row) => ({
          id: row._id as string,
          date: row.issueDate,
          number: row.number,
          party: names.get(row.customerId as string) ?? "—",
          description: "فاکتور فروش",
          account: row.status === "paid" ? "تسویه‌شده" : "دریافتنی",
          debit: invoiceOutstanding(row),
          credit: row.paidAmount ?? 0,
          amount: row.total,
          status: row.status,
          extra: row.dueDate
            ? `سررسید ${jalaliDateLabel(row.dueDate)}`
            : null,
          href: `/dashboard/invoices?invoice=${row._id}`,
        }));
    } else if (args.kind === "payables") {
      const rowsRaw = await ctx.db
        .query("expenseRecords")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter(
          (row) =>
            (!branchId || row.branchId === branchId) &&
            (row.status === "approved" || row.status === "paid") &&
            inRange(row.occurredAt, from, to),
        )
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.number,
          party: row.supplierName ?? "—",
          description: row.description,
          account: row.category,
          debit: row.paidAmount,
          credit: expenseOutstanding(row),
          amount: row.amount,
          status: row.status,
          extra: row.dueDate
            ? `سررسید ${jalaliDateLabel(row.dueDate)}`
            : null,
          href: row.accountingDocumentId
            ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
            : null,
        }));
    } else if (args.kind === "cashflow") {
      const rowsRaw = await ctx.db
        .query("financialTransactions")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(10000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.occurredAt, from, to))
        .filter((row) =>
          !args.accountRefId
            ? true
            : args.accountType === "cash"
              ? row.cashFundId === args.accountRefId
              : row.bankAccountId === args.accountRefId,
        )
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.operationId ?? "—",
          party: row.accountType === "bank" ? "بانک" : "صندوق",
          description: row.description,
          account: row.operationType,
          debit: row.direction === "in" ? row.amount : 0,
          credit: row.direction === "out" ? row.amount : 0,
          amount: row.amount,
          status: row.operationType,
          extra: null,
          href: row.accountingDocumentId
            ? `/dashboard/accounting/documents/${row.accountingDocumentId}`
            : null,
        }));
    } else {
      const rowsRaw = await ctx.db
        .query("fundTransfers")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(5000);
      rows = rowsRaw
        .filter((row) => !branchId || row.branchId === branchId)
        .filter((row) => inRange(row.occurredAt, from, to))
        .map((row) => ({
          id: row._id as string,
          date: row.occurredAt,
          number: row.number,
          party: `${row.fromType === "bank" ? "بانک" : "صندوق"} به ${
            row.toType === "bank" ? "بانک" : "صندوق"
          }`,
          description: row.description,
          account: "انتقال",
          debit: row.amount,
          credit: row.amount,
          amount: row.amount,
          status: "posted",
          extra: `کارمزد ${row.fee}`,
          href: `/dashboard/accounting/documents/${row.accountingDocumentId}`,
        }));
    }

    if (needle) {
      rows = rows.filter((row) =>
        [
          row.number,
          row.party,
          row.description,
          row.account,
          row.status,
          row.extra,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
      );
    }
    const debit = sumBy(rows, (row) => row.debit);
    const credit = sumBy(rows, (row) => row.credit);
    const amount = sumBy(rows, (row) => row.amount);
    const pageSize = Math.min(
      100,
      Math.max(10, Math.round(args.pageSize ?? 25)),
    );
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.round(args.page ?? 1)));
    const items = rows.slice((page - 1) * pageSize, page * pageSize);
    return {
      kind: args.kind,
      title: reportTitle(args.kind),
      rows: items,
      total: rows.length,
      page,
      pageCount,
      pageSize,
      totals: { debit, credit, amount, difference: debit - credit },
      openingBalance,
      closingBalance:
        openingBalance !== null ? openingBalance + debit - credit : null,
    };
  },
});
