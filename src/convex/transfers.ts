import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  nextCounter,
  padSequence,
  requireMembership,
  writeAudit,
} from "./lib/tenant";
import { requireInt, requireString } from "./lib/validation";
import { MAX_AMOUNT } from "./lib/accounting";
import {
  financialBalance,
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
  systemAccount,
} from "./lib/finance";
import { financialAccountTypeValidator } from "./schema";

function requireDate(value: number) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConvexError("تاریخ انتقال معتبر نیست.");
  }
  return value;
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("fundTransfers")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(1000);
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter((row) => !args.from || row.occurredAt >= args.from)
      .filter((row) => !args.to || row.occurredAt <= args.to)
      .filter((row) => {
        if (!needle) return true;
        return [row.number, row.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
    const bankIds = [
      ...new Set(
        filtered
          .flatMap((row) => [row.fromBankAccountId, row.toBankAccountId])
          .filter((id): id is Id<"bankAccounts"> => Boolean(id)),
      ),
    ];
    const fundIds = [
      ...new Set(
        filtered
          .flatMap((row) => [row.fromCashFundId, row.toCashFundId])
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
      fromType: row.fromType,
      fromName:
        row.fromType === "bank"
          ? (bankNames.get(row.fromBankAccountId as string) ?? "—")
          : (fundNames.get(row.fromCashFundId as string) ?? "—"),
      toType: row.toType,
      toName:
        row.toType === "bank"
          ? (bankNames.get(row.toBankAccountId as string) ?? "—")
          : (fundNames.get(row.toCashFundId as string) ?? "—"),
      amount: row.amount,
      fee: row.fee,
      occurredAt: row.occurredAt,
      description: row.description,
      accountingDocumentId: row.accountingDocumentId as string,
      createdAt: row.createdAt,
    }));
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    fromType: financialAccountTypeValidator,
    fromBankAccountId: v.optional(v.id("bankAccounts")),
    fromCashFundId: v.optional(v.id("cashFunds")),
    toType: financialAccountTypeValidator,
    toBankAccountId: v.optional(v.id("bankAccounts")),
    toCashFundId: v.optional(v.id("cashFunds")),
    amount: v.number(),
    fee: v.optional(v.number()),
    occurredAt: v.number(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const amount = requireInt(args.amount, "مبلغ انتقال", {
      min: 1,
      max: MAX_AMOUNT,
    });
    const fee = requireInt(args.fee ?? 0, "کارمزد", {
      min: 0,
      max: MAX_AMOUNT,
    });
    const occurredAt = requireDate(args.occurredAt);
    const description = requireString(args.description, "شرح انتقال", {
      max: 500,
    }) as string;
    const fromRef = {
      type: args.fromType,
      bankAccountId: args.fromBankAccountId,
      cashFundId: args.fromCashFundId,
    };
    const toRef = {
      type: args.toType,
      bankAccountId: args.toBankAccountId,
      cashFundId: args.toCashFundId,
    };
    const from = await resolveFinancialAccount(ctx, args.businessId, fromRef);
    const to = await resolveFinancialAccount(ctx, args.businessId, toRef);
    if (from.type === to.type && from.id === to.id) {
      throw new ConvexError("حساب مبدأ و مقصد نباید یکسان باشند.");
    }
    const available = await financialBalance(
      ctx,
      { type: from.type, id: from.id as string },
      occurredAt,
    );
    if (available < amount + fee) {
      throw new ConvexError(
        `موجودی حساب مبدأ کافی نیست. موجودی قابل استفاده: ${available.toLocaleString(
          "fa-IR",
        )}`,
      );
    }

    const sequence = await nextCounter(ctx, args.businessId, "fund-transfer");
    const number = padSequence(sequence, "TRF");
    const feeAccount =
      fee > 0
        ? await systemAccount(
            ctx,
            args.businessId,
            "financeExpense",
            user._id,
          )
        : null;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt,
      description: `انتقال ${number} از ${from.name} به ${to.name}`,
      sourceType: "fund-transfer",
      sourceId: `${args.businessId}:${sequence}`,
      branchId: undefined,
      lines: [
        {
          accountId: to.accountId,
          description: `واریز به ${to.name}`,
          debit: amount,
          credit: 0,
        },
        ...(feeAccount
          ? [
              {
                accountId: feeAccount._id,
                description: `کارمزد انتقال ${number}`,
                debit: fee,
                credit: 0,
              },
            ]
          : []),
        {
          accountId: from.accountId,
          description: `برداشت از ${from.name}`,
          debit: 0,
          credit: amount + fee,
        },
      ],
    });
    const transferId = await ctx.db.insert("fundTransfers", {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      number,
      sequence,
      fromType: from.type,
      fromBankAccountId:
        from.type === "bank" ? (from.id as Id<"bankAccounts">) : undefined,
      fromCashFundId:
        from.type === "cash" ? (from.id as Id<"cashFunds">) : undefined,
      toType: to.type,
      toBankAccountId:
        to.type === "bank" ? (to.id as Id<"bankAccounts">) : undefined,
      toCashFundId:
        to.type === "cash" ? (to.id as Id<"cashFunds">) : undefined,
      amount,
      fee,
      occurredAt,
      description,
      accountingDocumentId: journal.documentId,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      account: from,
      direction: "out",
      amount,
      occurredAt,
      operationType: "transfer-out",
      operationId: transferId as string,
      description: `انتقال ${number} به ${to.name}`,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    if (fee > 0) {
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: journal.branchId,
        fiscalYearId: journal.fiscalYearId,
        account: from,
        direction: "out",
        amount: fee,
        occurredAt,
        operationType: "transfer-fee",
        operationId: `${transferId}:fee`,
        description: `کارمزد انتقال ${number}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    }
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      account: to,
      direction: "in",
      amount,
      occurredAt,
      operationType: "transfer-in",
      operationId: transferId as string,
      description: `انتقال ${number} از ${from.name}`,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "transfer.create",
      entity: "fundTransfers",
      entityId: transferId,
      summary: `انتقال ${number} از ${from.name} به ${to.name} — ${amount}، کارمزد ${fee}`,
    });
    return {
      transferId,
      number,
      accountingDocumentId: journal.documentId,
      accountingNumber: journal.number,
    };
  },
});

export const options = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const [banks, funds] = await Promise.all([
      ctx.db
        .query("bankAccounts")
        .withIndex("by_business_active", (q) =>
          q.eq("businessId", args.businessId).eq("active", true),
        )
        .take(100),
      ctx.db
        .query("cashFunds")
        .withIndex("by_business_active", (q) =>
          q.eq("businessId", args.businessId).eq("active", true),
        )
        .take(100),
    ]);
    return {
      banks: banks.map((row) => ({ _id: row._id as string, name: row.name })),
      funds: funds.map((row) => ({ _id: row._id as string, name: row.name })),
    };
  },
});
