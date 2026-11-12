import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  nextCounter,
  padSequence,
  requireMembership,
  writeAudit,
} from "./lib/tenant";
import { assertFileForBusiness } from "./lib/files";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";
import { resolveDocumentScope } from "./lib/workspace";
import {
  assertDocumentDateInFiscalYear,
  getFiscalYear,
  MAX_AMOUNT,
} from "./lib/accounting";
import {
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
  systemAccount,
} from "./lib/finance";
import {
  expenseCategoryValidator,
  expenseStatusValidator,
  financeMethodValidator,
  financialAccountTypeValidator,
  voucherStatusValidator,
} from "./schema";

const EXPENSE_ACCOUNT_KEYS: Record<string, string> = {
  rent: "rentExpense",
  salary: "salaryExpense",
  utilities: "utilitiesExpense",
  internet: "internetExpense",
  transport: "transportExpense",
  repairs: "repairExpense",
  advertising: "advertisingExpense",
  supplies: "suppliesExpense",
  other: "otherExpense",
};

function requireDate(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConvexError(`${label} معتبر نیست.`);
  }
  return value;
}

function incomeAccountRef(row: Pick<
  Doc<"incomeRecords">,
  "destinationType" | "bankAccountId" | "cashFundId"
>) {
  return row.destinationType === "bank"
    ? { type: "bank" as const, bankAccountId: row.bankAccountId }
    : { type: "cash" as const, cashFundId: row.cashFundId };
}

async function loadIncome(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  incomeId: Id<"incomeRecords">,
) {
  const row = await ctx.db.get(incomeId);
  if (!row || row.businessId !== businessId) {
    throw new ConvexError("درآمد در این کسب‌وکار یافت نشد.");
  }
  return row;
}

async function loadExpense(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  expenseId: Id<"expenseRecords">,
) {
  const row = await ctx.db.get(expenseId);
  if (!row || row.businessId !== businessId) {
    throw new ConvexError("هزینه در این کسب‌وکار یافت نشد.");
  }
  return row;
}

export const incomes = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    status: v.optional(voucherStatusValidator),
    category: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("incomeRecords")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(2000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.category || row.category === args.category)
      .filter((row) => !args.from || row.occurredAt >= args.from)
      .filter((row) => !args.to || row.occurredAt <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return [row.number, row.partyName, row.description, row.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
    const bankIds = [
      ...new Set(
        filtered
          .map((row) => row.bankAccountId)
          .filter((id): id is Id<"bankAccounts"> => Boolean(id)),
      ),
    ];
    const fundIds = [
      ...new Set(
        filtered
          .map((row) => row.cashFundId)
          .filter((id): id is Id<"cashFunds"> => Boolean(id)),
      ),
    ];
    const [banks, funds] = await Promise.all([
      Promise.all(bankIds.map((id) => ctx.db.get(id))),
      Promise.all(fundIds.map((id) => ctx.db.get(id))),
    ]);
    const bankNames = new Map(
      banks
        .filter((row): row is Doc<"bankAccounts"> => Boolean(row))
        .map((row) => [row._id as string, row.name]),
    );
    const fundNames = new Map(
      funds
        .filter((row): row is Doc<"cashFunds"> => Boolean(row))
        .map((row) => [row._id as string, row.name]),
    );
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    return filtered.slice(0, limit).map((row) => ({
      _id: row._id as string,
      number: row.number,
      status: row.status,
      category: row.category,
      customerId: row.customerId ? (row.customerId as string) : null,
      partyName: row.partyName ?? null,
      amount: row.amount,
      method: row.method,
      destinationType: row.destinationType,
      destinationName:
        row.destinationType === "bank"
          ? (bankNames.get(row.bankAccountId as string) ?? "—")
          : (fundNames.get(row.cashFundId as string) ?? "—"),
      description: row.description,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      attachmentStorageId: row.attachmentStorageId
        ? (row.attachmentStorageId as string)
        : null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      postedAt: row.postedAt ?? null,
      createdAt: row.createdAt,
    }));
  },
});

export const incomeGet = query({
  args: {
    businessId: v.id("businesses"),
    incomeId: v.id("incomeRecords"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const row = await loadIncome(ctx, args.businessId, args.incomeId);
    const [bank, fund, document] = await Promise.all([
      row.bankAccountId ? ctx.db.get(row.bankAccountId) : Promise.resolve(null),
      row.cashFundId ? ctx.db.get(row.cashFundId) : Promise.resolve(null),
      row.accountingDocumentId
        ? ctx.db.get(row.accountingDocumentId)
        : Promise.resolve(null),
    ]);
    return {
      _id: row._id as string,
      number: row.number,
      status: row.status,
      category: row.category,
      customerId: row.customerId ? (row.customerId as string) : null,
      partyName: row.partyName ?? null,
      amount: row.amount,
      method: row.method,
      destinationType: row.destinationType,
      destinationName: bank?.name ?? fund?.name ?? "—",
      description: row.description,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      attachmentStorageId: row.attachmentStorageId
        ? (row.attachmentStorageId as string)
        : null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      accountingNumber: document?.number ?? null,
      postedAt: row.postedAt ?? null,
      createdAt: row.createdAt,
    };
  },
});

async function postIncomeRecord(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  actorId: Id<"users">,
  incomeId: Id<"incomeRecords">,
) {
  const row = await loadIncome(ctx, businessId, incomeId);
  if (row.status !== "draft") {
    throw new ConvexError("این درآمد قبلاً ثبت یا لغو شده است.");
  }
  const fiscalYear = await getFiscalYear(ctx, businessId, row.fiscalYearId);
  assertDocumentDateInFiscalYear(fiscalYear, row.occurredAt);
  const destination = await resolveFinancialAccount(
    ctx,
    businessId,
    incomeAccountRef(row),
  );
  const incomeAccount = await systemAccount(
    ctx,
    businessId,
    "otherIncome",
    actorId,
  );
  const journal = await postAutoJournal(ctx, {
    businessId,
    actorId,
    occurredAt: row.occurredAt,
    description: `ثبت درآمد ${row.number} — ${row.description}`,
    sourceType: "income",
    sourceId: row._id as string,
    branchId: row.branchId,
    lines: [
      {
        accountId: destination.accountId,
        description: `دریافت درآمد ${row.number}`,
        debit: row.amount,
        credit: 0,
      },
      {
        accountId: incomeAccount._id,
        description: `درآمد ${row.number}`,
        debit: 0,
        credit: row.amount,
      },
    ],
  });
  await recordFinancialMovement(ctx, {
    businessId,
    branchId: row.branchId,
    fiscalYearId: row.fiscalYearId,
    account: destination,
    direction: "in",
    amount: row.amount,
    occurredAt: row.occurredAt,
    operationType: "income",
    operationId: row._id as string,
    description: `درآمد ${row.number} — ${row.description}`,
    accountingDocumentId: journal.documentId,
    actorId,
  });
  await ctx.db.patch(row._id, {
    status: "posted",
    accountingDocumentId: journal.documentId,
    postedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await writeAudit(ctx, {
    businessId,
    actorId,
    action: "income.post",
    entity: "incomeRecords",
    entityId: row._id,
    summary: `ثبت درآمد ${row.number} — ${row.amount}`,
  });
  return { documentId: journal.documentId, number: journal.number };
}

export const createIncome = mutation({
  args: {
    businessId: v.id("businesses"),
    category: v.string(),
    customerId: v.optional(v.id("customers")),
    partyName: v.optional(v.string()),
    amount: v.number(),
    method: financeMethodValidator,
    destinationType: financialAccountTypeValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    description: v.string(),
    occurredAt: v.optional(v.number()),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
    /** An invoice already recorded as sales revenue must not be entered again. */
    salesInvoiceId: v.optional(v.id("invoices")),
    status: v.optional(v.union(v.literal("draft"), v.literal("posted"))),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.attachmentStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.attachmentStorageId);
    }
    if (args.salesInvoiceId) {
      throw new ConvexError(
        "این درآمد از فاکتور فروش ثبت شده است؛ ثبت دوباره به‌عنوان درآمد مجاز نیست.",
      );
    }
    if (args.method === "check") {
      throw new ConvexError(
        "درآمد با چک را از طریق ثبت چک دریافتی و سپس وصول آن ثبت کنید.",
      );
    }
    const amount = requireInt(args.amount, "مبلغ درآمد", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(
      args.occurredAt ?? Date.now(),
      "تاریخ درآمد",
    );
    const description = requireString(args.description, "شرح درآمد", {
      max: 500,
    }) as string;
    const category = requireString(args.category, "دسته‌بندی درآمد", {
      max: 80,
    }) as string;
    let partyName = optionalString(args.partyName, "دریافت از", 160);
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.businessId !== args.businessId) {
        throw new ConvexError("مشتری انتخاب‌شده یافت نشد.");
      }
      partyName = customer.name;
    }
    if (args.destinationType === "bank") {
      if (!args.bankAccountId) {
        throw new ConvexError("حساب بانکی مقصد را انتخاب کنید.");
      }
      const bank = await ctx.db.get(args.bankAccountId);
      if (!bank || bank.businessId !== args.businessId) {
        throw new ConvexError("حساب بانکی مقصد یافت نشد.");
      }
    } else {
      if (!args.cashFundId) {
        throw new ConvexError("صندوق مقصد را انتخاب کنید.");
      }
      const fund = await ctx.db.get(args.cashFundId);
      if (!fund || fund.businessId !== args.businessId) {
        throw new ConvexError("صندوق مقصد یافت نشد.");
      }
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی درآمد مشخص نیست.");
    }
    const sequence = await nextCounter(ctx, args.businessId, "income");
    const number = padSequence(sequence, "INC");
    const now = Date.now();
    const incomeId = await ctx.db.insert("incomeRecords", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      number,
      sequence,
      status: "draft",
      category,
      customerId: args.customerId,
      partyName,
      amount,
      method: args.method,
      destinationType: args.destinationType,
      bankAccountId:
        args.destinationType === "bank" ? args.bankAccountId : undefined,
      cashFundId:
        args.destinationType === "cash" ? args.cashFundId : undefined,
      description,
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      occurredAt,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "income.draft",
      entity: "incomeRecords",
      entityId: incomeId,
      summary: `ثبت پیش‌نویس درآمد ${number}`,
    });
    let posted: Awaited<ReturnType<typeof postIncomeRecord>> | null = null;
    if (args.status === "posted") {
      posted = await postIncomeRecord(
        ctx,
        args.businessId,
        user._id,
        incomeId,
      );
    }
    return {
      incomeId,
      number,
      status: posted ? ("posted" as const) : ("draft" as const),
      accountingDocumentId: posted?.documentId ?? null,
    };
  },
});

export const updateIncome = mutation({
  args: {
    businessId: v.id("businesses"),
    incomeId: v.id("incomeRecords"),
    category: v.string(),
    customerId: v.optional(v.id("customers")),
    partyName: v.optional(v.string()),
    amount: v.number(),
    method: financeMethodValidator,
    destinationType: financialAccountTypeValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    description: v.string(),
    occurredAt: v.number(),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.attachmentStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.attachmentStorageId);
    }
    const row = await loadIncome(ctx, args.businessId, args.incomeId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط درآمد پیش‌نویس قابل ویرایش است.");
    }
    if (args.method === "check") {
      throw new ConvexError("درآمد با چک از مسیر چک‌های دریافتی ثبت می‌شود.");
    }
    const amount = requireInt(args.amount, "مبلغ درآمد", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(args.occurredAt, "تاریخ درآمد");
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی درآمد مشخص نیست.");
    }
    await ctx.db.patch(row._id, {
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      category: requireString(args.category, "دسته‌بندی درآمد", {
        max: 80,
      }),
      customerId: args.customerId,
      partyName: optionalString(args.partyName, "دریافت از", 160),
      amount,
      method: args.method,
      destinationType: args.destinationType,
      bankAccountId:
        args.destinationType === "bank" ? args.bankAccountId : undefined,
      cashFundId:
        args.destinationType === "cash" ? args.cashFundId : undefined,
      description: requireString(args.description, "شرح درآمد", {
        max: 500,
      }),
      occurredAt,
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "income.update",
      entity: "incomeRecords",
      entityId: row._id,
      summary: `ویرایش پیش‌نویس درآمد ${row.number}`,
    });
    return { incomeId: row._id };
  },
});

export const postIncome = mutation({
  args: {
    businessId: v.id("businesses"),
    incomeId: v.id("incomeRecords"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const result = await postIncomeRecord(
      ctx,
      args.businessId,
      user._id,
      args.incomeId,
    );
    return {
      incomeId: args.incomeId,
      accountingDocumentId: result.documentId,
      accountingNumber: result.number,
    };
  },
});

export const removeIncomeDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    incomeId: v.id("incomeRecords"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadIncome(ctx, args.businessId, args.incomeId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط درآمد پیش‌نویس قابل حذف است.");
    }
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "income.delete-draft",
      entity: "incomeRecords",
      entityId: row._id,
      summary: `حذف پیش‌نویس درآمد ${row.number}`,
    });
    return { incomeId: row._id };
  },
});

export const expenses = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    status: v.optional(expenseStatusValidator),
    category: v.optional(expenseCategoryValidator),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("expenseRecords")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(2000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.category || row.category === args.category)
      .filter((row) => !args.from || row.occurredAt >= args.from)
      .filter((row) => !args.to || row.occurredAt <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return [row.number, row.supplierName, row.description, row.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    return filtered.slice(0, limit).map((row) => ({
      _id: row._id as string,
      number: row.number,
      status: row.status,
      category: row.category,
      supplierName: row.supplierName ?? null,
      amount: row.amount,
      paidAmount: row.paidAmount,
      outstanding: Math.max(0, row.amount - row.paidAmount),
      dueDate: row.dueDate ?? null,
      description: row.description,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      attachmentStorageId: row.attachmentStorageId
        ? (row.attachmentStorageId as string)
        : null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      approvedAt: row.approvedAt ?? null,
      paidAt: row.paidAt ?? null,
      createdAt: row.createdAt,
    }));
  },
});

export const expenseGet = query({
  args: {
    businessId: v.id("businesses"),
    expenseId: v.id("expenseRecords"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const row = await loadExpense(ctx, args.businessId, args.expenseId);
    const document = row.accountingDocumentId
      ? await ctx.db.get(row.accountingDocumentId)
      : null;
    return {
      _id: row._id as string,
      number: row.number,
      status: row.status,
      category: row.category,
      supplierName: row.supplierName ?? null,
      amount: row.amount,
      paidAmount: row.paidAmount,
      outstanding: Math.max(0, row.amount - row.paidAmount),
      dueDate: row.dueDate ?? null,
      description: row.description,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      attachmentStorageId: row.attachmentStorageId
        ? (row.attachmentStorageId as string)
        : null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      accountingNumber: document?.number ?? null,
      approvedAt: row.approvedAt ?? null,
      paidAt: row.paidAt ?? null,
      createdAt: row.createdAt,
    };
  },
});

export const createExpense = mutation({
  args: {
    businessId: v.id("businesses"),
    category: expenseCategoryValidator,
    supplierName: v.optional(v.string()),
    amount: v.number(),
    dueDate: v.optional(v.number()),
    description: v.string(),
    occurredAt: v.optional(v.number()),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("approved"))),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.attachmentStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.attachmentStorageId);
    }
    const amount = requireInt(args.amount, "مبلغ هزینه", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(
      args.occurredAt ?? Date.now(),
      "تاریخ هزینه",
    );
    const dueDate =
      args.dueDate === undefined
        ? undefined
        : requireDate(args.dueDate, "سررسید هزینه");
    if (dueDate !== undefined && dueDate < occurredAt) {
      throw new ConvexError("سررسید هزینه نمی‌تواند قبل از تاریخ هزینه باشد.");
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی هزینه مشخص نیست.");
    }
    const sequence = await nextCounter(ctx, args.businessId, "expense");
    const number = padSequence(sequence, "EXP");
    const now = Date.now();
    const expenseId = await ctx.db.insert("expenseRecords", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      number,
      sequence,
      status: "draft",
      category: args.category,
      supplierName: optionalString(args.supplierName, "تأمین‌کننده", 160),
      amount,
      paidAmount: 0,
      dueDate,
      description: requireString(args.description, "شرح هزینه", {
        max: 500,
      }) as string,
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      occurredAt,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "expense.draft",
      entity: "expenseRecords",
      entityId: expenseId,
      summary: `ثبت پیش‌نویس هزینه ${number}`,
    });
    let documentId: Id<"accountingDocuments"> | null = null;
    if (args.status === "approved") {
      documentId = await approveExpenseRecord(
        ctx,
        args.businessId,
        user._id,
        expenseId,
      );
    }
    return { expenseId, number, status: documentId ? "approved" : "draft" };
  },
});

export const updateExpense = mutation({
  args: {
    businessId: v.id("businesses"),
    expenseId: v.id("expenseRecords"),
    category: expenseCategoryValidator,
    supplierName: v.optional(v.string()),
    amount: v.number(),
    dueDate: v.optional(v.number()),
    description: v.string(),
    occurredAt: v.number(),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.attachmentStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.attachmentStorageId);
    }
    const row = await loadExpense(ctx, args.businessId, args.expenseId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط هزینه پیش‌نویس قابل ویرایش است.");
    }
    const amount = requireInt(args.amount, "مبلغ هزینه", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(args.occurredAt, "تاریخ هزینه");
    const dueDate =
      args.dueDate === undefined
        ? undefined
        : requireDate(args.dueDate, "سررسید هزینه");
    if (dueDate !== undefined && dueDate < occurredAt) {
      throw new ConvexError("سررسید هزینه قبل از تاریخ هزینه است.");
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی هزینه مشخص نیست.");
    }
    await ctx.db.patch(row._id, {
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      category: args.category,
      supplierName: optionalString(args.supplierName, "تأمین‌کننده", 160),
      amount,
      dueDate,
      description: requireString(args.description, "شرح هزینه", {
        max: 500,
      }),
      occurredAt,
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "expense.update",
      entity: "expenseRecords",
      entityId: row._id,
      summary: `ویرایش پیش‌نویس هزینه ${row.number}`,
    });
    return { expenseId: row._id };
  },
});

async function approveExpenseRecord(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  actorId: Id<"users">,
  expenseId: Id<"expenseRecords">,
) {
  const row = await loadExpense(ctx, businessId, expenseId);
  if (row.status !== "draft") {
    throw new ConvexError("این هزینه قبلاً تأیید یا لغو شده است.");
  }
  const fiscalYear = await getFiscalYear(ctx, businessId, row.fiscalYearId);
  assertDocumentDateInFiscalYear(fiscalYear, row.occurredAt);
  const key = EXPENSE_ACCOUNT_KEYS[row.category] ?? "otherExpense";
  const expenseAccount = await systemAccount(ctx, businessId, key, actorId);
  const payable = await systemAccount(ctx, businessId, "payable", actorId);
  const journal = await postAutoJournal(ctx, {
    businessId,
    actorId,
    occurredAt: row.occurredAt,
    description: `تأیید هزینه ${row.number} — ${row.description}`,
    sourceType: "expense-approval",
    sourceId: row._id as string,
    branchId: row.branchId,
    lines: [
      {
        accountId: expenseAccount._id,
        description: `هزینه ${row.number}`,
        debit: row.amount,
        credit: 0,
      },
      {
        accountId: payable._id,
        description: `بدهی هزینه ${row.number}`,
        debit: 0,
        credit: row.amount,
      },
    ],
  });
  await ctx.db.patch(row._id, {
    status: "approved",
    accountingDocumentId: journal.documentId,
    approvedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await writeAudit(ctx, {
    businessId,
    actorId,
    action: "expense.approve",
    entity: "expenseRecords",
    entityId: row._id,
    summary: `تأیید هزینه ${row.number} — ${row.amount}`,
  });
  return journal.documentId;
}

export const approveExpense = mutation({
  args: {
    businessId: v.id("businesses"),
    expenseId: v.id("expenseRecords"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const documentId = await approveExpenseRecord(
      ctx,
      args.businessId,
      user._id,
      args.expenseId,
    );
    return { expenseId: args.expenseId, accountingDocumentId: documentId };
  },
});

export const removeExpenseDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    expenseId: v.id("expenseRecords"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadExpense(ctx, args.businessId, args.expenseId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط هزینه پیش‌نویس قابل حذف است.");
    }
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "expense.delete-draft",
      entity: "expenseRecords",
      entityId: row._id,
      summary: `حذف پیش‌نویس هزینه ${row.number}`,
    });
    return { expenseId: row._id };
  },
});

export const categorySummary = query({
  args: {
    businessId: v.id("businesses"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("expenseRecords")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(2000);
    const totals = new Map<string, number>();
    for (const row of rows) {
      if (row.status === "draft" || row.status === "cancelled") continue;
      if (args.from && row.occurredAt < args.from) continue;
      if (args.to && row.occurredAt > args.to) continue;
      totals.set(row.category, (totals.get(row.category) ?? 0) + row.amount);
    }
    return [...totals.entries()].map(([category, amount]) => ({
      category,
      amount,
    }));
  },
});
