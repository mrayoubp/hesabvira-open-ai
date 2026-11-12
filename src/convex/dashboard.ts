import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership } from "./lib/tenant";
import {
  dayBucketsBetween,
  getPeriodRange,
  jalaliDateLabel,
  monthBucketsBetween,
  type PeriodKey,
  weekBucketsBetween,
} from "./lib/calendar";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

const periodValidator = v.union(
  v.literal("today"),
  v.literal("week"),
  v.literal("month"),
  v.literal("lastMonth"),
  v.literal("quarter"),
  v.literal("year"),
  v.literal("custom"),
);

const granularityValidator = v.union(
  v.literal("day"),
  v.literal("week"),
  v.literal("month"),
);

type Bucket = { key: string; label: string; startAt: number; endAt: number };

function sumBy<T>(rows: T[], getValue: (row: T) => number) {
  return rows.reduce((total, row) => total + getValue(row), 0);
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function getBuckets(
  granularity: "day" | "week" | "month",
  startAt: number,
  endAt: number,
): Bucket[] {
  if (granularity === "day") return dayBucketsBetween(startAt, endAt);
  if (granularity === "week") return weekBucketsBetween(startAt, endAt);
  return monthBucketsBetween(startAt, endAt);
}

function adaptiveFlowBuckets(startAt: number, endAt: number): Bucket[] {
  const days = Math.max(1, (endAt - startAt) / DAY_MS);
  return days <= 62
    ? dayBucketsBetween(startAt, endAt)
    : monthBucketsBetween(startAt, endAt);
}

const ACTION_META: Record<
  string,
  { label: string; kind: "invoice" | "customer" | "payment" | "transaction" }
> = {
  "invoice.draft": { label: "پیش‌نویس فاکتور فروش", kind: "invoice" },
  "invoice.issue": { label: "صدور فاکتور فروش", kind: "invoice" },
  "invoice.paid": { label: "تسویه فاکتور", kind: "invoice" },
  "invoice.void": { label: "ابطال فاکتور", kind: "invoice" },
  "customer.create": { label: "ثبت مشتری", kind: "customer" },
  "customer.update": { label: "ویرایش مشتری", kind: "customer" },
  "payment.receipt": { label: "دریافت وجه", kind: "payment" },
  "transaction.income": { label: "ثبت درآمد", kind: "transaction" },
  "transaction.expense": { label: "ثبت هزینه", kind: "transaction" },
};

/**
 * Single server-side reporting query for the management dashboard.
 *
 * Tenant isolation is enforced by requireMembership. Aggregation is done here
 * so the client never downloads another business's records, and every value
 * is derived from actual documents. Modules that do not exist yet are marked
 * unavailable rather than filled with demo data.
 */
export const overview = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    period: periodValidator,
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    salesGranularity: v.optional(granularityValidator),
  },
  handler: async (ctx, args) => {
    const { business, membership } = await requireMembership(
      ctx,
      args.businessId,
    );

    const now = Date.now();
    if (
      (args.from !== undefined && !Number.isFinite(args.from)) ||
      (args.to !== undefined && !Number.isFinite(args.to))
    ) {
      throw new ConvexError("بازه تاریخ ارسال‌شده معتبر نیست.");
    }
    const period = getPeriodRange(args.period as PeriodKey, now, {
      from: args.from,
      to: args.to,
    });
    if (period.key === "custom" && period.endAt - period.startAt > 731 * DAY_MS) {
      throw new ConvexError(
        "بازه دلخواه حداکثر دو سال را پشتیبانی می‌کند؛ برای بازه‌های بلندتر از گزارش سالانه استفاده کنید.",
      );
    }

    const [
      invoices,
      customers,
      payments,
      transactions,
      branches,
      fiscalYears,
      accountingDocuments,
    ] = await Promise.all([
        ctx.db
          .query("invoices")
          .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
          .take(MAX_ROWS),
        ctx.db
          .query("customers")
          .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
          .take(2000),
        ctx.db
          .query("payments")
          .withIndex("by_business_occurred", (q) =>
            q.eq("businessId", args.businessId),
          )
          .order("desc")
          .take(MAX_ROWS),
        ctx.db
          .query("transactions")
          .withIndex("by_business_occurred", (q) =>
            q.eq("businessId", args.businessId),
          )
          .order("desc")
          .take(MAX_ROWS),
        ctx.db
          .query("branches")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .collect(),
        ctx.db
          .query("fiscalYears")
          .withIndex("by_business", (q) =>
            q.eq("businessId", args.businessId),
          )
          .collect(),
        args.fiscalYearId
          ? ctx.db
              .query("accountingDocuments")
              .withIndex("by_business_fiscal", (q) =>
                q
                  .eq("businessId", args.businessId)
                  .eq("fiscalYearId", args.fiscalYearId as Id<"fiscalYears">),
              )
              .order("desc")
              .take(3000)
          : ctx.db
              .query("accountingDocuments")
              .withIndex("by_business_date", (q) =>
                q.eq("businessId", args.businessId),
              )
              .order("desc")
              .take(3000),
      ]);

    const [
      purchaseInvoices,
      salesReturns,
      products,
      inventoryTransactions,
      suppliers,
    ] = await Promise.all([
      ctx.db
        .query("purchaseInvoices")
        .withIndex("by_business_date", (q) => q.eq("businessId", args.businessId))
        .take(3000),
      ctx.db
        .query("salesReturns")
        .withIndex("by_business_occurred", (q) => q.eq("businessId", args.businessId))
        .take(2000),
      ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(2000),
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_business_occurred", (q) => q.eq("businessId", args.businessId))
        .take(8000),
      ctx.db
        .query("suppliers")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(1500),
    ]);

    const primaryBranch = branches.find((branch) => branch.isPrimary);
    const selectedFiscalYear = args.fiscalYearId
      ? fiscalYears.find((year) => year._id === args.fiscalYearId)
      : undefined;

    const matchesBranch = (branchId?: Id<"branches">) => {
      if (!args.branchId) return true;
      if (branchId) return branchId === args.branchId;
      return primaryBranch?._id === args.branchId;
    };

    const matchesFiscalYear = (
      fiscalYearId: Id<"fiscalYears"> | undefined,
      timestamp: number,
    ) => {
      if (!args.fiscalYearId) return true;
      if (fiscalYearId) return fiscalYearId === args.fiscalYearId;
      return Boolean(
        selectedFiscalYear &&
          timestamp >= selectedFiscalYear.startAt &&
          timestamp <= selectedFiscalYear.endAt,
      );
    };

    const inScope = (branchId?: Id<"branches">, fiscalYearId?: Id<"fiscalYears">, timestamp = now) =>
      matchesBranch(branchId) && matchesFiscalYear(fiscalYearId, timestamp);

    const scopedInvoices = invoices.filter(
      (invoice) =>
        inScope(invoice.branchId, invoice.fiscalYearId, invoice.issueDate) &&
        invoice.issueDate <= now,
    );
    const periodInvoices = scopedInvoices.filter(
      (invoice) =>
        invoice.issueDate >= period.startAt &&
        invoice.issueDate <= period.endAt,
    );
    const previousInvoices = scopedInvoices.filter(
      (invoice) =>
        invoice.issueDate >= period.previousStartAt &&
        invoice.issueDate <= period.previousEndAt,
    );

    const scopedAccountingDocuments = accountingDocuments.filter(
      (document) =>
        matchesBranch(document.branchId) &&
        (!args.fiscalYearId ||
          document.fiscalYearId === args.fiscalYearId),
    );
    const finalizedAccountingDocuments = scopedAccountingDocuments.filter(
      (document) =>
        document.status === "posted" || document.status === "reversed",
    );
    const accountingLineGroups = await Promise.all(
      finalizedAccountingDocuments.map((document) =>
        ctx.db
          .query("accountingDocumentLines")
          .withIndex("by_document", (q) => q.eq("documentId", document._id))
          .collect(),
      ),
    );
    const accountingLines = accountingLineGroups.flat();
    const accountingDebit = accountingLines.reduce(
      (sum, line) => sum + line.debit,
      0,
    );
    const accountingCredit = accountingLines.reduce(
      (sum, line) => sum + line.credit,
      0,
    );
    const accountingDifference = accountingDebit - accountingCredit;
    const accountingDraft = scopedAccountingDocuments.filter(
      (document) => document.status === "draft",
    ).length;
    const accountingPending = scopedAccountingDocuments.filter(
      (document) => document.status === "pending",
    ).length;

    const scopedPayments = payments.filter((payment) =>
      inScope(payment.branchId, payment.fiscalYearId, payment.occurredAt),
    );
    const scopedTransactions = transactions.filter((transaction) =>
      inScope(
        transaction.branchId,
        transaction.fiscalYearId,
        transaction.occurredAt,
      ),
    );

    const salesInvoices = (rows: Doc<"invoices">[]) =>
      rows.filter(
        (invoice) => invoice.status === "issued" || invoice.status === "paid",
      );

    const periodSalesInvoices = salesInvoices(periodInvoices);
    const previousSalesInvoices = salesInvoices(previousInvoices);

    const totalSales = sumBy(periodSalesInvoices, (invoice) => invoice.total);
    const previousSales = sumBy(
      previousSalesInvoices,
      (invoice) => invoice.total,
    );

    const periodExpenses = scopedTransactions.filter(
      (transaction) =>
        transaction.kind === "expense" &&
        transaction.occurredAt >= period.startAt &&
        transaction.occurredAt <= period.endAt,
    );
    const periodIncome = scopedTransactions.filter(
      (transaction) =>
        transaction.kind === "income" &&
        transaction.occurredAt >= period.startAt &&
        transaction.occurredAt <= period.endAt,
    );
    const previousExpenses = scopedTransactions.filter(
      (transaction) =>
        transaction.kind === "expense" &&
        transaction.occurredAt >= period.previousStartAt &&
        transaction.occurredAt <= period.previousEndAt,
    );
    const previousIncome = scopedTransactions.filter(
      (transaction) =>
        transaction.kind === "income" &&
        transaction.occurredAt >= period.previousStartAt &&
        transaction.occurredAt <= period.previousEndAt,
    );

    const totalIncome = sumBy(periodIncome, (transaction) => transaction.amount);
    const totalExpenses = sumBy(periodExpenses, (transaction) => transaction.amount);
    const previousIncomeTotal = sumBy(
      previousIncome,
      (transaction) => transaction.amount,
    );
    const previousExpensesTotal = sumBy(
      previousExpenses,
      (transaction) => transaction.amount,
    );

    const scopedPurchases = purchaseInvoices.filter(
      (row) =>
        inScope(row.branchId, row.fiscalYearId, row.issueDate) &&
        row.status !== "draft" &&
        row.status !== "cancelled",
    );
    const periodPurchases = scopedPurchases.filter(
      (row) => row.issueDate >= period.startAt && row.issueDate <= period.endAt && row.kind === "purchase",
    );
    const previousPurchases = scopedPurchases.filter(
      (row) => row.issueDate >= period.previousStartAt && row.issueDate <= period.previousEndAt && row.kind === "purchase",
    );
    const periodPurchaseReturns = scopedPurchases.filter(
      (row) => row.issueDate >= period.startAt && row.issueDate <= period.endAt && row.kind === "return",
    );
    const totalPurchases = sumBy(periodPurchases, (row) => row.total) - sumBy(periodPurchaseReturns, (row) => row.total);
    const previousPurchasesTotal = sumBy(previousPurchases, (row) => row.total);
    const payables = scopedPurchases
      .filter((row) => row.kind === "purchase")
      .reduce((sum, row) => sum + Math.max(0, row.total - row.paidAmount - (row.returnedAmount ?? 0)), 0);
    const scopedSalesReturns = salesReturns.filter(
      (row) =>
        row.occurredAt >= period.startAt &&
        row.occurredAt <= period.endAt &&
        matchesBranch(row.branchId) &&
        (!args.fiscalYearId || row.fiscalYearId === args.fiscalYearId),
    );
    const salesReturnsTotal = sumBy(scopedSalesReturns, (row) => row.total);
    const cogs = sumBy(periodSalesInvoices, (invoice) => invoice.costOfGoods ?? 0) -
      sumBy(scopedSalesReturns, (row) => row.costOfGoods);
    const salesProfit = totalSales - salesReturnsTotal - cogs;
    const netProfit = salesProfit + totalIncome - totalExpenses;
    const previousProfit =
      previousSales + previousIncomeTotal - previousExpensesTotal;

    const stockMap = new Map<string, number>();
    for (const row of inventoryTransactions) {
      const key = row.productId as string;
      stockMap.set(
        key,
        (stockMap.get(key) ?? 0) +
          (row.direction === "in" ? row.quantityMilli : -row.quantityMilli),
      );
    }
    const inventoryValue = inventoryTransactions.reduce(
      (sum, row) =>
        sum + (row.direction === "in" ? row.value : -row.value),
      0,
    );
    const stockQuantity = [...stockMap.values()].reduce((sum, value) => sum + value, 0);
    const lowStockCount = products.filter((product) => {
      if (!product.active || product.productType === "service") return false;
      return (stockMap.get(product._id as string) ?? 0) <= product.minStockMilli;
    }).length;

    // Snapshot balances as of now, respecting branch and fiscal-year scope.
    let cashBalance = 0;
    let bankBalance = 0;
    for (const payment of scopedPayments) {
      if (payment.occurredAt > now) continue;
      const sign = payment.direction === "receipt" ? 1 : -1;
      if (payment.method === "cash") cashBalance += sign * payment.amount;
      if (payment.method === "bank") bankBalance += sign * payment.amount;
    }
    for (const transaction of scopedTransactions) {
      if (transaction.occurredAt > now) continue;
      if (transaction.method === "accrual") continue;
      const sign = transaction.kind === "income" ? 1 : -1;
      if (transaction.method === "cash") cashBalance += sign * transaction.amount;
      if (transaction.method === "bank") bankBalance += sign * transaction.amount;
    }

    const openInvoices = periodInvoices.filter(
      (invoice) => invoice.status === "issued",
    );
    const receivables = sumBy(openInvoices, (invoice) =>
      Math.max(
        0,
        invoice.total -
          (invoice.returnedAmount ?? 0) -
          (invoice.paidAmount ?? 0),
      ),
    );

    const activeFiscalYear =
      selectedFiscalYear ??
      fiscalYears.find(
        (year) =>
          year.status === "open" &&
          year.startAt <= now &&
          year.endAt >= now,
      ) ??
      fiscalYears[0];

    // Sales chart, honouring the selected granularity.
    const salesGranularity =
      (args.salesGranularity as "day" | "week" | "month" | undefined) ??
      ((period.endAt - period.startAt) / DAY_MS <= 45
        ? "day"
        : (period.endAt - period.startAt) / DAY_MS <= 180
          ? "week"
          : "month");
    const salesBuckets = getBuckets(
      salesGranularity,
      period.startAt,
      period.endAt,
    );
    const salesSeries = salesBuckets.map((bucket) => {
      const rows = periodSalesInvoices.filter(
        (invoice) =>
          invoice.issueDate >= bucket.startAt &&
          invoice.issueDate <= bucket.endAt,
      );
      return {
        key: bucket.key,
        label: bucket.label,
        sales: sumBy(rows, (invoice) => invoice.total),
        invoiceCount: rows.length,
      };
    });

    // Revenue / expense / profit chart. Short ranges use days, longer months.
    const financeBuckets = adaptiveFlowBuckets(period.startAt, period.endAt);
    const financeSeries = financeBuckets.map((bucket) => {
      const invoiceInBucket = periodSalesInvoices.filter(
        (invoice) =>
          invoice.issueDate >= bucket.startAt &&
          invoice.issueDate <= bucket.endAt,
      );
      const incomeInBucket = periodIncome.filter(
        (transaction) =>
          transaction.occurredAt >= bucket.startAt &&
          transaction.occurredAt <= bucket.endAt,
      );
      const expenseInBucket = periodExpenses.filter(
        (transaction) =>
          transaction.occurredAt >= bucket.startAt &&
          transaction.occurredAt <= bucket.endAt,
      );
      const sales = sumBy(invoiceInBucket, (invoice) => invoice.total);
      const otherIncome = sumBy(incomeInBucket, (transaction) => transaction.amount);
      const expense = sumBy(expenseInBucket, (transaction) => transaction.amount);
      return {
        key: bucket.key,
        label: bucket.label,
        revenue: sales + otherIncome,
        expense,
        profit: sales + otherIncome - expense,
      };
    });

    // Cash-flow chart includes cash and bank movements only. Accrual records
    // affect profit but not cash.
    const cashBucketSource = (startAt: number, endAt: number) => {
      const receipts = scopedPayments.filter(
        (payment) =>
          payment.direction === "receipt" &&
          payment.occurredAt >= startAt &&
          payment.occurredAt <= endAt,
      );
      const outflows = scopedPayments.filter(
        (payment) =>
          payment.direction === "payment" &&
          payment.occurredAt >= startAt &&
          payment.occurredAt <= endAt,
      );
      const cashIncome = scopedTransactions.filter(
        (transaction) =>
          transaction.kind === "income" &&
          transaction.method !== "accrual" &&
          transaction.occurredAt >= startAt &&
          transaction.occurredAt <= endAt,
      );
      const cashExpenses = scopedTransactions.filter(
        (transaction) =>
          transaction.kind === "expense" &&
          transaction.method !== "accrual" &&
          transaction.occurredAt >= startAt &&
          transaction.occurredAt <= endAt,
      );
      return {
        inflow:
          sumBy(receipts, (payment) => payment.amount) +
          sumBy(cashIncome, (transaction) => transaction.amount),
        outflow:
          sumBy(outflows, (payment) => payment.amount) +
          sumBy(cashExpenses, (transaction) => transaction.amount),
      };
    };

    const opening = cashBucketSource(0, period.startAt - 1);
    let runningBalance = opening.inflow - opening.outflow;
    const cashflowSeries = financeBuckets.map((bucket) => {
      const movement = cashBucketSource(
        Math.max(bucket.startAt, period.startAt),
        Math.min(bucket.endAt, period.endAt),
      );
      runningBalance += movement.inflow - movement.outflow;
      return {
        key: bucket.key,
        label: bucket.label,
        inflow: movement.inflow,
        outflow: movement.outflow,
        balance: runningBalance,
      };
    });

    const statusBuckets = [
      { key: "paid", label: "پرداخت‌شده" },
      { key: "partial", label: "پرداخت جزئی" },
      { key: "unpaid", label: "پرداخت‌نشده" },
      { key: "overdue", label: "سررسید گذشته" },
      { key: "draft", label: "پیش‌نویس" },
      { key: "void", label: "ابطال" },
    ] as const;
    const invoiceStatus = statusBuckets.map((bucket) => {
      const rows = periodInvoices.filter((invoice) => {
        const paidAmount = invoice.paidAmount ?? 0;
        const overdue =
          invoice.status === "issued" &&
          Boolean(invoice.dueDate) &&
          (invoice.dueDate as number) < now;
        switch (bucket.key) {
          case "paid":
            return invoice.status === "paid";
          case "partial":
            return (
              invoice.status === "issued" &&
              !overdue &&
              paidAmount > 0 &&
              paidAmount < invoice.total
            );
          case "unpaid":
            return (
              invoice.status === "issued" &&
              !overdue &&
              paidAmount === 0
            );
          case "overdue":
            return overdue;
          case "draft":
            return invoice.status === "draft";
          case "void":
            return invoice.status === "void";
          default:
            return false;
        }
      });
      return {
        key: bucket.key,
        label: bucket.label,
        count: rows.length,
        amount: sumBy(rows, (invoice) =>
          invoice.status === "issued"
            ? Math.max(
                0,
                invoice.total -
                  (invoice.returnedAmount ?? 0) -
                  (invoice.paidAmount ?? 0),
              )
            : invoice.total,
        ),
      };
    });

    // Audit activity, enriched with the related document and actor.
    const auditLogs = await ctx.db
      .query("auditLogs")
      .withIndex("by_business_created", (q) =>
        q
          .eq("businessId", args.businessId)
          .gte("createdAt", period.startAt)
          .lte("createdAt", period.endAt),
      )
      .order("desc")
      .take(40);

    const invoiceLogIds = auditLogs
      .filter((log) => log.entity === "invoices")
      .map((log) => log.entityId as Id<"invoices">);
    const paymentIds = auditLogs
      .filter((log) => log.entity === "payments")
      .map((log) => log.entityId as Id<"payments">);
    const transactionIds = auditLogs
      .filter((log) => log.entity === "transactions")
      .map((log) => log.entityId as Id<"transactions">);
    const actorIds = [...new Set(auditLogs.map((log) => log.actorId))];

    const [activityPayments, activityTransactions, actors] = await Promise.all([
      Promise.all(paymentIds.map((id) => ctx.db.get(id))),
      Promise.all(transactionIds.map((id) => ctx.db.get(id))),
      Promise.all(actorIds.map((id) => ctx.db.get(id))),
    ]);

    const paymentInvoiceIds = activityPayments
      .filter((row): row is Doc<"payments"> => Boolean(row))
      .map((payment) => payment.invoiceId)
      .filter((id): id is Id<"invoices"> => Boolean(id));
    const invoiceIds = [...new Set([...invoiceLogIds, ...paymentInvoiceIds])];
    const activityInvoices = await Promise.all(
      invoiceIds.map((id) => ctx.db.get(id)),
    );

    const invoiceCustomerIds = activityInvoices
      .filter((row): row is Doc<"invoices"> => Boolean(row))
      .map((invoice) => invoice.customerId);
    const customerIds = [
      ...auditLogs
        .filter((log) => log.entity === "customers")
        .map((log) => log.entityId as Id<"customers">),
      ...invoiceCustomerIds,
    ];
    const uniqueCustomerIds = [...new Set(customerIds)];
    const activityCustomers = await Promise.all(
      uniqueCustomerIds.map((id) => ctx.db.get(id)),
    );

    const paymentMap = new Map(
      activityPayments
        .filter((row): row is Doc<"payments"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const invoiceMap = new Map(
      activityInvoices
        .filter((row): row is Doc<"invoices"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const customerMap = new Map(
      activityCustomers
        .filter((row): row is Doc<"customers"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const transactionMap = new Map(
      activityTransactions
        .filter((row): row is Doc<"transactions"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const actorMap = new Map(
      actors
        .filter((row): row is Doc<"users"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );

    const rawActivity = auditLogs.map((log) => {
      const meta = ACTION_META[log.action] ?? {
        label: log.action,
        kind: "transaction" as const,
      };
      const payment =
        log.entity === "payments"
          ? paymentMap.get(log.entityId)
          : undefined;
      const invoice =
        log.entity === "invoices"
          ? invoiceMap.get(log.entityId)
          : payment?.invoiceId
            ? invoiceMap.get(payment.invoiceId as string)
            : undefined;
      const customer =
        log.entity === "customers"
          ? customerMap.get(log.entityId)
          : invoice
            ? customerMap.get(invoice.customerId as string)
            : undefined;
      const transaction =
        log.entity === "transactions"
          ? transactionMap.get(log.entityId)
          : undefined;
      const actor = actorMap.get(log.actorId as string);
      const scopeBranchId =
        payment?.branchId ??
        invoice?.branchId ??
        transaction?.branchId ??
        primaryBranch?._id;
      const scopeFiscalYearId =
        payment?.fiscalYearId ??
        invoice?.fiscalYearId ??
        transaction?.fiscalYearId;
      const scopeTimestamp =
        invoice?.issueDate ??
        payment?.occurredAt ??
        transaction?.occurredAt ??
        log.createdAt;

      return {
        _id: log._id as string,
        kind: meta.kind,
        actionLabel: meta.label,
        documentNumber: invoice?.number ?? customer?.code ?? "—",
        partyName:
          payment?.partyName ??
          (invoice
            ? (customer?.name ?? "—")
            : (customer?.name ?? transaction?.title ?? "—")),
        amount: payment?.amount ?? invoice?.total ?? transaction?.amount ?? null,
        date: log.createdAt,
        status:
          payment
            ? "receipt"
            : (invoice?.status ??
              (transaction
                ? transaction.kind === "income"
                  ? "income"
                  : "expense"
                : "active")),
        actorName: actor?.name ?? actor?.email ?? "کاربر سیستم",
        summary: log.summary ?? null,
        href: invoice
          ? `/dashboard/invoices?invoice=${invoice._id}`
          : payment
            ? "/dashboard/payments"
            : log.entity === "customers"
              ? `/dashboard/customers?customer=${log.entityId}`
              : "/dashboard/transactions",
        _scopeBranchId: scopeBranchId,
        _scopeFiscalYearId: scopeFiscalYearId,
        _scopeTimestamp: scopeTimestamp,
      };
    });

    const activity = rawActivity
      .filter(
        (row) =>
          matchesBranch(row._scopeBranchId) &&
          matchesFiscalYear(row._scopeFiscalYearId, row._scopeTimestamp),
      )
      .map(
        ({
          _scopeBranchId: _branch,
          _scopeFiscalYearId: _year,
          _scopeTimestamp: _timestamp,
          ...row
        }) => {
          void _branch;
          void _year;
          void _timestamp;
          return row;
        },
      );

    const scopeIssuedInvoices = scopedInvoices.filter(
      (invoice) => invoice.status === "issued",
    );
    const overdueInvoices = scopeIssuedInvoices.filter(
      (invoice) => invoice.dueDate && invoice.dueDate < now,
    );

    const monthlyClosing = activeFiscalYear
      ? Math.ceil(
          Math.max(0, activeFiscalYear.endAt - now) / DAY_MS,
        )
      : null;

    const customerCount = customers.filter(
      (customer) => !customer.archivedAt,
    ).length;

    return {
      businessName: business.name,
      role: membership.role,
      currency: business.currency,
      generatedAt: now,
      period: {
        key: period.key,
        label: period.label,
        startAt: period.startAt,
        endAt: period.endAt,
        previousStartAt: period.previousStartAt,
        previousEndAt: period.previousEndAt,
        display: `${jalaliDateLabel(period.startAt)} تا ${jalaliDateLabel(
          period.endAt,
        )}`,
      },
      fiscalYear: activeFiscalYear
        ? {
            _id: activeFiscalYear._id as string,
            name: activeFiscalYear.name,
            status: activeFiscalYear.status,
            startAt: activeFiscalYear.startAt,
            endAt: activeFiscalYear.endAt,
            daysRemaining: monthlyClosing,
          }
        : null,
      metrics: {
        totalSales,
        totalPurchases,
        totalIncome,
        totalExpenses,
        netProfit,
        salesProfit,
        cashBalance,
        bankBalance,
        receivables,
        payables,
        inventoryValue,
        stockQuantity,
        lowStockCount,
        productCount: products.filter((row) => row.active).length,
        supplierCount: suppliers.filter((row) => row.active).length,
        purchaseInvoiceCount: periodPurchases.length,
        unpaidInvoices: openInvoices.length,
        customerCount,
        invoiceCount: periodInvoices.length,
        paidInvoices: periodInvoices.filter(
          (invoice) => invoice.status === "paid",
        ).length,
        issuedInvoices: periodInvoices.filter(
          (invoice) => invoice.status === "issued",
        ).length,
        draftInvoices: periodInvoices.filter(
          (invoice) => invoice.status === "draft",
        ).length,
      },
      changes: {
        sales: percentChange(totalSales, previousSales),
        income: percentChange(totalIncome, previousIncomeTotal),
        expenses: percentChange(totalExpenses, previousExpensesTotal),
        profit: percentChange(netProfit, previousProfit),
        purchases: percentChange(totalPurchases, previousPurchasesTotal),
        cash: null,
        bank: null,
        receivables: null,
        payables: null,
        unpaidInvoices: null,
      },
      availability: {
        sales: true,
        purchases: true,
        income: true,
        expenses: true,
        profit: true,
        cash: true,
        bank: true,
        receivables: true,
        payables: true,
        inventory: true,
        journal: true,
        payroll: false,
        assets: false,
        reports: false,
      },
      salesSeries,
      salesGranularity,
      financeSeries,
      cashflowSeries,
      openingCash: opening.inflow - opening.outflow,
      invoiceStatus,
      activity,
      accounting: {
        journalAvailable: true,
        balanced:
          accountingLines.length > 0 && accountingDifference === 0
            ? true
            : accountingLines.length === 0
              ? null
              : false,
        draftDocuments: accountingDraft,
        pendingDocuments: accountingPending,
        postedDocuments: scopedAccountingDocuments.filter(
          (document) => document.status === "posted",
        ).length,
        reversedDocuments: scopedAccountingDocuments.filter(
          (document) => document.status === "reversed",
        ).length,
        totalDocuments: scopedAccountingDocuments.length,
        finalInvoices: scopedAccountingDocuments.filter(
          (document) => document.status === "posted",
        ).length,
        needsReview:
          accountingDraft +
          accountingPending +
          scopedAccountingDocuments.filter(
            (document) =>
              (document.status === "posted" ||
                document.status === "reversed") &&
              document.totalDebit !== document.totalCredit,
          ).length,
        totalDebit: accountingDebit,
        totalCredit: accountingCredit,
        difference: accountingDifference,
        recentDocuments: scopedAccountingDocuments.slice(0, 6).map((document) => ({
          _id: document._id as string,
          number: document.number,
          description: document.description,
          status: document.status,
          kind: document.kind,
          documentDate: document.documentDate,
          totalDebit: document.totalDebit,
        })),
        overdueInvoices: overdueInvoices.length,
        activeFiscalYear: activeFiscalYear
          ? {
              name: activeFiscalYear.name,
              status: activeFiscalYear.status,
              endAt: activeFiscalYear.endAt,
              daysRemaining: monthlyClosing,
            }
          : null,
      },
    };
  },
});
