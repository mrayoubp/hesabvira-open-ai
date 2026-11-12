import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { currentJalaliYear } from "./calendar";
import {
  formatDocumentNumber,
  sanitizeNumberPrefix,
  type AccountingLineLike,
} from "./accountingMath";
import { nextCounter } from "./tenant";

export const MAX_DOCUMENT_LINES = 200;
export const MAX_AMOUNT = 9_000_000_000_000_000; // still a safe integer

export interface DocumentLineInput {
  accountId: Id<"accounts">;
  description: string;
  debit: number;
  credit: number;
}

type Ctx = QueryCtx | MutationCtx;

export async function getFiscalYear(
  ctx: Ctx,
  businessId: Id<"businesses">,
  fiscalYearId: Id<"fiscalYears">,
) {
  const fiscalYear = await ctx.db.get(fiscalYearId);
  if (!fiscalYear || fiscalYear.businessId !== businessId) {
    throw new ConvexError("دوره مالی انتخاب‌شده در این کسب‌وکار یافت نشد.");
  }
  return fiscalYear;
}

export function assertDocumentDateInFiscalYear(
  fiscalYear: Doc<"fiscalYears">,
  documentDate: number,
  options: { allowClosed?: boolean } = {},
) {
  if (!Number.isFinite(documentDate) || !Number.isInteger(documentDate)) {
    throw new ConvexError("تاریخ سند معتبر نیست.");
  }
  if (
    documentDate < fiscalYear.startAt ||
    documentDate > fiscalYear.endAt
  ) {
    throw new ConvexError(
      "تاریخ سند باید داخل دوره مالی انتخاب‌شده باشد.",
    );
  }
  if (fiscalYear.status === "closed" && !options.allowClosed) {
    throw new ConvexError(
      "دوره مالی بسته است و ثبت یا تغییر سند در آن مجاز نیست.",
    );
  }
}

export async function nextDocumentNumber(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  fiscalYear: Doc<"fiscalYears">,
) {
  const prefix = sanitizeNumberPrefix(fiscalYear.documentNumberPrefix);
  const padding = fiscalYear.documentNumberPadding ?? 4;
  const fiscalYearLabel = currentJalaliYear(fiscalYear.startAt);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sequence = await nextCounter(
      ctx,
      businessId,
      `accounting-doc:${fiscalYear._id}`,
    );
    const number = formatDocumentNumber(
      prefix,
      fiscalYearLabel,
      sequence,
      padding,
    );
    const duplicate = await ctx.db
      .query("accountingDocuments")
      .withIndex("by_business_number", (q) =>
        q.eq("businessId", businessId).eq("number", number),
      )
      .unique();
    if (!duplicate) return { number, sequence };
  }

  throw new ConvexError(
    "شماره‌گذاری سند با تداخل هم‌زمانی مواجه شد؛ لطفاً دوباره تلاش کنید.",
  );
}

export async function validateDocumentLines(
  ctx: Ctx,
  businessId: Id<"businesses">,
  lines: DocumentLineInput[],
  options: { requireBalanced: boolean; fallbackDescription: string },
) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ConvexError("سند باید حداقل یک ردیف داشته باشد.");
  }
  if (lines.length > MAX_DOCUMENT_LINES) {
    throw new ConvexError(
      `حداکثر ${MAX_DOCUMENT_LINES} ردیف در هر سند مجاز است.`,
    );
  }

  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await Promise.all(
    accountIds.map((accountId) => ctx.db.get(accountId)),
  );
  const accountMap = new Map<string, Doc<"accounts">>();
  for (const account of accounts) {
    if (account) accountMap.set(account._id as string, account);
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const normalized: {
    accountId: Id<"accounts">;
    description: string;
    debit: number;
    credit: number;
  }[] = [];

  for (const [index, line] of lines.entries()) {
    const rowLabel = `ردیف ${index + 1}`;
    const account = accountMap.get(line.accountId);
    if (!account || account.businessId !== businessId) {
      throw new ConvexError(
        `${rowLabel}: حساب انتخاب‌شده در این کسب‌وکار یافت نشد.`,
      );
    }
    if (!account.active || account.archivedAt) {
      throw new ConvexError(
        `${rowLabel}: حساب «${account.name}» غیرفعال است و قابل استفاده نیست.`,
      );
    }
    if (account.level !== "detail" || !account.postable) {
      throw new ConvexError(
        `${rowLabel}: حساب «${account.name}» گروه/کل/معین است و اجازه ثبت مستقیم ندارد.`,
      );
    }

    const debit = line.debit;
    const credit = line.credit;
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      throw new ConvexError(`${rowLabel}: مبلغ بدهکار یا بستانکار معتبر نیست.`);
    }
    if (!Number.isInteger(debit) || !Number.isInteger(credit)) {
      throw new ConvexError(`${rowLabel}: مبلغ باید عدد صحیح باشد.`);
    }
    if (debit < 0 || credit < 0) {
      throw new ConvexError(`${rowLabel}: مبلغ منفی مجاز نیست.`);
    }
    if (debit > MAX_AMOUNT || credit > MAX_AMOUNT) {
      throw new ConvexError(`${rowLabel}: مبلغ بیش از حد مجاز است.`);
    }
    if (debit > 0 && credit > 0) {
      throw new ConvexError(
        `${rowLabel}: یک ردیف نمی‌تواند هم‌زمان بدهکار و بستانکار باشد.`,
      );
    }
    if (debit === 0 && credit === 0) {
      throw new ConvexError(`${rowLabel}: مبلغ باید بزرگ‌تر از صفر باشد.`);
    }

    totalDebit += debit;
    totalCredit += credit;
    if (
      !Number.isSafeInteger(totalDebit) ||
      !Number.isSafeInteger(totalCredit)
    ) {
      throw new ConvexError("جمع سند از محدوده مجاز بیشتر است.");
    }

    normalized.push({
      accountId: account._id,
      description:
        line.description.trim().slice(0, 300) || options.fallbackDescription,
      debit,
      credit,
    });
  }

  if (options.requireBalanced) {
    if (normalized.length < 2) {
      throw new ConvexError("سند حسابداری باید حداقل دو ردیف داشته باشد.");
    }
    if (totalDebit !== totalCredit) {
      throw new ConvexError(
        `سند متوازن نیست؛ مجموع بدهکار ${totalDebit.toLocaleString(
          "fa-IR",
        )} و بستانکار ${totalCredit.toLocaleString("fa-IR")} است.`,
      );
    }
    if (totalDebit === 0) {
      throw new ConvexError("سند بدون مبلغ معتبر نیست.");
    }
  }

  return { lines: normalized, totalDebit, totalCredit };
}

export function linesToMath(
  lines: { accountId: Id<"accounts">; debit: number; credit: number }[],
): AccountingLineLike[] {
  return lines.map((line) => ({
    accountId: line.accountId as string,
    debit: line.debit,
    credit: line.credit,
  }));
}

export async function writeAccountingAudit(
  ctx: MutationCtx,
  entry: {
    businessId: Id<"businesses">;
    documentId: Id<"accountingDocuments">;
    actorId: Id<"users">;
    action: string;
    summary: string;
    detail?: string;
  },
) {
  await ctx.db.insert("accountingAuditLogs", {
    ...entry,
    createdAt: Date.now(),
  });
}
