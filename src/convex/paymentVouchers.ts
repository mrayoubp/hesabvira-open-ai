import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
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
  financeMethodValidator,
  financialAccountTypeValidator,
  voucherStatusValidator,
} from "./schema";

function requireDate(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConvexError(`${label} معتبر نیست.`);
  }
  return value;
}

async function loadVoucher(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  voucherId: Id<"paymentVouchers">,
) {
  const row = await ctx.db.get(voucherId);
  if (!row || row.businessId !== businessId) {
    throw new ConvexError("سند پرداخت در این کسب‌وکار یافت نشد.");
  }
  return row;
}

function accountRef(
  row: Pick<
    Doc<"paymentVouchers">,
    "sourceType" | "bankAccountId" | "cashFundId"
  >,
) {
  return row.sourceType === "bank"
    ? { type: "bank" as const, bankAccountId: row.bankAccountId }
    : { type: "cash" as const, cashFundId: row.cashFundId };
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    status: v.optional(voucherStatusValidator),
    method: v.optional(financeMethodValidator),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    const rows = await ctx.db
      .query("paymentVouchers")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(2000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter(
        (row) => !args.fiscalYearId || row.fiscalYearId === args.fiscalYearId,
      )
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.method || row.method === args.method)
      .filter((row) => !args.from || row.occurredAt >= args.from)
      .filter((row) => !args.to || row.occurredAt <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return [row.number, row.partyName, row.description, row.trackingNumber]
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
    return filtered.slice(0, limit).map((row) => ({
      _id: row._id as string,
      number: row.number,
      status: row.status,
      partyType: row.partyType,
      partyName: row.partyName,
      expenseId: row.expenseId ? (row.expenseId as string) : null,
      supplierId: row.supplierId ? (row.supplierId as string) : null,
      purchaseInvoiceId: row.purchaseInvoiceId ? (row.purchaseInvoiceId as string) : null,
      amount: row.amount,
      method: row.method,
      sourceType: row.sourceType,
      sourceName:
        row.sourceType === "bank"
          ? (bankNames.get(row.bankAccountId as string) ?? "—")
          : (fundNames.get(row.cashFundId as string) ?? "—"),
      trackingNumber: row.trackingNumber ?? null,
      description: row.description,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      postedAt: row.postedAt ?? null,
      createdAt: row.createdAt,
    }));
  },
});

export const get = query({
  args: {
    businessId: v.id("businesses"),
    voucherId: v.id("paymentVouchers"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const row = await loadVoucher(ctx, args.businessId, args.voucherId);
    const [bank, fund, document, creator] = await Promise.all([
      row.bankAccountId ? ctx.db.get(row.bankAccountId) : Promise.resolve(null),
      row.cashFundId ? ctx.db.get(row.cashFundId) : Promise.resolve(null),
      row.accountingDocumentId
        ? ctx.db.get(row.accountingDocumentId)
        : Promise.resolve(null),
      ctx.db.get(row.createdBy),
    ]);
    return {
      _id: row._id as string,
      number: row.number,
      status: row.status,
      partyType: row.partyType,
      partyName: row.partyName,
      expenseId: row.expenseId ? (row.expenseId as string) : null,
      supplierId: row.supplierId ? (row.supplierId as string) : null,
      purchaseInvoiceId: row.purchaseInvoiceId ? (row.purchaseInvoiceId as string) : null,
      amount: row.amount,
      method: row.method,
      sourceType: row.sourceType,
      sourceName: bank?.name ?? fund?.name ?? "—",
      bankAccountId: row.bankAccountId ? (row.bankAccountId as string) : null,
      cashFundId: row.cashFundId ? (row.cashFundId as string) : null,
      trackingNumber: row.trackingNumber ?? null,
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
      createdByName: creator?.name ?? creator?.email ?? "کاربر",
      createdAt: row.createdAt,
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    partyType: v.union(v.literal("supplier"), v.literal("other")),
    partyName: v.string(),
    expenseId: v.optional(v.id("expenseRecords")),
    supplierId: v.optional(v.id("suppliers")),
    purchaseInvoiceId: v.optional(v.id("purchaseInvoices")),
    amount: v.number(),
    method: financeMethodValidator,
    sourceType: financialAccountTypeValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    trackingNumber: v.optional(v.string()),
    description: v.string(),
    occurredAt: v.optional(v.number()),
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
    if (args.method === "check") {
      throw new ConvexError(
        "پرداخت با چک را از بخش چک‌های پرداختی ثبت کنید تا وضعیت و تاریخچه آن کامل باشد.",
      );
    }
    const amount = requireInt(args.amount, "مبلغ پرداخت", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(
      args.occurredAt ?? Date.now(),
      "تاریخ پرداخت",
    );
    let partyName = requireString(args.partyName, "پرداخت به", {
      max: 160,
    }) as string;
    let partyType = args.partyType;
    if (args.expenseId && args.purchaseInvoiceId) {
      throw new ConvexError("پرداخت نمی‌تواند هم‌زمان به هزینه و فاکتور خرید متصل باشد.");
    }
    if (args.expenseId) {
      const expense = await ctx.db.get(args.expenseId);
      if (!expense || expense.businessId !== args.businessId) {
        throw new ConvexError("هزینه مرتبط با پرداخت یافت نشد.");
      }
      if (expense.status !== "approved" && expense.status !== "paid") {
        throw new ConvexError("پرداخت فقط برای هزینه تأییدشده مجاز است.");
      }
      const remaining = Math.max(0, expense.amount - expense.paidAmount);
      if (remaining <= 0) {
        throw new ConvexError("این هزینه قبلاً تسویه شده است.");
      }
      if (amount > remaining) {
        throw new ConvexError("مبلغ پرداخت از مانده هزینه بیشتر است.");
      }
      partyName = expense.supplierName ?? partyName;
      partyType = "supplier";
    }
    if (args.purchaseInvoiceId) {
      const purchase = await ctx.db.get(args.purchaseInvoiceId);
      if (!purchase || purchase.businessId !== args.businessId || purchase.kind !== "purchase") {
        throw new ConvexError("فاکتور خرید مرتبط یافت نشد.");
      }
      if (purchase.status !== "posted" && purchase.status !== "paid") {
        throw new ConvexError("پرداخت فقط برای فاکتور خرید قطعی مجاز است.");
      }
      const outstanding = Math.max(0, purchase.total - purchase.paidAmount - (purchase.returnedAmount ?? 0));
      if (outstanding <= 0) throw new ConvexError("این فاکتور خرید قبلاً تسویه شده است.");
      if (amount > outstanding) throw new ConvexError("مبلغ پرداخت از مانده فاکتور خرید بیشتر است.");
      if (args.supplierId && args.supplierId !== purchase.supplierId) {
        throw new ConvexError("تأمین‌کننده با فاکتور خرید هم‌خوانی ندارد.");
      }
      const supplier = await ctx.db.get(purchase.supplierId);
      if (!supplier || supplier.businessId !== args.businessId) throw new ConvexError("تأمین‌کننده فاکتور خرید یافت نشد.");
      partyName = supplier.name;
      partyType = "supplier";
      args = { ...args, supplierId: purchase.supplierId };
    } else if (args.supplierId) {
      const supplier = await ctx.db.get(args.supplierId);
      if (!supplier || supplier.businessId !== args.businessId) throw new ConvexError("تأمین‌کننده پرداخت یافت نشد.");
      partyName = supplier.name;
      partyType = "supplier";
    }
    if (args.sourceType === "bank") {
      if (!args.bankAccountId) {
        throw new ConvexError("حساب بانکی مبدأ را انتخاب کنید.");
      }
      const bank = await ctx.db.get(args.bankAccountId);
      if (!bank || bank.businessId !== args.businessId) {
        throw new ConvexError("حساب بانکی مبدأ یافت نشد.");
      }
    } else {
      if (!args.cashFundId) {
        throw new ConvexError("صندوق مبدأ را انتخاب کنید.");
      }
      const fund = await ctx.db.get(args.cashFundId);
      if (!fund || fund.businessId !== args.businessId) {
        throw new ConvexError("صندوق مبدأ یافت نشد.");
      }
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی پرداخت مشخص نیست.");
    }
    const sequence = await nextCounter(ctx, args.businessId, "payment-voucher");
    const number = padSequence(sequence, "PAY");
    const now = Date.now();
    const voucherId = await ctx.db.insert("paymentVouchers", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      number,
      sequence,
      status: "draft",
      partyType,
      partyName,
      expenseId: args.expenseId,
      supplierId: args.supplierId,
      purchaseInvoiceId: args.purchaseInvoiceId,
      amount,
      method: args.method,
      sourceType: args.sourceType,
      bankAccountId:
        args.sourceType === "bank" ? args.bankAccountId : undefined,
      cashFundId:
        args.sourceType === "cash" ? args.cashFundId : undefined,
      trackingNumber: optionalString(args.trackingNumber, "شماره پیگیری", 100),
      description: requireString(args.description, "شرح پرداخت", {
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
      action: "payment-voucher.draft",
      entity: "paymentVouchers",
      entityId: voucherId,
      summary: `پیش‌نویس پرداخت ${number} به ${partyName}`,
    });
    return { voucherId, number };
  },
});

export const updateDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    voucherId: v.id("paymentVouchers"),
    partyType: v.union(v.literal("supplier"), v.literal("other")),
    partyName: v.string(),
    supplierId: v.optional(v.id("suppliers")),
    purchaseInvoiceId: v.optional(v.id("purchaseInvoices")),
    amount: v.number(),
    method: financeMethodValidator,
    sourceType: financialAccountTypeValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    trackingNumber: v.optional(v.string()),
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
    const row = await loadVoucher(ctx, args.businessId, args.voucherId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط پرداخت پیش‌نویس قابل ویرایش است.");
    }
    if (args.method === "check") {
      throw new ConvexError(
        "پرداخت با چک از بخش چک‌های پرداختی ثبت می‌شود.",
      );
    }
    const amount = requireInt(args.amount, "مبلغ پرداخت", {
      min: 1,
      max: MAX_AMOUNT,
    });
    if (row.expenseId) {
      const expense = await ctx.db.get(row.expenseId);
      if (!expense || expense.businessId !== args.businessId) {
        throw new ConvexError("هزینه مرتبط یافت نشد.");
      }
      if (amount > Math.max(0, expense.amount - expense.paidAmount)) {
        throw new ConvexError("مبلغ پرداخت از مانده هزینه بیشتر است.");
      }
    }
    if (row.purchaseInvoiceId) {
      const purchase = await ctx.db.get(row.purchaseInvoiceId);
      if (!purchase || purchase.businessId !== args.businessId) {
        throw new ConvexError("فاکتور خرید مرتبط یافت نشد.");
      }
      if (amount > Math.max(0, purchase.total - purchase.paidAmount - (purchase.returnedAmount ?? 0))) {
        throw new ConvexError("مبلغ پرداخت از مانده فاکتور خرید بیشتر است.");
      }
    }
    const occurredAt = requireDate(args.occurredAt, "تاریخ پرداخت");
    if (args.sourceType === "bank" && !args.bankAccountId) {
      throw new ConvexError("حساب بانکی مبدأ را انتخاب کنید.");
    }
    if (args.sourceType === "cash" && !args.cashFundId) {
      throw new ConvexError("صندوق مبدأ را انتخاب کنید.");
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی پرداخت مشخص نیست.");
    }
    await ctx.db.patch(row._id, {
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      partyType: args.partyType,
      partyName: requireString(args.partyName, "پرداخت به", { max: 160 }),
      supplierId: args.supplierId,
      purchaseInvoiceId: args.purchaseInvoiceId,
      amount,
      method: args.method,
      sourceType: args.sourceType,
      bankAccountId:
        args.sourceType === "bank" ? args.bankAccountId : undefined,
      cashFundId:
        args.sourceType === "cash" ? args.cashFundId : undefined,
      trackingNumber: optionalString(args.trackingNumber, "شماره پیگیری", 100),
      description: requireString(args.description, "شرح پرداخت", {
        max: 500,
      }) as string,
      occurredAt,
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payment-voucher.update",
      entity: "paymentVouchers",
      entityId: row._id,
      summary: `ویرایش پیش‌نویس پرداخت ${row.number}`,
    });
    return { voucherId: row._id };
  },
});

export const post = mutation({
  args: {
    businessId: v.id("businesses"),
    voucherId: v.id("paymentVouchers"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadVoucher(ctx, args.businessId, args.voucherId);
    if (row.status !== "draft") {
      throw new ConvexError("این پرداخت قبلاً تأیید یا لغو شده است.");
    }
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      row.fiscalYearId,
    );
    assertDocumentDateInFiscalYear(fiscalYear, row.occurredAt);
    let expense: Doc<"expenseRecords"> | null = null;
    let purchase: Doc<"purchaseInvoices"> | null = null;
    if (row.purchaseInvoiceId) {
      purchase = await ctx.db.get(row.purchaseInvoiceId);
      if (!purchase || purchase.businessId !== args.businessId) {
        throw new ConvexError("فاکتور خرید مرتبط یافت نشد.");
      }
      if (purchase.status !== "posted" && purchase.status !== "paid") {
        throw new ConvexError("فاکتور خرید در وضعیت قابل پرداخت نیست.");
      }
      if (row.amount > Math.max(0, purchase.total - purchase.paidAmount - (purchase.returnedAmount ?? 0))) {
        throw new ConvexError("مبلغ پرداخت از مانده فاکتور خرید بیشتر است.");
      }
    }
    if (row.expenseId) {
      expense = await ctx.db.get(row.expenseId);
      if (!expense || expense.businessId !== args.businessId) {
        throw new ConvexError("هزینه مرتبط با پرداخت یافت نشد.");
      }
      if (expense.status !== "approved" && expense.status !== "paid") {
        throw new ConvexError("هزینه مرتبط در وضعیت قابل پرداخت نیست.");
      }
      if (row.amount > Math.max(0, expense.amount - expense.paidAmount)) {
        throw new ConvexError("مبلغ پرداخت از مانده هزینه بیشتر است.");
      }
    }
    const debitAccount = await systemAccount(
      ctx,
      args.businessId,
      row.partyType === "supplier" || expense ? "payable" : "otherExpense",
      user._id,
    );
    const ref = await resolveFinancialAccount(
      ctx,
      args.businessId,
      accountRef(row),
    );
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: row.occurredAt,
      description: `پرداخت ${row.number} به ${row.partyName}`,
      sourceType: "payment-voucher",
      sourceId: row._id as string,
      branchId: row.branchId,
      lines: [
        {
          accountId: debitAccount._id,
          description: `پرداخت به ${row.partyName}`,
          debit: row.amount,
          credit: 0,
        },
        {
          accountId: ref.accountId,
          description: `پرداخت ${row.number}`,
          debit: 0,
          credit: row.amount,
        },
      ],
    });
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: row.branchId,
      fiscalYearId: row.fiscalYearId,
      account: ref,
      direction: "out",
      amount: row.amount,
      occurredAt: row.occurredAt,
      operationType: "payment",
      operationId: row._id as string,
      description: `پرداخت ${row.number} — ${row.partyName}`,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    if (expense) {
      const paidAmount = expense.paidAmount + row.amount;
      await ctx.db.patch(expense._id, {
        paidAmount,
        status: paidAmount >= expense.amount ? "paid" : "approved",
        paidAt: paidAmount >= expense.amount ? row.occurredAt : expense.paidAt,
        updatedAt: Date.now(),
      });
    }
    if (purchase) {
      const paidAmount = purchase.paidAmount + row.amount;
      await ctx.db.patch(purchase._id, {
        paidAmount,
        status: paidAmount >= purchase.total - (purchase.returnedAmount ?? 0) ? "paid" : "posted",
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(row._id, {
      status: "posted",
      accountingDocumentId: journal.documentId,
      postedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payment-voucher.post",
      entity: "paymentVouchers",
      entityId: row._id,
      summary: `تأیید پرداخت ${row.number} — ${row.amount} از ${ref.name}`,
    });
    return {
      voucherId: row._id,
      accountingDocumentId: journal.documentId,
      accountingNumber: journal.number,
    };
  },
});

export const removeDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    voucherId: v.id("paymentVouchers"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadVoucher(ctx, args.businessId, args.voucherId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط پرداخت پیش‌نویس قابل حذف است.");
    }
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "payment-voucher.delete-draft",
      entity: "paymentVouchers",
      entityId: row._id,
      summary: `حذف پیش‌نویس پرداخت ${row.number}`,
    });
    return { voucherId: row._id };
  },
});
