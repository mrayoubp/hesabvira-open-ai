import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import {
  accountBalance,
  descendantAccountIds,
  type AccountingLineLike,
  type AccountLike,
} from "./accountingMath";

type Ctx = QueryCtx | MutationCtx;
const MAX_DOCUMENTS = 4000;

export interface FinalizedLine {
  document: Doc<"accountingDocuments">;
  line: Doc<"accountingDocumentLines">;
}

export function toAccountLike(account: Doc<"accounts">): AccountLike {
  return {
    _id: account._id as string,
    code: account.code,
    name: account.name,
    level: account.level,
    type: account.type,
    nature: account.nature,
    parentId: account.parentId ? (account.parentId as string) : undefined,
    active: account.active,
  };
}

export function toLineLike(
  line: Pick<Doc<"accountingDocumentLines">, "accountId" | "debit" | "credit">,
): AccountingLineLike {
  return {
    accountId: line.accountId as string,
    debit: line.debit,
    credit: line.credit,
  };
}

/**
 * Finalized ledger lines are posted documents plus the original documents they
 * reverse. Both sides are required so a reversal nets to zero instead of
 * silently removing history.
 */
export async function loadFinalizedLines(
  ctx: Ctx,
  businessId: Id<"businesses">,
  fiscalYearId: Id<"fiscalYears">,
  from?: number,
  to?: number,
): Promise<FinalizedLine[]> {
  const documents = await ctx.db
    .query("accountingDocuments")
    .withIndex("by_business_fiscal_date", (q) =>
      q
        .eq("businessId", businessId)
        .eq("fiscalYearId", fiscalYearId)
        .gte("documentDate", from ?? 0)
        .lte("documentDate", to ?? Number.MAX_SAFE_INTEGER),
    )
    .order("asc")
    .take(MAX_DOCUMENTS);

  const finalized = documents.filter(
    (document) =>
      document.status === "posted" || document.status === "reversed",
  );
  const linesByDocument = await Promise.all(
    finalized.map((document) =>
      ctx.db
        .query("accountingDocumentLines")
        .withIndex("by_document", (q) => q.eq("documentId", document._id))
        .collect(),
    ),
  );

  return finalized.flatMap((document, index) =>
    linesByDocument[index]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({ document, line })),
  );
}

export async function loadBusinessAccounts(
  ctx: Ctx,
  businessId: Id<"businesses">,
) {
  return await ctx.db
    .query("accounts")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .take(2000);
}

export function summaryForAccount(
  accounts: Doc<"accounts">[],
  lines: FinalizedLine[],
  accountId: Id<"accounts">,
  from: number,
  to: number,
) {
  const accountLikes = accounts.map(toAccountLike);
  const ids = descendantAccountIds(accountLikes, accountId as string);
  const before = lines
    .filter(({ document }) => document.documentDate < from)
    .map(({ line }) => toLineLike(line));
  const period = lines
    .filter(
      ({ document }) =>
        document.documentDate >= from && document.documentDate <= to,
    )
    .map(({ line }) => toLineLike(line));

  const opening = accountBalance(before, ids);
  const movement = accountBalance(period, ids);

  return {
    openingNet: opening.net,
    debit: movement.debit,
    credit: movement.credit,
    closingNet: opening.net + movement.net,
  };
}

export function chronologicalLines(
  lines: FinalizedLine[],
  accounts: Doc<"accounts">[],
  accountId: Id<"accounts">,
  from: number,
  to: number,
) {
  const accountLikes = accounts.map(toAccountLike);
  const ids = descendantAccountIds(accountLikes, accountId as string);
  const accountMap = new Map(
    accounts.map((account) => [account._id as string, account]),
  );

  const sorted = [...lines]
    .filter(
      ({ document, line }) =>
        ids.has(line.accountId as string) &&
        document.documentDate >= from &&
        document.documentDate <= to,
    )
    .sort(
      (a, b) =>
        a.document.documentDate - b.document.documentDate ||
        a.document.number.localeCompare(b.document.number) ||
        a.line.position - b.line.position,
    );

  const openingLines = lines
    .filter(
      ({ document, line }) =>
        ids.has(line.accountId as string) && document.documentDate < from,
    )
    .map(({ line }) => toLineLike(line));
  let running = accountBalance(openingLines, ids).net;

  return sorted.map(({ document, line }) => {
    running += line.debit - line.credit;
    const account = accountMap.get(line.accountId as string);
    return {
      lineId: line._id as string,
      documentId: document._id as string,
      documentNumber: document.number,
      documentDate: document.documentDate,
      documentDescription: document.description,
      documentStatus: document.status,
      accountId: line.accountId as string,
      accountCode: account?.code ?? "—",
      accountName: account?.name ?? "—",
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      runningNet: running,
    };
  });
}
