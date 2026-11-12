import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMembership, writeAudit } from "./lib/tenant";
import {
  assertDocumentDateInFiscalYear,
  getFiscalYear,
  nextDocumentNumber,
  writeAccountingAudit,
} from "./lib/accounting";
import {
  buildClosingLines,
  buildOpeningLines,
  documentTotals,
} from "./lib/accountingMath";
import { getSystemAccount } from "./lib/accounts";
import {
  loadBusinessAccounts,
  loadFinalizedLines,
} from "./lib/ledger";
import { jalaliDateLabel } from "./lib/calendar";

async function fiscalDocuments(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  fiscalYearId: Id<"fiscalYears">,
) {
  return await ctx.db
    .query("accountingDocuments")
    .withIndex("by_business_fiscal", (q) =>
      q.eq("businessId", businessId).eq("fiscalYearId", fiscalYearId),
    )
    .take(4001);
}

export const preview = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    const documents = await fiscalDocuments(
      ctx,
      args.businessId,
      fiscalYear._id,
    );
    const finalizedLines = await loadFinalizedLines(
      ctx,
      args.businessId,
      fiscalYear._id,
    );
    const accounts = await loadBusinessAccounts(ctx, args.businessId);
    const retained = await ctx.db
      .query("accounts")
      .withIndex("by_business_system", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("systemKey", "retainedEarnings"),
      )
      .unique();

    const draftCount = documents.filter(
      (document) => document.status === "draft",
    ).length;
    const pendingCount = documents.filter(
      (document) => document.status === "pending",
    ).length;
    const closingDocument = documents.find(
      (document) => document.kind === "closing",
    );
    const openingDocument = documents.find(
      (document) => document.kind === "opening",
    );

    const lineGroups = new Map<string, typeof finalizedLines>();
    for (const entry of finalizedLines) {
      const key = entry.document._id as string;
      const list = lineGroups.get(key) ?? [];
      list.push(entry);
      lineGroups.set(key, list);
    }

    let unbalancedDocuments = 0;
    let emptyFinalizedDocuments = 0;
    for (const [documentId, entries] of lineGroups) {
      const totals = documentTotals(
        entries.map((entry) => ({
          accountId: entry.line.accountId as string,
          debit: entry.line.debit,
          credit: entry.line.credit,
        })),
      );
      const document = documents.find(
        (row) => (row._id as string) === documentId,
      );
      if (entries.length === 0) emptyFinalizedDocuments += 1;
      if (
        !totals.balanced ||
        !document ||
        document.totalDebit !== totals.debit ||
        document.totalCredit !== totals.credit
      ) {
        unbalancedDocuments += 1;
      }
    }

    const allLines = finalizedLines.map((entry) => ({
      accountId: entry.line.accountId as string,
      debit: entry.line.debit,
      credit: entry.line.credit,
    }));
    const totalDebit = allLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = allLines.reduce((sum, line) => sum + line.credit, 0);

    const profitAccountIds = new Set(
      accounts
        .filter(
          (account) =>
            account.type === "income" || account.type === "expense",
        )
        .map((account) => account._id as string),
    );
    const netProfitImpact = allLines
      .filter((line) => profitAccountIds.has(line.accountId))
      .reduce((sum, line) => sum + line.credit - line.debit, 0);

    const reasons: string[] = [];
    if (fiscalYear.status === "closed") {
      reasons.push("این دوره مالی قبلاً بسته شده است.");
    }
    if (documents.length > 4000) {
      reasons.push(
        "تعداد اسناد دوره از سقف پردازش خودکار (۴٬۰۰۰ سند) بیشتر است؛ بستن دوره به بازبینی دستی نیاز دارد.",
      );
    }
    if (draftCount > 0) {
      reasons.push(`${draftCount} سند پیش‌نویس باید تعیین تکلیف شود.`);
    }
    if (pendingCount > 0) {
      reasons.push(`${pendingCount} سند در انتظار تأیید باید قطعی یا برگشت شود.`);
    }
    if (unbalancedDocuments > 0) {
      reasons.push(`${unbalancedDocuments} سند قطعی نامتوازن یا ناسازگار وجود دارد.`);
    }
    if (emptyFinalizedDocuments > 0) {
      reasons.push(`${emptyFinalizedDocuments} سند قطعی بدون ردیف وجود دارد.`);
    }
    if (totalDebit !== totalCredit) {
      reasons.push("جمع بدهکار و بستانکار اسناد قطعی برابر نیست.");
    }
    if (!retained) {
      reasons.push("حساب سود و زیان انباشته در کدینگ حساب‌ها پیدا نشد.");
    }
    if (closingDocument) {
      reasons.push("سند اختتامیه برای این دوره قبلاً ثبت شده است.");
    }

    return {
      fiscalYear: {
        _id: fiscalYear._id as string,
        name: fiscalYear.name,
        startAt: fiscalYear.startAt,
        endAt: fiscalYear.endAt,
        status: fiscalYear.status,
        closedAt: fiscalYear.closedAt ?? null,
      },
      counts: {
        total: documents.length,
        draft: draftCount,
        pending: pendingCount,
        posted: documents.filter((document) => document.status === "posted")
          .length,
        reversed: documents.filter((document) => document.status === "reversed")
          .length,
      },
      finalized: {
        debit: totalDebit,
        credit: totalCredit,
        difference: totalDebit - totalCredit,
        unbalancedDocuments,
      },
      netProfitImpact,
      closingDocument: closingDocument
        ? {
            _id: closingDocument._id as string,
            number: closingDocument.number,
            status: closingDocument.status,
          }
        : null,
      openingDocument: openingDocument
        ? {
            _id: openingDocument._id as string,
            number: openingDocument.number,
          }
        : null,
      canClose:
        fiscalYear.status === "open" &&
        !closingDocument &&
        reasons.length === 0,
      reasons,
      closeDateLabel: jalaliDateLabel(fiscalYear.endAt),
    };
  },
});

export const close = mutation({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      manage: true,
    });
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    if (fiscalYear.status === "closed") {
      throw new ConvexError("این دوره مالی قبلاً بسته شده است.");
    }

    const documents = await fiscalDocuments(
      ctx,
      args.businessId,
      fiscalYear._id,
    );
    if (documents.length > 4000) {
      throw new ConvexError(
        "تعداد اسناد این دوره از سقف پردازش خودکار بیشتر است؛ بستن دوره انجام نشد.",
      );
    }
    if (documents.some((document) => document.kind === "closing")) {
      throw new ConvexError("سند اختتامیه این دوره قبلاً ثبت شده است.");
    }
    const draftCount = documents.filter(
      (document) => document.status === "draft",
    ).length;
    const pendingCount = documents.filter(
      (document) => document.status === "pending",
    ).length;
    if (draftCount > 0 || pendingCount > 0) {
      throw new ConvexError(
        `دوره دارای ${draftCount} پیش‌نویس و ${pendingCount} سند در انتظار تأیید است؛ ابتدا آن‌ها را تعیین تکلیف کنید.`,
      );
    }

    const finalizedLines = await loadFinalizedLines(
      ctx,
      args.businessId,
      fiscalYear._id,
    );
    const groups = new Map<string, typeof finalizedLines>();
    for (const entry of finalizedLines) {
      const key = entry.document._id as string;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    for (const [documentId, entries] of groups) {
      const totals = documentTotals(
        entries.map((entry) => ({
          accountId: entry.line.accountId as string,
          debit: entry.line.debit,
          credit: entry.line.credit,
        })),
      );
      const document = documents.find(
        (row) => (row._id as string) === documentId,
      );
      if (
        !document ||
        entries.length === 0 ||
        !totals.balanced ||
        document.totalDebit !== totals.debit ||
        document.totalCredit !== totals.credit
      ) {
        throw new ConvexError(
          "دوره دارای سند قطعی نامتوازن یا ناسازگار است و قابل بستن نیست.",
        );
      }
    }
    const allLines = finalizedLines.map((entry) => ({
      accountId: entry.line.accountId as string,
      debit: entry.line.debit,
      credit: entry.line.credit,
    }));
    const totals = documentTotals(allLines);
    if (totals.debit !== totals.credit) {
      throw new ConvexError("دفتر کل متوازن نیست و بستن دوره مجاز نیست.");
    }

    const retained = await getSystemAccount(
      ctx,
      args.businessId,
      "retainedEarnings",
    );
    if (!retained || !retained.active) {
      throw new ConvexError(
        "حساب «سود و زیان انباشته» فعال نیست؛ ابتدا کدینگ حساب‌ها را اصلاح کنید.",
      );
    }
    const accounts = await loadBusinessAccounts(ctx, args.businessId);
    const generated = buildClosingLines(
      accounts.map((account) => ({
        _id: account._id as string,
        code: account.code,
        name: account.name,
        level: account.level,
        type: account.type,
        nature: account.nature,
        parentId: account.parentId
          ? (account.parentId as string)
          : undefined,
        active: account.active,
      })),
      allLines,
      retained._id as string,
      `بستن حساب‌های ${fiscalYear.name}`,
    );

    let closingDocumentId: Id<"accountingDocuments"> | null = null;
    let closingNumber: string | null = null;
    if (generated.length > 0) {
      const closingTotals = documentTotals(generated);
      if (!closingTotals.balanced) {
        throw new ConvexError("سند اختتامیه محاسبه‌شده متوازن نیست.");
      }
      assertDocumentDateInFiscalYear(fiscalYear, fiscalYear.endAt);
      const numbered = await nextDocumentNumber(
        ctx,
        args.businessId,
        fiscalYear,
      );
      closingNumber = numbered.number;
      const now = Date.now();
      closingDocumentId = await ctx.db.insert("accountingDocuments", {
        businessId: args.businessId,
        fiscalYearId: fiscalYear._id,
        branchId:
          documents[0]?.branchId ??
          (
            await ctx.db
              .query("branches")
              .withIndex("by_business", (q) =>
                q.eq("businessId", args.businessId),
              )
              .first()
          )?._id ??
          (() => {
            throw new ConvexError("شعبه‌ای برای ثبت سند اختتامیه وجود ندارد.");
          })(),
        number: numbered.number,
        sequence: numbered.sequence,
        documentDate: fiscalYear.endAt,
        description: `سند اختتامیه ${fiscalYear.name} — انتقال سود/زیان به سود و زیان انباشته`,
        status: "posted",
        kind: "closing",
        totalDebit: closingTotals.debit,
        totalCredit: closingTotals.credit,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
        postedAt: now,
      });

      for (const [position, line] of generated.entries()) {
        await ctx.db.insert("accountingDocumentLines", {
          businessId: args.businessId,
          documentId: closingDocumentId,
          accountId: line.accountId as Id<"accounts">,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          position,
        });
      }

      await writeAccountingAudit(ctx, {
        businessId: args.businessId,
        documentId: closingDocumentId,
        actorId: user._id,
        action: "fiscal.close",
        summary: `ثبت سند اختتامیه ${numbered.number} و بستن ${fiscalYear.name}`,
        detail: JSON.stringify({
          debit: closingTotals.debit,
          credit: closingTotals.credit,
          lines: generated.length,
        }),
      });
    }

    await ctx.db.patch(fiscalYear._id, {
      status: "closed",
      closedAt: Date.now(),
      closedBy: user._id,
      closingDocumentId: closingDocumentId ?? undefined,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "fiscal.close",
      entity: "fiscalYears",
      entityId: fiscalYear._id,
      summary: `بستن ${fiscalYear.name}${
        closingNumber ? ` با سند ${closingNumber}` : ""
      }`,
    });

    return {
      fiscalYearId: fiscalYear._id,
      closingDocumentId,
      closingNumber,
    };
  },
});

export const createOpening = mutation({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const target = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    if (target.status === "closed") {
      throw new ConvexError("دوره مالی بسته است.");
    }

    const targetDocuments = await fiscalDocuments(
      ctx,
      args.businessId,
      target._id,
    );
    const existingOpening = targetDocuments.find(
      (document) => document.kind === "opening",
    );
    if (existingOpening || target.openingDocumentId) {
      throw new ConvexError("سند افتتاحیه این دوره قبلاً ثبت شده است.");
    }
    if (
      targetDocuments.some(
        (document) => document.status === "posted" || document.status === "reversed",
      )
    ) {
      throw new ConvexError(
        "پیش از ثبت سند افتتاحیه، هیچ سند قطعی دیگری نباید در دوره جدید وجود داشته باشد.",
      );
    }

    const fiscalYears = await ctx.db
      .query("fiscalYears")
      .withIndex("by_business", (q) =>
        q.eq("businessId", args.businessId),
      )
      .collect();
    const previous = fiscalYears
      .filter(
        (year) =>
          year._id !== target._id &&
          year.status === "closed" &&
          year.endAt < target.startAt,
      )
      .sort((a, b) => b.endAt - a.endAt)[0];
    if (!previous) {
      throw new ConvexError(
        "برای ثبت افتتاحیه، یک دوره مالی قبلیِ بسته‌شده لازم است.",
      );
    }

    const previousLines = await loadFinalizedLines(
      ctx,
      args.businessId,
      previous._id,
    );
    if (previousLines.length === 0) {
      throw new ConvexError("دوره قبلی سند قطعی قابل انتقال ندارد.");
    }
    const accounts = await loadBusinessAccounts(ctx, args.businessId);
    const generated = buildOpeningLines(
      accounts.map((account) => ({
        _id: account._id as string,
        code: account.code,
        name: account.name,
        level: account.level,
        type: account.type,
        nature: account.nature,
        parentId: account.parentId
          ? (account.parentId as string)
          : undefined,
        active: account.active,
      })),
      previousLines.map((entry) => ({
        accountId: entry.line.accountId as string,
        debit: entry.line.debit,
        credit: entry.line.credit,
      })),
      `افتتاحیه ${target.name}`,
    );
    if (generated.lines.length === 0) {
      throw new ConvexError("مانده قابل انتقالی برای افتتاحیه وجود ندارد.");
    }
    if (generated.difference !== 0 || !generated.balanced) {
      throw new ConvexError(
        "مانده‌های دوره قبل متوازن نیست؛ افتتاحیه ثبت نشد.",
      );
    }

    const inactiveAccounts = generated.lines.filter((line) => {
      const account = accounts.find(
        (row) => (row._id as string) === line.accountId,
      );
      return !account || !account.active;
    });
    if (inactiveAccounts.length > 0) {
      throw new ConvexError(
        "برای انتقال مانده، همه حساب‌های دارای مانده باید فعال باشند.",
      );
    }

    assertDocumentDateInFiscalYear(target, target.startAt);
    const { number, sequence } = await nextDocumentNumber(
      ctx,
      args.businessId,
      target,
    );
    const branch =
      (await ctx.db
        .query("branches")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .first()) ?? null;
    if (!branch) throw new ConvexError("شعبه‌ای برای سند افتتاحیه وجود ندارد.");

    const now = Date.now();
    const openingId = await ctx.db.insert("accountingDocuments", {
      businessId: args.businessId,
      fiscalYearId: target._id,
      branchId: branch._id,
      number,
      sequence,
      documentDate: target.startAt,
      description: `سند افتتاحیه ${target.name} — انتقال مانده‌های ${previous.name}`,
      status: "posted",
      kind: "opening",
      totalDebit: generated.debit,
      totalCredit: generated.credit,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
      postedAt: now,
    });
    for (const [position, line] of generated.lines.entries()) {
      await ctx.db.insert("accountingDocumentLines", {
        businessId: args.businessId,
        documentId: openingId,
        accountId: line.accountId as Id<"accounts">,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        position,
      });
    }
    await ctx.db.patch(target._id, { openingDocumentId: openingId });
    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: openingId,
      actorId: user._id,
      action: "fiscal.opening",
      summary: `ثبت سند افتتاحیه ${number} از دوره ${previous.name}`,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "fiscal.opening",
      entity: "fiscalYears",
      entityId: target._id,
      summary: `سند افتتاحیه ${number} از ${previous.name}`,
    });

    return { openingDocumentId: openingId, number };
  },
});

