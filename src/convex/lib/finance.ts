import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  assertDocumentDateInFiscalYear,
  nextDocumentNumber,
  validateDocumentLines,
  writeAccountingAudit,
  type DocumentLineInput,
} from "./accounting";
import { ensureChartOfAccounts, getSystemAccount } from "./accounts";
import { resolveDocumentScope } from "./workspace";
import { writeAudit } from "./tenant";

type Ctx = QueryCtx | MutationCtx;

export interface FinancialAccountRef {
  type: "bank" | "cash";
  bankAccountId?: Id<"bankAccounts">;
  cashFundId?: Id<"cashFunds">;
}

export async function resolveFinancialAccount(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  ref: FinancialAccountRef,
) {
  if (ref.type === "bank") {
    if (!ref.bankAccountId) {
      throw new ConvexError("حساب بانکی مبدأ/مقصد را انتخاب کنید.");
    }
    const bank = await ctx.db.get(ref.bankAccountId);
    if (!bank || bank.businessId !== businessId) {
      throw new ConvexError("حساب بانکی انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }
    if (!bank.active) {
      throw new ConvexError("حساب بانکی غیرفعال قابل استفاده نیست.");
    }
    return {
      type: "bank" as const,
      id: bank._id,
      name: bank.name,
      bankName: bank.bankName,
      accountId: bank.accountId,
    };
  }

  if (!ref.cashFundId) {
    throw new ConvexError("صندوق مبدأ/مقصد را انتخاب کنید.");
  }
  const fund = await ctx.db.get(ref.cashFundId);
  if (!fund || fund.businessId !== businessId) {
    throw new ConvexError("صندوق انتخاب‌شده در این کسب‌وکار یافت نشد.");
  }
  if (!fund.active) {
    throw new ConvexError("صندوق غیرفعال قابل استفاده نیست.");
  }
  return {
    type: "cash" as const,
    id: fund._id,
    name: fund.name,
    bankName: undefined,
    accountId: fund.accountId,
  };
}

export async function financialBalance(
  ctx: Ctx,
  ref: { type: "bank" | "cash"; id: string },
  asOf?: number,
) {
  const rows =
    ref.type === "bank"
      ? await ctx.db
          .query("financialTransactions")
          .withIndex("by_bank_occurred", (q) => {
            const base = q.eq(
              "bankAccountId",
              ref.id as Id<"bankAccounts">,
            );
            return asOf === undefined
              ? base
              : base.lte("occurredAt", asOf);
          })
          .take(5000)
      : await ctx.db
          .query("financialTransactions")
          .withIndex("by_cash_occurred", (q) => {
            const base = q.eq("cashFundId", ref.id as Id<"cashFunds">);
            return asOf === undefined
              ? base
              : base.lte("occurredAt", asOf);
          })
          .take(5000);

  return rows.reduce(
    (sum, row) => sum + (row.direction === "in" ? row.amount : -row.amount),
    0,
  );
}

export async function recordFinancialMovement(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    branchId: Id<"branches">;
    fiscalYearId: Id<"fiscalYears">;
    account: Awaited<ReturnType<typeof resolveFinancialAccount>>;
    direction: "in" | "out";
    amount: number;
    occurredAt: number;
    operationType: string;
    operationId: string;
    description: string;
    accountingDocumentId: Id<"accountingDocuments">;
    actorId: Id<"users">;
  },
) {
  const now = Date.now();
  return await ctx.db.insert("financialTransactions", {
    businessId: input.businessId,
    branchId: input.branchId,
    fiscalYearId: input.fiscalYearId,
    accountType: input.account.type,
    bankAccountId:
      input.account.type === "bank"
        ? (input.account.id as Id<"bankAccounts">)
        : undefined,
    cashFundId:
      input.account.type === "cash"
        ? (input.account.id as Id<"cashFunds">)
        : undefined,
    direction: input.direction,
    amount: input.amount,
    occurredAt: input.occurredAt,
    operationType: input.operationType,
    operationId: input.operationId,
    description: input.description,
    accountingDocumentId: input.accountingDocumentId,
    createdBy: input.actorId,
    createdAt: now,
  });
}

/**
 * Creates the one and only posted journal for a confirmed operational
 * document. The source key is checked before writing, so retries or duplicate
 * confirmations can never create a second journal for the same operation.
 */
export async function postAutoJournal(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    actorId: Id<"users">;
    occurredAt: number;
    description: string;
    lines: DocumentLineInput[];
    sourceType: string;
    sourceId: string;
    branchId?: Id<"branches">;
  },
) {
  const existing = await ctx.db
    .query("accountingDocuments")
    .withIndex("by_business_source", (q) =>
      q
        .eq("businessId", input.businessId)
        .eq("sourceType", input.sourceType)
        .eq("sourceId", input.sourceId),
    )
    .unique();
  if (existing) {
    throw new ConvexError(
      `برای این عملیات قبلاً سند حسابداری ${existing.number} ثبت شده است.`,
    );
  }

  const scope = await resolveDocumentScope(
    ctx,
    input.businessId,
    input.occurredAt,
  );
  const branchId = input.branchId ?? scope.branchId;
  const fiscalYearId = scope.fiscalYearId;
  if (!branchId || !fiscalYearId) {
    throw new ConvexError("شعبه یا دوره مالی عملیات مشخص نیست.");
  }

  const branch = await ctx.db.get(branchId);
  if (!branch || branch.businessId !== input.businessId || branch.archivedAt) {
    throw new ConvexError("شعبه عملیات در این کسب‌وکار در دسترس نیست.");
  }
  const fiscalYear = await ctx.db.get(fiscalYearId);
  if (!fiscalYear || fiscalYear.businessId !== input.businessId) {
    throw new ConvexError("دوره مالی عملیات در این کسب‌وکار در دسترس نیست.");
  }
  assertDocumentDateInFiscalYear(fiscalYear, input.occurredAt);

  const validated = await validateDocumentLines(
    ctx,
    input.businessId,
    input.lines,
    {
      requireBalanced: true,
      fallbackDescription: input.description,
    },
  );
  const { number, sequence } = await nextDocumentNumber(
    ctx,
    input.businessId,
    fiscalYear,
  );
  const now = Date.now();
  const documentId = await ctx.db.insert("accountingDocuments", {
    businessId: input.businessId,
    fiscalYearId,
    branchId,
    number,
    sequence,
    documentDate: input.occurredAt,
    description: input.description,
    status: "posted",
    kind: "normal",
    totalDebit: validated.totalDebit,
    totalCredit: validated.totalCredit,
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
    postedAt: now,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
  });

  for (const [position, line] of validated.lines.entries()) {
    await ctx.db.insert("accountingDocumentLines", {
      businessId: input.businessId,
      documentId,
      accountId: line.accountId,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      position,
    });
  }

  await writeAccountingAudit(ctx, {
    businessId: input.businessId,
    documentId,
    actorId: input.actorId,
    action: "document.auto",
    summary: `ثبت خودکار سند ${number} برای ${input.sourceType}`,
    detail: JSON.stringify({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      totalDebit: validated.totalDebit,
      totalCredit: validated.totalCredit,
    }),
  });

  return {
    documentId,
    number,
    sequence,
    fiscalYearId,
    branchId,
    totalDebit: validated.totalDebit,
    totalCredit: validated.totalCredit,
  };
}

/** Creates a dedicated postable GL account under 1101 for a bank/fund. */
export async function createFinancialGlAccount(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    actorId: Id<"users">;
    name: string;
  },
) {
  await ensureChartOfAccounts(ctx, input.businessId, input.actorId);
  const parent = await ctx.db
    .query("accounts")
    .withIndex("by_business_code", (q) =>
      q.eq("businessId", input.businessId).eq("code", "1101"),
    )
    .unique();
  if (!parent || !parent.active) {
    throw new ConvexError("حساب معین نقد و بانک برای ساخت حساب مالی در دسترس نیست.");
  }
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_business", (q) => q.eq("businessId", input.businessId))
    .take(2000);
  const codes = new Set(accounts.map((account) => account.code));
  let sequence = 1;
  let code = "";
  do {
    code = `1101${String(9000 + sequence).padStart(4, "0")}`;
    sequence += 1;
  } while (codes.has(code) && sequence < 1000);
  if (codes.has(code)) {
    throw new ConvexError("کد حساب مالی خالی پیدا نشد.");
  }

  const now = Date.now();
  const accountId = await ctx.db.insert("accounts", {
    businessId: input.businessId,
    code,
    name: input.name,
    level: "detail",
    type: "asset",
    nature: "debit",
    parentId: parent._id,
    postable: true,
    detailKind: "none",
    description: "حساب خودکار متصل به حساب بانکی/صندوق",
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
    active: true,
  });

  return { accountId, code };
}

export async function systemAccount(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  key: string,
  actorId: Id<"users">,
) {
  await ensureChartOfAccounts(ctx, businessId, actorId);
  const account = await getSystemAccount(ctx, businessId, key);
  if (!account || !account.active) {
    throw new ConvexError(
      "حساب سیستمی لازم برای ثبت خودکار سند در دسترس نیست؛ کدینگ استاندارد را تکمیل کنید.",
    );
  }
  return account;
}

export async function initializeFinancialAccount(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    actorId: Id<"users">;
    accountRef: Awaited<ReturnType<typeof resolveFinancialAccount>>;
    openingBalance: number;
    openingDate: number;
    description: string;
    sourceType: string;
    sourceId: string;
  },
) {
  if (input.openingBalance <= 0) return null;
  const capital = await systemAccount(
    ctx,
    input.businessId,
    "capital",
    input.actorId,
  );
  const journal = await postAutoJournal(ctx, {
    businessId: input.businessId,
    actorId: input.actorId,
    occurredAt: input.openingDate,
    description: input.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    lines: [
      {
        accountId: input.accountRef.accountId,
        description: "موجودی اولیه",
        debit: input.openingBalance,
        credit: 0,
      },
      {
        accountId: capital._id,
        description: "افتتاحیه سرمایه",
        debit: 0,
        credit: input.openingBalance,
      },
    ],
  });
  const scope = await resolveDocumentScope(
    ctx,
    input.businessId,
    input.openingDate,
  );
  if (!scope.branchId || !scope.fiscalYearId) {
    throw new ConvexError("شعبه یا دوره مالی برای موجودی اولیه مشخص نیست.");
  }
  await recordFinancialMovement(ctx, {
    businessId: input.businessId,
    branchId: scope.branchId,
    fiscalYearId: scope.fiscalYearId,
    account: input.accountRef,
    direction: "in",
    amount: input.openingBalance,
    occurredAt: input.openingDate,
    operationType: "opening",
    operationId: input.sourceId,
    description: input.description,
    accountingDocumentId: journal.documentId,
    actorId: input.actorId,
  });
  return journal;
}

export async function auditFinance(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    actorId: Id<"users">;
    action: string;
    entity: string;
    entityId: string;
    summary: string;
  },
) {
  await writeAudit(ctx, input);
}
