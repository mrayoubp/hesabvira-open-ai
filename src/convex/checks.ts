import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership, writeAudit } from "./lib/tenant";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";
import { MAX_AMOUNT } from "./lib/accounting";
import { resolveDocumentScope } from "./lib/workspace";
import {
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
  systemAccount,
} from "./lib/finance";
import {
  checkDirectionValidator,
  issuedCheckStatusValidator,
  receivedCheckStatusValidator,
} from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

const RECEIVED_TRANSITIONS: Record<string, string[]> = {
  received: ["pending", "assigned", "collected", "bounced", "cancelled"],
  pending: ["assigned", "collected", "bounced", "cancelled"],
  assigned: ["collected", "bounced", "cancelled"],
  collected: [],
  bounced: [],
  cancelled: [],
};

const ISSUED_TRANSITIONS: Record<string, string[]> = {
  issued: ["delivered", "collected", "cancelled", "bounced"],
  delivered: ["collected", "cancelled", "bounced"],
  collected: [],
  cancelled: [],
  bounced: [],
};

function validateDate(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConvexError(`${label} معتبر نیست.`);
  }
  return value;
}

function dueMeta(dueDate: number, status: string) {
  const days = Math.ceil((dueDate - Date.now()) / DAY_MS);
  return {
    daysToDue: days,
    overdue: days < 0 && !["collected", "bounced", "cancelled"].includes(status),
    dueSoon:
      days >= 0 &&
      days <= 14 &&
      !["collected", "bounced", "cancelled"].includes(status),
  };
}

async function loadReceived(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  checkId: Id<"receivedChecks">,
) {
  const row = await ctx.db.get(checkId);
  if (!row || row.businessId !== businessId) {
    throw new ConvexError("چک دریافتی در این کسب‌وکار یافت نشد.");
  }
  return row;
}

async function loadIssued(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  checkId: Id<"issuedChecks">,
) {
  const row = await ctx.db.get(checkId);
  if (!row || row.businessId !== businessId) {
    throw new ConvexError("چک پرداختی در این کسب‌وکار یافت نشد.");
  }
  return row;
}

async function ensureUniqueReceivedNumber(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  checkNumber: string,
  exceptId?: Id<"receivedChecks">,
) {
  const duplicate = await ctx.db
    .query("receivedChecks")
    .withIndex("by_business_number", (q) =>
      q.eq("businessId", businessId).eq("checkNumber", checkNumber),
    )
    .unique();
  if (duplicate && duplicate._id !== exceptId) {
    throw new ConvexError("این شماره چک قبلاً در چک‌های دریافتی ثبت شده است.");
  }
}

async function ensureUniqueIssuedNumber(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  checkNumber: string,
  exceptId?: Id<"issuedChecks">,
) {
  const duplicate = await ctx.db
    .query("issuedChecks")
    .withIndex("by_business_number", (q) =>
      q.eq("businessId", businessId).eq("checkNumber", checkNumber),
    )
    .unique();
  if (duplicate && duplicate._id !== exceptId) {
    throw new ConvexError("این شماره چک قبلاً در چک‌های پرداختی ثبت شده است.");
  }
}

export const receivedList = query({
  args: {
    businessId: v.id("businesses"),
    status: v.optional(receivedCheckStatusValidator),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("receivedChecks")
      .withIndex("by_business_due", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(1000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter((row) => !args.from || row.issueDate >= args.from)
      .filter((row) => !args.to || row.issueDate <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return [row.checkNumber, row.bankName, row.issuerName, row.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
    const customerIds = [
      ...new Set(
        filtered
          .map((row) => row.customerId)
          .filter((id): id is Id<"customers"> => Boolean(id)),
      ),
    ];
    const customers = await Promise.all(
      customerIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map(
      customers
        .filter((row): row is Doc<"customers"> => Boolean(row))
        .map((row) => [row._id as string, row.name]),
    );
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    return filtered.slice(0, limit).map((row) => ({
      _id: row._id as string,
      checkNumber: row.checkNumber,
      amount: row.amount,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      bankName: row.bankName,
      bankBranch: row.bankBranch ?? null,
      issuerName: row.issuerName,
      customerId: row.customerId ? (row.customerId as string) : null,
      customerName: row.customerId
        ? (names.get(row.customerId as string) ?? null)
        : null,
      description: row.description ?? null,
      status: row.status,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      lastAccountingDocumentId: row.lastAccountingDocumentId
        ? (row.lastAccountingDocumentId as string)
        : null,
      ...dueMeta(row.dueDate, row.status),
      createdAt: row.createdAt,
    }));
  },
});

export const receivedGet = query({
  args: {
    businessId: v.id("businesses"),
    checkId: v.id("receivedChecks"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const row = await loadReceived(ctx, args.businessId, args.checkId);
    const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
    return {
      _id: row._id as string,
      checkNumber: row.checkNumber,
      amount: row.amount,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      bankName: row.bankName,
      bankBranch: row.bankBranch ?? null,
      issuerName: row.issuerName,
      customerId: row.customerId ? (row.customerId as string) : null,
      customerName: customer?.name ?? null,
      description: row.description ?? null,
      status: row.status,
      collectedBankAccountId: row.collectedBankAccountId
        ? (row.collectedBankAccountId as string)
        : null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      lastAccountingDocumentId: row.lastAccountingDocumentId
        ? (row.lastAccountingDocumentId as string)
        : null,
      ...dueMeta(row.dueDate, row.status),
      createdAt: row.createdAt,
    };
  },
});

export const createReceived = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    checkNumber: v.string(),
    amount: v.number(),
    issueDate: v.number(),
    dueDate: v.number(),
    bankName: v.string(),
    bankBranch: v.optional(v.string()),
    issuerName: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }
    const checkNumber = requireString(args.checkNumber, "شماره چک", {
      max: 50,
    }) as string;
    await ensureUniqueReceivedNumber(ctx, args.businessId, checkNumber);
    const amount = requireInt(args.amount, "مبلغ چک", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const issueDate = validateDate(args.issueDate, "تاریخ صدور");
    const dueDate = validateDate(args.dueDate, "تاریخ سررسید");
    if (dueDate < issueDate) {
      throw new ConvexError("تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد.");
    }
    const bankName = requireString(args.bankName, "بانک چک", {
      max: 100,
    }) as string;
    const issuerName =
      optionalString(args.issuerName, "صادرکننده", 160) ?? customer.name;
    const scope = await resolveDocumentScope(ctx, args.businessId, issueDate);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی چک مشخص نیست.");
    }
    const receivable = await systemAccount(
      ctx,
      args.businessId,
      "receivable",
      user._id,
    );
    const checksReceivable = await systemAccount(
      ctx,
      args.businessId,
      "checksReceivable",
      user._id,
    );
    const now = Date.now();
    const checkId = await ctx.db.insert("receivedChecks", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      checkNumber,
      amount,
      issueDate,
      dueDate,
      bankName,
      bankBranch: optionalString(args.bankBranch, "شعبه بانک", 100),
      issuerName,
      customerId: customer._id,
      description: optionalString(args.description, "توضیحات", 500),
      status: "received",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: issueDate,
      description: `دریافت چک ${checkNumber} از ${customer.name}`,
      sourceType: "received-check",
      sourceId: checkId as string,
      branchId: scope.branchId,
      lines: [
        {
          accountId: checksReceivable._id,
          description: `چک دریافتی ${checkNumber}`,
          debit: amount,
          credit: 0,
        },
        {
          accountId: receivable._id,
          description: `کاهش مطالبات ${customer.name}`,
          debit: 0,
          credit: amount,
        },
      ],
    });
    await ctx.db.patch(checkId, {
      accountingDocumentId: journal.documentId,
      lastAccountingDocumentId: journal.documentId,
    });
    await ctx.db.insert("checkStatusHistory", {
      businessId: args.businessId,
      checkType: "received",
      checkId: checkId as string,
      toStatus: "received",
      note: "ثبت اولیه چک",
      accountingDocumentId: journal.documentId,
      actorId: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "check.received",
      entity: "receivedChecks",
      entityId: checkId,
      summary: `ثبت چک دریافتی ${checkNumber} از ${customer.name}`,
    });
    return {
      checkId,
      accountingDocumentId: journal.documentId,
      accountingNumber: journal.number,
    };
  },
});

export const updateReceived = mutation({
  args: {
    businessId: v.id("businesses"),
    checkId: v.id("receivedChecks"),
    checkNumber: v.string(),
    issueDate: v.number(),
    dueDate: v.number(),
    bankName: v.string(),
    bankBranch: v.optional(v.string()),
    issuerName: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadReceived(ctx, args.businessId, args.checkId);
    if (!["received", "pending", "assigned"].includes(row.status)) {
      throw new ConvexError("این چک در وضعیت فعلی قابل ویرایش نیست.");
    }
    const checkNumber = requireString(args.checkNumber, "شماره چک", {
      max: 50,
    }) as string;
    await ensureUniqueReceivedNumber(
      ctx,
      args.businessId,
      checkNumber,
      row._id,
    );
    const issueDate = validateDate(args.issueDate, "تاریخ صدور");
    const dueDate = validateDate(args.dueDate, "تاریخ سررسید");
    if (dueDate < issueDate) {
      throw new ConvexError("تاریخ سررسید قبل از تاریخ صدور است.");
    }
    await ctx.db.patch(row._id, {
      checkNumber,
      issueDate,
      dueDate,
      bankName: requireString(args.bankName, "بانک چک", { max: 100 }),
      bankBranch: optionalString(args.bankBranch, "شعبه بانک", 100),
      issuerName: requireString(args.issuerName, "صادرکننده", { max: 160 }),
      description: optionalString(args.description, "توضیحات", 500),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "check.received.update",
      entity: "receivedChecks",
      entityId: row._id,
      summary: `ویرایش چک دریافتی ${checkNumber}`,
    });
    return { checkId: row._id };
  },
});

export const changeReceivedStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    checkId: v.id("receivedChecks"),
    status: receivedCheckStatusValidator,
    bankAccountId: v.optional(v.id("bankAccounts")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadReceived(ctx, args.businessId, args.checkId);
    const allowed = RECEIVED_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(args.status)) {
      throw new ConvexError(
        `تغییر وضعیت از ${row.status} به ${args.status} مجاز نیست.`,
      );
    }
    const now = Date.now();
    let journal: Awaited<ReturnType<typeof postAutoJournal>> | null = null;
    let bankRef: Awaited<ReturnType<typeof resolveFinancialAccount>> | null =
      null;
    const note = optionalString(args.note, "توضیح تغییر وضعیت", 300);

    if (args.status === "collected") {
      if (!args.bankAccountId) {
        throw new ConvexError("برای ثبت وصول، حساب بانکی مقصد را انتخاب کنید.");
      }
      bankRef = await resolveFinancialAccount(ctx, args.businessId, {
        type: "bank",
        bankAccountId: args.bankAccountId,
      });
      const checksReceivable = await systemAccount(
        ctx,
        args.businessId,
        "checksReceivable",
        user._id,
      );
      journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: now,
        description: `وصول چک ${row.checkNumber} — ${row.issuerName}`,
        sourceType: "received-check-collection",
        sourceId: row._id as string,
        branchId: row.branchId,
        lines: [
          {
            accountId: bankRef.accountId,
            description: `وصول چک ${row.checkNumber}`,
            debit: row.amount,
            credit: 0,
          },
          {
            accountId: checksReceivable._id,
            description: `کاهش چک‌های در جریان وصول`,
            debit: 0,
            credit: row.amount,
          },
        ],
      });
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: journal.branchId,
        fiscalYearId: journal.fiscalYearId,
        account: bankRef,
        direction: "in",
        amount: row.amount,
        occurredAt: now,
        operationType: "check-collection",
        operationId: row._id as string,
        description: `وصول چک ${row.checkNumber}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    } else if (args.status === "bounced" || args.status === "cancelled") {
      const checksReceivable = await systemAccount(
        ctx,
        args.businessId,
        "checksReceivable",
        user._id,
      );
      const receivable = await systemAccount(
        ctx,
        args.businessId,
        "receivable",
        user._id,
      );
      journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: now,
        description: `${args.status === "bounced" ? "برگشت" : "ابطال"} چک ${row.checkNumber}`,
        sourceType: `received-check-${args.status}`,
        sourceId: row._id as string,
        branchId: row.branchId,
        lines: [
          {
            accountId: receivable._id,
            description: `بازگشت مطالبات چک ${row.checkNumber}`,
            debit: row.amount,
            credit: 0,
          },
          {
            accountId: checksReceivable._id,
            description: `خروج چک از جریان وصول`,
            debit: 0,
            credit: row.amount,
          },
        ],
      });
    }

    await ctx.db.patch(row._id, {
      status: args.status,
      collectedBankAccountId:
        args.status === "collected"
          ? (args.bankAccountId as Id<"bankAccounts">)
          : row.collectedBankAccountId,
      lastAccountingDocumentId: journal
        ? journal.documentId
        : row.lastAccountingDocumentId,
      updatedAt: now,
    });
    await ctx.db.insert("checkStatusHistory", {
      businessId: args.businessId,
      checkType: "received",
      checkId: row._id as string,
      fromStatus: row.status,
      toStatus: args.status,
      note,
      accountingDocumentId: journal?.documentId,
      actorId: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: `check.received.${args.status}`,
      entity: "receivedChecks",
      entityId: row._id,
      summary: `تغییر وضعیت چک ${row.checkNumber} به ${args.status}`,
    });
    return {
      checkId: row._id,
      status: args.status,
      accountingDocumentId: journal?.documentId ?? null,
      accountingNumber: journal?.number ?? null,
    };
  },
});

export const issuedList = query({
  args: {
    businessId: v.id("businesses"),
    status: v.optional(issuedCheckStatusValidator),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("issuedChecks")
      .withIndex("by_business_due", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(1000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => !args.status || row.status === args.status)
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter((row) => !args.from || row.issueDate >= args.from)
      .filter((row) => !args.to || row.issueDate <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return [row.checkNumber, row.payeeName, row.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
    const bankIds = [
      ...new Set(filtered.map((row) => row.bankAccountId)),
    ];
    const banks = await Promise.all(bankIds.map((id) => ctx.db.get(id)));
    const bankNames = new Map(
      banks
        .filter((row): row is Doc<"bankAccounts"> => Boolean(row))
        .map((row) => [row._id as string, row.name]),
    );
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    return filtered.slice(0, limit).map((row) => ({
      _id: row._id as string,
      checkNumber: row.checkNumber,
      amount: row.amount,
      payeeName: row.payeeName,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      bankAccountId: row.bankAccountId as string,
      bankName: bankNames.get(row.bankAccountId as string) ?? "—",
      status: row.status,
      description: row.description ?? null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      lastAccountingDocumentId: row.lastAccountingDocumentId
        ? (row.lastAccountingDocumentId as string)
        : null,
      ...dueMeta(row.dueDate, row.status),
      createdAt: row.createdAt,
    }));
  },
});

export const issuedGet = query({
  args: {
    businessId: v.id("businesses"),
    checkId: v.id("issuedChecks"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const row = await loadIssued(ctx, args.businessId, args.checkId);
    const bank = await ctx.db.get(row.bankAccountId);
    return {
      _id: row._id as string,
      checkNumber: row.checkNumber,
      amount: row.amount,
      payeeName: row.payeeName,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      bankAccountId: row.bankAccountId as string,
      bankName: bank?.name ?? "—",
      status: row.status,
      description: row.description ?? null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      lastAccountingDocumentId: row.lastAccountingDocumentId
        ? (row.lastAccountingDocumentId as string)
        : null,
      ...dueMeta(row.dueDate, row.status),
      createdAt: row.createdAt,
    };
  },
});

export const createIssued = mutation({
  args: {
    businessId: v.id("businesses"),
    bankAccountId: v.id("bankAccounts"),
    checkNumber: v.string(),
    amount: v.number(),
    payeeName: v.string(),
    issueDate: v.number(),
    dueDate: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const bank = await resolveFinancialAccount(ctx, args.businessId, {
      type: "bank",
      bankAccountId: args.bankAccountId,
    });
    const checkNumber = requireString(args.checkNumber, "شماره چک", {
      max: 50,
    }) as string;
    await ensureUniqueIssuedNumber(ctx, args.businessId, checkNumber);
    const amount = requireInt(args.amount, "مبلغ چک", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const issueDate = validateDate(args.issueDate, "تاریخ صدور");
    const dueDate = validateDate(args.dueDate, "تاریخ سررسید");
    if (dueDate < issueDate) {
      throw new ConvexError("تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد.");
    }
    const payeeName = requireString(args.payeeName, "ذی‌نفع", {
      max: 160,
    }) as string;
    const scope = await resolveDocumentScope(ctx, args.businessId, issueDate);
    if (!scope.branchId || !scope.fiscalYearId) {
      throw new ConvexError("شعبه یا دوره مالی چک مشخص نیست.");
    }
    const payable = await systemAccount(
      ctx,
      args.businessId,
      "payable",
      user._id,
    );
    const checksPayable = await systemAccount(
      ctx,
      args.businessId,
      "checksPayable",
      user._id,
    );
    const now = Date.now();
    const checkId = await ctx.db.insert("issuedChecks", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      bankAccountId: bank.id as Id<"bankAccounts">,
      checkNumber,
      amount,
      payeeName,
      issueDate,
      dueDate,
      status: "issued",
      description: optionalString(args.description, "توضیحات", 500),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: issueDate,
      description: `صدور چک ${checkNumber} به ${payeeName}`,
      sourceType: "issued-check",
      sourceId: checkId as string,
      branchId: scope.branchId,
      lines: [
        {
          accountId: payable._id,
          description: `پرداخت به ${payeeName} با چک`,
          debit: amount,
          credit: 0,
        },
        {
          accountId: checksPayable._id,
          description: `چک پرداختنی ${checkNumber}`,
          debit: 0,
          credit: amount,
        },
      ],
    });
    await ctx.db.patch(checkId, {
      accountingDocumentId: journal.documentId,
      lastAccountingDocumentId: journal.documentId,
    });
    await ctx.db.insert("checkStatusHistory", {
      businessId: args.businessId,
      checkType: "issued",
      checkId: checkId as string,
      toStatus: "issued",
      note: "صدور چک",
      accountingDocumentId: journal.documentId,
      actorId: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "check.issued",
      entity: "issuedChecks",
      entityId: checkId,
      summary: `صدور چک ${checkNumber} به ${payeeName}`,
    });
    return {
      checkId,
      accountingDocumentId: journal.documentId,
      accountingNumber: journal.number,
    };
  },
});

export const updateIssued = mutation({
  args: {
    businessId: v.id("businesses"),
    checkId: v.id("issuedChecks"),
    bankAccountId: v.id("bankAccounts"),
    checkNumber: v.string(),
    issueDate: v.number(),
    dueDate: v.number(),
    payeeName: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadIssued(ctx, args.businessId, args.checkId);
    if (!["issued", "delivered"].includes(row.status)) {
      throw new ConvexError("این چک در وضعیت فعلی قابل ویرایش نیست.");
    }
    const bank = await resolveFinancialAccount(ctx, args.businessId, {
      type: "bank",
      bankAccountId: args.bankAccountId,
    });
    const checkNumber = requireString(args.checkNumber, "شماره چک", {
      max: 50,
    }) as string;
    await ensureUniqueIssuedNumber(
      ctx,
      args.businessId,
      checkNumber,
      row._id,
    );
    const issueDate = validateDate(args.issueDate, "تاریخ صدور");
    const dueDate = validateDate(args.dueDate, "تاریخ سررسید");
    if (dueDate < issueDate) {
      throw new ConvexError("تاریخ سررسید قبل از تاریخ صدور است.");
    }
    await ctx.db.patch(row._id, {
      bankAccountId: bank.id as Id<"bankAccounts">,
      checkNumber,
      issueDate,
      dueDate,
      payeeName: requireString(args.payeeName, "ذی‌نفع", { max: 160 }),
      description: optionalString(args.description, "توضیحات", 500),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "check.issued.update",
      entity: "issuedChecks",
      entityId: row._id,
      summary: `ویرایش چک پرداختی ${checkNumber}`,
    });
    return { checkId: row._id };
  },
});

export const changeIssuedStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    checkId: v.id("issuedChecks"),
    status: issuedCheckStatusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await loadIssued(ctx, args.businessId, args.checkId);
    const allowed = ISSUED_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(args.status)) {
      throw new ConvexError(
        `تغییر وضعیت از ${row.status} به ${args.status} مجاز نیست.`,
      );
    }
    const now = Date.now();
    let journal: Awaited<ReturnType<typeof postAutoJournal>> | null = null;
    let bankRef: Awaited<ReturnType<typeof resolveFinancialAccount>> | null =
      null;
    if (args.status === "collected") {
      bankRef = await resolveFinancialAccount(ctx, args.businessId, {
        type: "bank",
        bankAccountId: row.bankAccountId,
      });
      const checksPayable = await systemAccount(
        ctx,
        args.businessId,
        "checksPayable",
        user._id,
      );
      journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: now,
        description: `وصول چک پرداختی ${row.checkNumber} توسط ${row.payeeName}`,
        sourceType: "issued-check-collection",
        sourceId: row._id as string,
        branchId: row.branchId,
        lines: [
          {
            accountId: checksPayable._id,
            description: `تسویه چک پرداختنی ${row.checkNumber}`,
            debit: row.amount,
            credit: 0,
          },
          {
            accountId: bankRef.accountId,
            description: `برداشت بانکی برای چک ${row.checkNumber}`,
            debit: 0,
            credit: row.amount,
          },
        ],
      });
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: journal.branchId,
        fiscalYearId: journal.fiscalYearId,
        account: bankRef,
        direction: "out",
        amount: row.amount,
        occurredAt: now,
        operationType: "check-payment",
        operationId: row._id as string,
        description: `وصول چک ${row.checkNumber}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    } else if (args.status === "cancelled" || args.status === "bounced") {
      const checksPayable = await systemAccount(
        ctx,
        args.businessId,
        "checksPayable",
        user._id,
      );
      const payable = await systemAccount(
        ctx,
        args.businessId,
        "payable",
        user._id,
      );
      journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: now,
        description: `${args.status === "cancelled" ? "ابطال" : "برگشت"} چک ${row.checkNumber}`,
        sourceType: `issued-check-${args.status}`,
        sourceId: row._id as string,
        branchId: row.branchId,
        lines: [
          {
            accountId: checksPayable._id,
            description: `خروج چک از اسناد پرداختنی`,
            debit: row.amount,
            credit: 0,
          },
          {
            accountId: payable._id,
            description: `بازگشت بدهی به ${row.payeeName}`,
            debit: 0,
            credit: row.amount,
          },
        ],
      });
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      lastAccountingDocumentId: journal
        ? journal.documentId
        : row.lastAccountingDocumentId,
      updatedAt: now,
    });
    await ctx.db.insert("checkStatusHistory", {
      businessId: args.businessId,
      checkType: "issued",
      checkId: row._id as string,
      fromStatus: row.status,
      toStatus: args.status,
      note: optionalString(args.note, "توضیح تغییر وضعیت", 300),
      accountingDocumentId: journal?.documentId,
      actorId: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: `check.issued.${args.status}`,
      entity: "issuedChecks",
      entityId: row._id,
      summary: `تغییر وضعیت چک پرداختی ${row.checkNumber} به ${args.status}`,
    });
    return {
      checkId: row._id,
      status: args.status,
      accountingDocumentId: journal?.documentId ?? null,
      accountingNumber: journal?.number ?? null,
    };
  },
});

export const history = query({
  args: {
    businessId: v.id("businesses"),
    checkType: checkDirectionValidator,
    checkId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("checkStatusHistory")
      .withIndex("by_check", (q) =>
        q.eq("checkType", args.checkType).eq("checkId", args.checkId),
      )
      .order("asc")
      .take(100);
    const actorIds = [...new Set(rows.map((row) => row.actorId))];
    const actors = await Promise.all(
      actorIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map(
      actors
        .filter((row): row is Doc<"users"> => Boolean(row))
        .map((row) => [row._id as string, row.name ?? row.email ?? "کاربر"]),
    );
    return rows.map((row) => ({
      _id: row._id as string,
      fromStatus: row.fromStatus ?? null,
      toStatus: row.toStatus,
      note: row.note ?? null,
      accountingDocumentId: row.accountingDocumentId
        ? (row.accountingDocumentId as string)
        : null,
      actorName: names.get(row.actorId as string) ?? "کاربر",
      createdAt: row.createdAt,
    }));
  },
});

export const options = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const [customers, banks, receivedOpen] = await Promise.all([
      ctx.db
        .query("customers")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(500),
      ctx.db
        .query("bankAccounts")
        .withIndex("by_business_active", (q) =>
          q.eq("businessId", args.businessId).eq("active", true),
        )
        .take(100),
      ctx.db
        .query("receivedChecks")
        .withIndex("by_business_status", (q) =>
          q.eq("businessId", args.businessId).eq("status", "received"),
        )
        .take(100),
    ]);
    return {
      customers: customers
        .filter((row) => !row.archivedAt)
        .map((row) => ({ _id: row._id as string, name: row.name })),
      banks: banks.map((row) => ({ _id: row._id as string, name: row.name })),
      openReceivedChecks: receivedOpen.map((row) => ({
        _id: row._id as string,
        checkNumber: row.checkNumber,
        amount: row.amount,
      })),
    };
  },
});

/** Reminder list shared by the finance dashboard and check pages. */
export const dueSoon = query({
  args: { businessId: v.id("businesses"), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const horizon = Date.now() + Math.max(1, args.days ?? 14) * DAY_MS;
    const [received, issued] = await Promise.all([
      ctx.db
        .query("receivedChecks")
        .withIndex("by_business_due", (q) =>
          q.eq("businessId", args.businessId).lte("dueDate", horizon),
        )
        .take(200),
      ctx.db
        .query("issuedChecks")
        .withIndex("by_business_due", (q) =>
          q.eq("businessId", args.businessId).lte("dueDate", horizon),
        )
        .take(200),
    ]);
    const openReceived = received.filter(
      (row) => !["collected", "bounced", "cancelled"].includes(row.status),
    );
    const openIssued = issued.filter(
      (row) => !["collected", "bounced", "cancelled"].includes(row.status),
    );
    return [
      ...openReceived.map((row) => ({
        _id: row._id as string,
        type: "received" as const,
        checkNumber: row.checkNumber,
        partyName: row.issuerName,
        amount: row.amount,
        dueDate: row.dueDate,
        status: row.status,
      })),
      ...openIssued.map((row) => ({
        _id: row._id as string,
        type: "issued" as const,
        checkNumber: row.checkNumber,
        partyName: row.payeeName,
        amount: row.amount,
        dueDate: row.dueDate,
        status: row.status,
      })),
    ].sort((a, b) => a.dueDate - b.dueDate);
  },
});
