import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { requireMembership } from "./lib/tenant";
import { getFiscalYear } from "./lib/accounting";
import {
  descendantAccountIds,
  trialBalance,
} from "./lib/accountingMath";
import {
  chronologicalLines,
  loadBusinessAccounts,
  loadFinalizedLines,
  summaryForAccount,
  toAccountLike,
  type FinalizedLine,
} from "./lib/ledger";
import {
  accountLevelValidator,
  type AccountLevel,
  type AccountType,
} from "./schema";

const sortValidator = v.union(
  v.literal("date_asc"),
  v.literal("date_desc"),
);

function assertRange(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new ConvexError("بازه تاریخ گزارش معتبر نیست.");
  }
  if (from > to) {
    throw new ConvexError("تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.");
  }
  if (to - from > 3 * 365 * 24 * 60 * 60 * 1000) {
    throw new ConvexError("بازه گزارش بیش از حد بزرگ است.");
  }
}

function scopeLines(
  lines: FinalizedLine[],
  branchId?: FinalizedLine["document"]["branchId"],
) {
  if (!branchId) return lines;
  return lines.filter((entry) => entry.document.branchId === branchId);
}

export const journal = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    branchId: v.optional(v.id("branches")),
    accountId: v.optional(v.id("accounts")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    sort: v.optional(sortValidator),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    exportAll: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    const from = args.from ?? fiscalYear.startAt;
    const to = args.to ?? fiscalYear.endAt;
    assertRange(from, to);

    const [accounts, allLines] = await Promise.all([
      loadBusinessAccounts(ctx, args.businessId),
      loadFinalizedLines(
        ctx,
        args.businessId,
        fiscalYear._id,
        from,
        to,
      ),
    ]);
    const accountMap = new Map(
      accounts.map((account) => [account._id as string, account]),
    );
    const scoped = scopeLines(allLines, args.branchId);
    const needle = args.search?.trim().toLowerCase();
    let accountIds: Set<string> | null = null;
    if (args.accountId) {
      const selected = accounts.find(
        (account) => account._id === args.accountId,
      );
      if (!selected) {
        throw new ConvexError("حساب انتخاب‌شده در این کسب‌وکار یافت نشد.");
      }
      accountIds = descendantAccountIds(
        accounts.map(toAccountLike),
        args.accountId as string,
      );
    }

    const filtered = scoped.filter(({ document, line }) => {
      if (accountIds && !accountIds.has(line.accountId as string)) return false;
      if (!needle) return true;
      const account = accountMap.get(line.accountId as string);
      return [
        document.number,
        document.description,
        line.description,
        account?.code,
        account?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });

    const sort = args.sort ?? "date_asc";
    filtered.sort((a, b) => {
      const direction = sort === "date_desc" ? -1 : 1;
      return (
        direction *
        (a.document.documentDate - b.document.documentDate ||
          a.document.number.localeCompare(b.document.number) ||
          a.line.position - b.line.position)
      );
    });

    const pageSize = args.exportAll
      ? Math.max(1, filtered.length)
      : Math.min(200, Math.max(10, Math.round(args.pageSize ?? 50)));
    const pageCount = args.exportAll
      ? 1
      : Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = args.exportAll
      ? 1
      : Math.min(pageCount, Math.max(1, Math.round(args.page ?? 1)));
    const pageRows = args.exportAll
      ? filtered.slice(0, 5000)
      : filtered.slice((page - 1) * pageSize, page * pageSize);

    const totalDebit = filtered.reduce((sum, entry) => sum + entry.line.debit, 0);
    const totalCredit = filtered.reduce(
      (sum, entry) => sum + entry.line.credit,
      0,
    );

    return {
      fiscalYear: {
        _id: fiscalYear._id as string,
        name: fiscalYear.name,
      },
      from,
      to,
      rows: pageRows.map(({ document, line }) => {
        const account = accountMap.get(line.accountId as string);
        return {
          _id: `${document._id}:${line._id}`,
          documentId: document._id as string,
          documentNumber: document.number,
          documentDate: document.documentDate,
          documentDescription: document.description,
          documentStatus: document.status,
          documentKind: document.kind,
          accountId: line.accountId as string,
          accountCode: account?.code ?? "—",
          accountName: account?.name ?? "—",
          accountType: account?.type ?? null,
          lineDescription: line.description,
          debit: line.debit,
          credit: line.credit,
        };
      }),
      total: filtered.length,
      page,
      pageCount,
      pageSize,
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit,
      documentCount: new Set(
        filtered.map((entry) => entry.document._id as string),
      ).size,
    };
  },
});

export const ledger = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    accountId: v.id("accounts"),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    const from = args.from ?? fiscalYear.startAt;
    const to = args.to ?? fiscalYear.endAt;
    assertRange(from, to);

    const accounts = await loadBusinessAccounts(ctx, args.businessId);
    const account = accounts.find((row) => row._id === args.accountId);
    if (!account) {
      throw new ConvexError("حساب انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }
    const allLines = await loadFinalizedLines(
      ctx,
      args.businessId,
      fiscalYear._id,
      undefined,
      to,
    );
    const scoped = scopeLines(allLines, args.branchId);
    const summary = summaryForAccount(
      accounts,
      scoped,
      account._id,
      from,
      to,
    );
    const rows = chronologicalLines(
      scoped,
      accounts,
      account._id,
      from,
      to,
    );
    const limitedRows = rows.slice(0, 5000);

    return {
      fiscalYear: {
        _id: fiscalYear._id as string,
        name: fiscalYear.name,
        startAt: fiscalYear.startAt,
        endAt: fiscalYear.endAt,
      },
      account: {
        _id: account._id as string,
        code: account.code,
        name: account.name,
        level: account.level,
        type: account.type,
        nature: account.nature,
      },
      from,
      to,
      ...summary,
      rows: limitedRows,
      truncated: rows.length > limitedRows.length,
    };
  },
});

export const subsidiary = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    accountId: v.id("accounts"),
    detailAccountId: v.optional(v.id("accounts")),
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    const from = args.from ?? fiscalYear.startAt;
    const to = args.to ?? fiscalYear.endAt;
    assertRange(from, to);

    const accounts = await loadBusinessAccounts(ctx, args.businessId);
    const account = accounts.find((row) => row._id === args.accountId);
    if (!account) {
      throw new ConvexError("حساب معین انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }
    if (account.level !== "subsidiary") {
      throw new ConvexError("برای دفتر معین، یک حساب سطح معین انتخاب کنید.");
    }
    const descendantIds = descendantAccountIds(
      accounts.map(toAccountLike),
      account._id as string,
    );
    const detailAccounts = accounts.filter(
      (row) =>
        row.level === "detail" &&
        descendantIds.has(row._id as string),
    );

    let selectedAccount = account;
    if (args.detailAccountId) {
      const selected = detailAccounts.find(
        (row) => row._id === args.detailAccountId,
      );
      if (!selected) {
        throw new ConvexError(
          "حساب تفصیلی انتخاب‌شده زیرمجموعه این حساب معین نیست.",
        );
      }
      selectedAccount = selected;
    }

    const allLines = await loadFinalizedLines(
      ctx,
      args.businessId,
      fiscalYear._id,
      undefined,
      to,
    );
    const scoped = scopeLines(allLines, args.branchId);
    const summary = summaryForAccount(
      accounts,
      scoped,
      selectedAccount._id,
      from,
      to,
    );
    const rows = chronologicalLines(
      scoped,
      accounts,
      selectedAccount._id,
      from,
      to,
    );
    const limitedRows = rows.slice(0, 5000);

    const details = detailAccounts.map((detail) => {
      const detailSummary = summaryForAccount(
        accounts,
        scoped,
        detail._id,
        from,
        to,
      );
      return {
        _id: detail._id as string,
        code: detail.code,
        name: detail.name,
        detailKind: detail.detailKind,
        linkedEntityName: detail.linkedEntityName ?? null,
        active: detail.active,
        ...detailSummary,
      };
    });

    return {
      fiscalYear: {
        _id: fiscalYear._id as string,
        name: fiscalYear.name,
        startAt: fiscalYear.startAt,
        endAt: fiscalYear.endAt,
      },
      account: {
        _id: account._id as string,
        code: account.code,
        name: account.name,
        level: account.level,
      },
      selected: {
        _id: selectedAccount._id as string,
        code: selectedAccount.code,
        name: selectedAccount.name,
        level: selectedAccount.level,
      },
      from,
      to,
      ...summary,
      rows: limitedRows,
      truncated: rows.length > limitedRows.length,
      details,
    };
  },
});

export const trialBalanceReport = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    level: accountLevelValidator,
    branchId: v.optional(v.id("branches")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    const from = args.from ?? fiscalYear.startAt;
    const to = args.to ?? fiscalYear.endAt;
    assertRange(from, to);

    const [accounts, allLines] = await Promise.all([
      loadBusinessAccounts(ctx, args.businessId),
      loadFinalizedLines(
        ctx,
        args.businessId,
        fiscalYear._id,
        undefined,
        to,
      ),
    ]);
    const scoped = scopeLines(allLines, args.branchId);
    const accountLikes = accounts.map(toAccountLike);
    const openingLines = scoped
      .filter((entry) => entry.document.documentDate < from)
      .map((entry) => ({
        accountId: entry.line.accountId as string,
        debit: entry.line.debit,
        credit: entry.line.credit,
      }));
    const periodLines = scoped
      .filter(
        (entry) =>
          entry.document.documentDate >= from &&
          entry.document.documentDate <= to,
      )
      .map((entry) => ({
        accountId: entry.line.accountId as string,
        debit: entry.line.debit,
        credit: entry.line.credit,
      }));

    const report = trialBalance(
      accountLikes,
      openingLines,
      periodLines,
      args.level as AccountLevel,
    );

    return {
      fiscalYear: {
        _id: fiscalYear._id as string,
        name: fiscalYear.name,
        startAt: fiscalYear.startAt,
        endAt: fiscalYear.endAt,
      },
      from,
      to,
      level: args.level,
      ...report,
      typeLabels: {
        asset: "دارایی",
        liability: "بدهی",
        equity: "سرمایه",
        income: "درآمد",
        expense: "هزینه",
      } satisfies Record<AccountType, string>,
    };
  },
});
