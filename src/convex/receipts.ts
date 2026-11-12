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
  getFiscalYear,
  MAX_AMOUNT,
  assertDocumentDateInFiscalYear,
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

async function loadReceipt(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  receiptId: Id<"receipts">,
) {
  const receipt = await ctx.db.get(receiptId);
  if (!receipt || receipt.businessId !== businessId) {
    throw new ConvexError("دریافت وجه در این کسب‌وکار یافت نشد.");
  }
  return receipt;
}

function accountRef(
  receipt: Pick<
    Doc<"receipts">,
    "destinationType" | "bankAccountId" | "cashFundId"
  >,
) {
  return receipt.destinationType === "bank"
    ? { type: "bank" as const, bankAccountId: receipt.bankAccountId }
    : { type: "cash" as const, cashFundId: receipt.cashFundId };
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
      .query("receipts")
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
      customerId: row.customerId ? (row.customerId as string) : null,
      partyName: row.partyName,
      invoiceId: row.invoiceId ? (row.invoiceId as string) : null,
      amount: row.amount,
      method: row.method,
      destinationType: row.destinationType,
      destinationName:
        row.destinationType === "bank"
          ? (bankNames.get(row.bankAccountId as string) ?? "—")
          : (fundNames.get(row.cashFundId as string) ?? "—"),
      trackingNumber: row.trackingNumber ?? null,
      description: row.description,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      checkId: row.checkId ? (row.checkId as string) : null,
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
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const row = await loadReceipt(ctx, args.businessId, args.receiptId);
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
      customerId: row.customerId ? (row.customerId as string) : null,
      partyName: row.partyName,
      invoiceId: row.invoiceId ? (row.invoiceId as string) : null,
      amount: row.amount,
      method: row.method,
      destinationType: row.destinationType,
      bankAccountId: row.bankAccountId ? (row.bankAccountId as string) : null,
      cashFundId: row.cashFundId ? (row.cashFundId as string) : null,
      destinationName: bank?.name ?? fund?.name ?? "—",
      trackingNumber: row.trackingNumber ?? null,
      description: row.description,
      occurrence: row.occurredAt,
      occurredAt: row.occurredAt,
      attachmentName: row.attachmentName ?? null,
      attachmentStorageId: row.attachmentStorageId
        ? (row.attachmentStorageId as string)
        : null,
      checkId: row.checkId ? (row.checkId as string) : null,
      checkDueDate: row.checkDueDate ?? null,
      checkBankName: row.checkBankName ?? null,
      checkBankBranch: row.checkBankBranch ?? null,
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
    partyType: v.union(v.literal("customer"), v.literal("other")),
    customerId: v.optional(v.id("customers")),
    partyName: v.string(),
    invoiceId: v.optional(v.id("invoices")),
    amount: v.number(),
    method: financeMethodValidator,
    destinationType: financialAccountTypeValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    trackingNumber: v.optional(v.string()),
    description: v.string(),
    occurredAt: v.optional(v.number()),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
    checkDueDate: v.optional(v.number()),
    checkBankName: v.optional(v.string()),
    checkBankBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.attachmentStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.attachmentStorageId);
    }
    const amount = requireInt(args.amount, "مبلغ دریافت", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(
      args.occurredAt ?? Date.now(),
      "تاریخ دریافت",
    );
    const checkDueDate =
      args.method === "check" && args.checkDueDate !== undefined
        ? requireDate(args.checkDueDate, "تاریخ سررسید چک")
        : undefined;
    let customerId = args.customerId;
    let partyName = requireString(args.partyName, "دریافت از", {
      max: 160,
    }) as string;

    if (customerId) {
      const customer = await ctx.db.get(customerId);
      if (!customer || customer.businessId !== args.businessId) {
        throw new ConvexError("مشتری انتخاب‌شده در این کسب‌وکار یافت نشد.");
      }
      partyName = customer.name;
    }

    if (args.invoiceId) {
      const invoice = await ctx.db.get(args.invoiceId);
      if (!invoice || invoice.businessId !== args.businessId) {
        throw new ConvexError("فاکتور انتخاب‌شده در این کسب‌وکار یافت نشد.");
      }
      if (invoice.status !== "issued") {
        throw new ConvexError("دریافت روی فاکتور صادرشده دارای مانده مجاز است.");
      }
      if (customerId && invoice.customerId !== customerId) {
        throw new ConvexError("فاکتور انتخاب‌شده به مشتری دیگری تعلق دارد.");
      }
      customerId = invoice.customerId;
      const customer = await ctx.db.get(invoice.customerId);
      partyName = customer?.name ?? partyName;
      const outstanding = Math.max(
        0,
        invoice.total -
          (invoice.returnedAmount ?? 0) -
          (invoice.paidAmount ?? 0),
      );
      if (outstanding <= 0) {
        throw new ConvexError("این فاکتور قبلاً تسویه شده است.");
      }
      if (amount > outstanding) {
        throw new ConvexError(
          "مبلغ دریافت نمی‌تواند از مانده فاکتور بیشتر باشد.",
        );
      }
    }

    if (args.method === "check") {
      if (checkDueDate !== undefined && checkDueDate < occurredAt) {
        throw new ConvexError("تاریخ سررسید چک نمی‌تواند قبل از تاریخ دریافت باشد.");
      }
    } else if (args.destinationType === "bank") {
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

    const sequence = await nextCounter(ctx, args.businessId, "receipt");
    const number = padSequence(sequence, "RCP");
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی دریافت مشخص نیست.");
    }
    const now = Date.now();
    const receiptId = await ctx.db.insert("receipts", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      number,
      sequence,
      status: "draft",
      partyType: customerId ? "customer" : args.partyType,
      customerId,
      partyName,
      invoiceId: args.invoiceId,
      amount,
      method: args.method,
      destinationType: args.destinationType,
      bankAccountId:
        args.destinationType === "bank" ? args.bankAccountId : undefined,
      cashFundId:
        args.destinationType === "cash" ? args.cashFundId : undefined,
      trackingNumber: optionalString(args.trackingNumber, "شماره پیگیری", 100),
      description:
        (requireString(args.description, "شرح دریافت", {
          max: 500,
        }) as string) || "",
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      occurredAt,
      checkDueDate:
        args.method === "check"
          ? (checkDueDate ?? occurredAt + 30 * 24 * 60 * 60 * 1000)
          : undefined,
      checkBankName: optionalString(args.checkBankName, "بانک چک", 100),
      checkBankBranch: optionalString(args.checkBankBranch, "شعبه چک", 100),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "receipt.draft",
      entity: "receipts",
      entityId: receiptId,
      summary: `پیش‌نویس دریافت ${number} از ${partyName}`,
    });
    return { receiptId, number };
  },
});

export const updateDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    receiptId: v.id("receipts"),
    partyType: v.union(v.literal("customer"), v.literal("other")),
    customerId: v.optional(v.id("customers")),
    partyName: v.string(),
    invoiceId: v.optional(v.id("invoices")),
    amount: v.number(),
    method: financeMethodValidator,
    destinationType: financialAccountTypeValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    trackingNumber: v.optional(v.string()),
    description: v.string(),
    occurredAt: v.number(),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
    checkDueDate: v.optional(v.number()),
    checkBankName: v.optional(v.string()),
    checkBankBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.attachmentStorageId) {
      await assertFileForBusiness(ctx, args.businessId, args.attachmentStorageId);
    }
    const row = await loadReceipt(ctx, args.businessId, args.receiptId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط دریافت پیش‌نویس قابل ویرایش است.");
    }
    const amount = requireInt(args.amount, "مبلغ دریافت", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(args.occurredAt, "تاریخ دریافت");
    const checkDueDate =
      args.method === "check" && args.checkDueDate !== undefined
        ? requireDate(args.checkDueDate, "تاریخ سررسید چک")
        : undefined;
    // Reuse creation's validation by checking the invoice balance here.
    if (args.invoiceId) {
      const invoice = await ctx.db.get(args.invoiceId);
      if (!invoice || invoice.businessId !== args.businessId) {
        throw new ConvexError("فاکتور انتخاب‌شده یافت نشد.");
      }
      if (
        amount >
        Math.max(
          0,
          invoice.total -
            (invoice.returnedAmount ?? 0) -
            (invoice.paidAmount ?? 0),
        )
      ) {
        throw new ConvexError("مبلغ دریافت از مانده فاکتور بیشتر است.");
      }
    }
    if (args.method === "check") {
      if (checkDueDate !== undefined && checkDueDate < occurredAt) {
        throw new ConvexError("تاریخ سررسید چک نمی‌تواند قبل از تاریخ دریافت باشد.");
      }
    } else if (args.destinationType === "bank" && !args.bankAccountId) {
      throw new ConvexError("حساب بانکی مقصد را انتخاب کنید.");
    } else if (args.destinationType === "cash" && !args.cashFundId) {
      throw new ConvexError("صندوق مقصد را انتخاب کنید.");
    }
    const scope = await resolveDocumentScope(ctx, args.businessId, occurredAt);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی دریافت مشخص نیست.");
    }
    await ctx.db.patch(row._id, {
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      partyType: args.customerId ? "customer" : args.partyType,
      customerId: args.customerId,
      partyName: requireString(args.partyName, "دریافت از", { max: 160 }),
      invoiceId: args.invoiceId,
      amount,
      method: args.method,
      destinationType: args.destinationType,
      bankAccountId:
        args.destinationType === "bank" ? args.bankAccountId : undefined,
      cashFundId:
        args.destinationType === "cash" ? args.cashFundId : undefined,
      trackingNumber: optionalString(args.trackingNumber, "شماره پیگیری", 100),
      description:
        (requireString(args.description, "شرح دریافت", {
          max: 500,
        }) as string) || "",
      occurredAt,
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 160),
      checkDueDate:
        args.method === "check"
          ? (checkDueDate ?? occurredAt + 30 * 24 * 60 * 60 * 1000)
          : undefined,
      checkBankName: optionalString(args.checkBankName, "بانک چک", 100),
      checkBankBranch: optionalString(args.checkBankBranch, "شعبه چک", 100),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "receipt.update",
      entity: "receipts",
      entityId: row._id,
      summary: `ویرایش پیش‌نویس دریافت ${row.number}`,
    });
    return { receiptId: row._id };
  },
});

export const post = mutation({
  args: {
    businessId: v.id("businesses"),
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadReceipt(ctx, args.businessId, args.receiptId);
    if (row.status !== "draft") {
      throw new ConvexError("این دریافت قبلاً تأیید یا لغو شده است.");
    }
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      row.fiscalYearId,
    );
    assertDocumentDateInFiscalYear(fiscalYear, row.occurredAt);

    let invoice: Doc<"invoices"> | null = null;
    if (row.invoiceId) {
      invoice = await ctx.db.get(row.invoiceId);
      if (!invoice || invoice.businessId !== args.businessId) {
        throw new ConvexError("فاکتور مرتبط با دریافت یافت نشد.");
      }
      if (invoice.status !== "issued") {
        throw new ConvexError("فاکتور مرتبط دیگر قابل دریافت نیست.");
      }
      const outstanding = Math.max(
        0,
        invoice.total -
          (invoice.returnedAmount ?? 0) -
          (invoice.paidAmount ?? 0),
      );
      if (row.amount > outstanding) {
        throw new ConvexError("مبلغ دریافت از مانده فاکتور بیشتر است.");
      }
    }

    const creditKey =
      row.partyType === "customer" || invoice ? "receivable" : "otherIncome";
    const creditAccount = await systemAccount(
      ctx,
      args.businessId,
      creditKey,
      user._id,
    );

    let journal;
    let checkId: Id<"receivedChecks"> | null = row.checkId ?? null;
    let destinationName = "";
    if (row.method === "check") {
      const checkAccount = await systemAccount(
        ctx,
        args.businessId,
        "checksReceivable",
        user._id,
      );
      if (checkId) {
        const existing = await ctx.db.get(checkId);
        if (!existing || existing.businessId !== args.businessId) {
          throw new ConvexError("چک مرتبط با دریافت یافت نشد.");
        }
        if (existing.status !== "received") {
          throw new ConvexError("فقط چک دریافت‌شده قابل اتصال است.");
        }
        if (existing.amount !== row.amount) {
          throw new ConvexError("مبلغ چک با مبلغ دریافت برابر نیست.");
        }
        destinationName = `چک ${existing.checkNumber}`;
      } else {
        const checkNumber =
          row.trackingNumber?.trim() || row.number.replace("RCP-", "CHK-");
        const duplicate = await ctx.db
          .query("receivedChecks")
          .withIndex("by_business_number", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("checkNumber", checkNumber),
          )
          .unique();
        if (duplicate) {
          throw new ConvexError("این شماره چک قبلاً در چک‌های دریافتی ثبت شده است.");
        }
        const now = Date.now();
        checkId = await ctx.db.insert("receivedChecks", {
          businessId: args.businessId,
          branchId: row.branchId,
          fiscalYearId: row.fiscalYearId,
          checkNumber,
          amount: row.amount,
          issueDate: row.occurredAt,
          dueDate:
            row.checkDueDate ??
            row.occurredAt + 30 * 24 * 60 * 60 * 1000,
          bankName: row.checkBankName ?? "ثبت‌شده از دریافت",
          bankBranch: row.checkBankBranch,
          issuerName: row.partyName,
          customerId: row.customerId,
          description: `ایجاد خودکار از دریافت ${row.number}`,
          status: "received",
          createdBy: user._id,
          createdAt: now,
          updatedAt: now,
        });
        destinationName = "چک دریافتی";
      }

      journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: row.occurredAt,
        description: `دریافت چک ${row.number} از ${row.partyName}`,
        sourceType: "receipt",
        sourceId: row._id as string,
        branchId: row.branchId,
        lines: [
          {
            accountId: checkAccount._id,
            description: `چک دریافت ${row.number}`,
            debit: row.amount,
            credit: 0,
          },
          {
            accountId: creditAccount._id,
            description: `دریافت از ${row.partyName}`,
            debit: 0,
            credit: row.amount,
          },
        ],
      });

      await ctx.db.patch(checkId, {
        accountingDocumentId: journal.documentId,
        lastAccountingDocumentId: journal.documentId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("checkStatusHistory", {
        businessId: args.businessId,
        checkType: "received",
        checkId: checkId as string,
        toStatus: "received",
        note: "ثبت همراه دریافت وجه",
        accountingDocumentId: journal.documentId,
        actorId: user._id,
        createdAt: Date.now(),
      });
    } else {
      const ref = await resolveFinancialAccount(
        ctx,
        args.businessId,
        accountRef(row),
      );
      journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: row.occurredAt,
        description: `دریافت ${row.number} از ${row.partyName}`,
        sourceType: "receipt",
        sourceId: row._id as string,
        branchId: row.branchId,
        lines: [
          {
            accountId: ref.accountId,
            description: `دریافت ${row.number}`,
            debit: row.amount,
            credit: 0,
          },
          {
            accountId: creditAccount._id,
            description: `دریافت از ${row.partyName}`,
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
        direction: "in",
        amount: row.amount,
        occurredAt: row.occurredAt,
        operationType: "receipt",
        operationId: row._id as string,
        description: `دریافت ${row.number} — ${row.partyName}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
      destinationName = ref.name;
    }

    if (invoice) {
      const paidAmount = (invoice.paidAmount ?? 0) + row.amount;
      await ctx.db.patch(invoice._id, {
        paidAmount,
        status: paidAmount >= invoice.total ? "paid" : invoice.status,
        paidAt:
          paidAmount >= invoice.total ? row.occurredAt : invoice.paidAt,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(row._id, {
      status: "posted",
      checkId: checkId ?? undefined,
      accountingDocumentId: journal.documentId,
      postedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "receipt.post",
      entity: "receipts",
      entityId: row._id,
      summary: `تأیید دریافت ${row.number} — ${row.amount} — ${destinationName}`,
    });
    return {
      receiptId: row._id,
      accountingDocumentId: journal.documentId,
      accountingNumber: journal.number,
      checkId,
    };
  },
});

export const removeDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    receiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadReceipt(ctx, args.businessId, args.receiptId);
    if (row.status !== "draft") {
      throw new ConvexError("فقط دریافت پیش‌نویس قابل حذف است.");
    }
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "receipt.delete-draft",
      entity: "receipts",
      entityId: row._id,
      summary: `حذف پیش‌نویس دریافت ${row.number}`,
    });
    return { receiptId: row._id };
  },
});
