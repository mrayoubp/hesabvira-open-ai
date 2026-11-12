import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireMembership, writeAudit } from "./lib/tenant";
import {
  assertDocumentDateInFiscalYear,
  getFiscalYear,
  nextDocumentNumber,
  validateDocumentLines,
  writeAccountingAudit,
} from "./lib/accounting";
import { accountingDocumentStatusValidator } from "./schema";
import { optionalString, requireString } from "./lib/validation";
import { currentJalaliYear } from "./lib/calendar";

const lineArg = v.object({
  accountId: v.id("accounts"),
  description: v.string(),
  debit: v.number(),
  credit: v.number(),
});

const statusValidator = accountingDocumentStatusValidator;

async function assertBranch(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  branchId: Id<"branches">,
) {
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.businessId !== businessId || branch.archivedAt) {
    throw new ConvexError("شعبه انتخاب‌شده در این کسب‌وکار یافت نشد.");
  }
  return branch;
}

async function loadDocument(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  documentId: Id<"accountingDocuments">,
) {
  const document = await ctx.db.get(documentId);
  if (!document || document.businessId !== businessId) {
    throw new ConvexError("سند حسابداری در این کسب‌وکار یافت نشد.");
  }
  return document;
}

async function loadDocumentLines(
  ctx: Parameters<typeof requireMembership>[0],
  documentId: Id<"accountingDocuments">,
) {
  return await ctx.db
    .query("accountingDocumentLines")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect();
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    branchId: v.optional(v.id("branches")),
    status: v.optional(statusValidator),
    search: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);

    let documents: Doc<"accountingDocuments">[];
    if (args.fiscalYearId) {
      documents = await ctx.db
        .query("accountingDocuments")
        .withIndex("by_business_fiscal_date", (q) =>
          q
            .eq("businessId", args.businessId)
            .eq("fiscalYearId", args.fiscalYearId as Id<"fiscalYears">)
            .gte("documentDate", args.from ?? 0)
            .lte("documentDate", args.to ?? Number.MAX_SAFE_INTEGER),
        )
        .order("desc")
        .take(2000);
    } else {
      documents = await ctx.db
        .query("accountingDocuments")
        .withIndex("by_business_date", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("documentDate", args.from ?? 0)
            .lte("documentDate", args.to ?? Number.MAX_SAFE_INTEGER),
        )
        .order("desc")
        .take(2000);
    }

    const needle = args.search?.trim().toLowerCase();
    const filtered = documents.filter((document) => {
      if (args.branchId && document.branchId !== args.branchId) return false;
      if (args.status && document.status !== args.status) return false;
      if (!needle) return true;
      return (
        document.number.toLowerCase().includes(needle) ||
        document.description.toLowerCase().includes(needle)
      );
    });

    const pageSize = Math.min(100, Math.max(5, Math.round(args.pageSize ?? 25)));
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.round(args.page ?? 1)));
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    const userIds = [...new Set(items.map((document) => document.createdBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userNames = new Map(
      users
        .filter((user): user is Doc<"users"> => Boolean(user))
        .map((user) => [user._id as string, user.name ?? user.email ?? "کاربر"]),
    );
    const lineCounts = new Map<string, number>();
    for (const document of items) {
      const lines = await ctx.db
        .query("accountingDocumentLines")
        .withIndex("by_document", (q) => q.eq("documentId", document._id))
        .collect();
      lineCounts.set(document._id as string, lines.length);
    }

    return {
      items: items.map((document) => ({
        _id: document._id as string,
        number: document.number,
        documentDate: document.documentDate,
        description: document.description,
        status: document.status,
        kind: document.kind,
        totalDebit: document.totalDebit,
        totalCredit: document.totalCredit,
        difference: document.totalDebit - document.totalCredit,
        createdBy: document.createdBy as string,
        createdByName: userNames.get(document.createdBy as string) ?? "کاربر",
        createdAt: document.createdAt,
        lineCount: lineCounts.get(document._id as string) ?? 0,
      })),
      total: filtered.length,
      page,
      pageCount,
      pageSize,
      totals: {
        debit: filtered.reduce((sum, document) => sum + document.totalDebit, 0),
        credit: filtered.reduce((sum, document) => sum + document.totalCredit, 0),
      },
    };
  },
});

export const get = query({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const document = await loadDocument(ctx, args.businessId, args.documentId);

    const [lines, creator, fiscalYear, branch, history] = await Promise.all([
      loadDocumentLines(ctx, document._id),
      ctx.db.get(document.createdBy),
      ctx.db.get(document.fiscalYearId),
      ctx.db.get(document.branchId),
      ctx.db
        .query("accountingAuditLogs")
        .withIndex("by_document", (q) => q.eq("documentId", document._id))
        .order("asc")
        .take(200),
    ]);

    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await Promise.all(
      accountIds.map((accountId) => ctx.db.get(accountId)),
    );
    const accountMap = new Map(
      accounts
        .filter((account): account is Doc<"accounts"> => Boolean(account))
        .map((account) => [account._id as string, account]),
    );
    const actorIds = [...new Set(history.map((row) => row.actorId))];
    const actors = await Promise.all(
      actorIds.map((actorId) => ctx.db.get(actorId)),
    );
    const actorMap = new Map(
      actors
        .filter((actor): actor is Doc<"users"> => Boolean(actor))
        .map((actor) => [actor._id as string, actor.name ?? actor.email ?? "کاربر"]),
    );

    const [original, reversal] = await Promise.all([
      document.reversalOfId
        ? ctx.db.get(document.reversalOfId)
        : document.correctionOfId
          ? ctx.db.get(document.correctionOfId)
          : Promise.resolve(null),
      document.reversedByDocumentId
        ? ctx.db.get(document.reversedByDocumentId)
        : Promise.resolve(null),
    ]);

    return {
      _id: document._id as string,
      number: document.number,
      sequence: document.sequence,
      documentDate: document.documentDate,
      description: document.description,
      status: document.status,
      kind: document.kind,
      totalDebit: document.totalDebit,
      totalCredit: document.totalCredit,
      difference: document.totalDebit - document.totalCredit,
      createdBy: document.createdBy as string,
      createdByName: creator?.name ?? creator?.email ?? "کاربر",
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      submittedAt: document.submittedAt ?? null,
      postedAt: document.postedAt ?? null,
      reversedAt: document.reversedAt ?? null,
      fiscalYear: fiscalYear
        ? {
            _id: fiscalYear._id as string,
            name: fiscalYear.name,
            status: fiscalYear.status,
            startAt: fiscalYear.startAt,
            endAt: fiscalYear.endAt,
          }
        : null,
      branch: branch
        ? { _id: branch._id as string, name: branch.name, code: branch.code }
        : null,
      lines: lines
        .sort((a, b) => a.position - b.position)
        .map((line) => {
          const account = accountMap.get(line.accountId as string);
          return {
            _id: line._id as string,
            accountId: line.accountId as string,
            accountCode: account?.code ?? "—",
            accountName: account?.name ?? "حساب حذف‌شده",
            accountType: account?.type ?? null,
            detailKind: account?.detailKind ?? "none",
            linkedEntityName: account?.linkedEntityName ?? null,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
            position: line.position,
          };
        }),
      linked: {
        original: original
          ? {
              _id: original._id as string,
              number: original.number,
              status: original.status,
              kind: original.kind,
            }
          : null,
        reversal: reversal
          ? {
              _id: reversal._id as string,
              number: reversal.number,
              status: reversal.status,
            }
          : null,
      },
      history: history.map((row) => ({
        _id: row._id as string,
        action: row.action,
        summary: row.summary,
        detail: row.detail ?? null,
        actorName: actorMap.get(row.actorId as string) ?? "کاربر",
        createdAt: row.createdAt,
      })),
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    branchId: v.id("branches"),
    documentDate: v.number(),
    description: v.string(),
    status: v.union(v.literal("draft"), v.literal("pending")),
    lines: v.array(lineArg),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      args.fiscalYearId,
    );
    const branch = await assertBranch(ctx, args.businessId, args.branchId);
    assertDocumentDateInFiscalYear(fiscalYear, args.documentDate);
    const description = requireString(args.description, "شرح سند", {
      max: 500,
    }) as string;

    const validated = await validateDocumentLines(
      ctx,
      args.businessId,
      args.lines,
      {
        requireBalanced: args.status === "pending",
        fallbackDescription: description,
      },
    );

    const { number, sequence } = await nextDocumentNumber(
      ctx,
      args.businessId,
      fiscalYear,
    );
    const now = Date.now();
    const documentId = await ctx.db.insert("accountingDocuments", {
      businessId: args.businessId,
      fiscalYearId: fiscalYear._id,
      branchId: branch._id,
      number,
      sequence,
      documentDate: args.documentDate,
      description,
      status: args.status,
      kind: "normal",
      totalDebit: validated.totalDebit,
      totalCredit: validated.totalCredit,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
      submittedAt: args.status === "pending" ? now : undefined,
    });

    for (const [position, line] of validated.lines.entries()) {
      await ctx.db.insert("accountingDocumentLines", {
        businessId: args.businessId,
        documentId,
        accountId: line.accountId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        position,
      });
    }

    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId,
      actorId: user._id,
      action: args.status === "pending" ? "document.submit" : "document.create",
      summary: `${args.status === "pending" ? "ثبت" : "ایجاد پیش‌نویس"} سند ${number}`,
      detail: JSON.stringify({
        totalDebit: validated.totalDebit,
        totalCredit: validated.totalCredit,
        lines: validated.lines.length,
      }),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.status === "pending" ? "accounting.submit" : "accounting.draft",
      entity: "accountingDocuments",
      entityId: documentId,
      summary: `سند ${number} — ${description}`,
    });

    return { documentId, number };
  },
});

export const updateDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
    branchId: v.id("branches"),
    documentDate: v.number(),
    description: v.string(),
    lines: v.array(lineArg),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    if (document.status !== "draft") {
      throw new ConvexError(
        "فقط سند پیش‌نویس قابل ویرایش است؛ اسناد قطعی و در انتظار تأیید تغییر نمی‌کنند.",
      );
    }
    if (document.kind !== "normal") {
      throw new ConvexError("اسناد سیستمی افتتاحیه/اختتامیه قابل ویرایش نیستند.");
    }
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      document.fiscalYearId,
    );
    const branch = await assertBranch(ctx, args.businessId, args.branchId);
    assertDocumentDateInFiscalYear(fiscalYear, args.documentDate);
    const description = requireString(args.description, "شرح سند", {
      max: 500,
    }) as string;

    const validated = await validateDocumentLines(
      ctx,
      args.businessId,
      args.lines,
      { requireBalanced: false, fallbackDescription: description },
    );

    const existingLines = await loadDocumentLines(ctx, document._id);
    for (const line of existingLines) {
      await ctx.db.delete(line._id);
    }
    for (const [position, line] of validated.lines.entries()) {
      await ctx.db.insert("accountingDocumentLines", {
        businessId: args.businessId,
        documentId: document._id,
        accountId: line.accountId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        position,
      });
    }

    await ctx.db.patch(document._id, {
      branchId: branch._id,
      documentDate: args.documentDate,
      description,
      totalDebit: validated.totalDebit,
      totalCredit: validated.totalCredit,
      updatedAt: Date.now(),
    });

    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: document._id,
      actorId: user._id,
      action: "document.update",
      summary: `ویرایش پیش‌نویس سند ${document.number}`,
      detail: JSON.stringify({
        totalDebit: validated.totalDebit,
        totalCredit: validated.totalCredit,
        lines: validated.lines.length,
      }),
    });

    return { documentId: document._id };
  },
});

export const removeDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    if (document.status !== "draft") {
      throw new ConvexError("فقط سند پیش‌نویس قابل حذف است.");
    }
    if (document.kind !== "normal") {
      throw new ConvexError("سند سیستمی افتتاحیه/اختتامیه قابل حذف نیست.");
    }
    const lines = await loadDocumentLines(ctx, document._id);
    for (const line of lines) {
      await ctx.db.delete(line._id);
    }
    await ctx.db.delete(document._id);
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "accounting.draft.delete",
      entity: "accountingDocuments",
      entityId: document._id,
      summary: `حذف پیش‌نویس سند ${document.number}`,
    });
    return { documentId: document._id };
  },
});

export const submit = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    if (document.status !== "draft") {
      throw new ConvexError("فقط پیش‌نویس قابل ارسال برای تأیید است.");
    }
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      document.fiscalYearId,
    );
    assertDocumentDateInFiscalYear(fiscalYear, document.documentDate);
    const lines = await loadDocumentLines(ctx, document._id);
    const validated = await validateDocumentLines(
      ctx,
      args.businessId,
      lines,
      { requireBalanced: true, fallbackDescription: document.description },
    );

    const now = Date.now();
    await ctx.db.patch(document._id, {
      status: "pending",
      submittedAt: now,
      updatedAt: now,
      totalDebit: validated.totalDebit,
      totalCredit: validated.totalCredit,
    });
    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: document._id,
      actorId: user._id,
      action: "document.submit",
      summary: `ارسال سند ${document.number} برای تأیید`,
    });
    return { documentId: document._id, status: "pending" as const };
  },
});

export const returnToDraft = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    if (document.status !== "pending") {
      throw new ConvexError("فقط سند در انتظار تأیید قابل بازگشت است.");
    }
    await ctx.db.patch(document._id, {
      status: "draft",
      updatedAt: Date.now(),
    });
    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: document._id,
      actorId: user._id,
      action: "document.return",
      summary: `بازگشت سند ${document.number} به پیش‌نویس`,
    });
    return { documentId: document._id, status: "draft" as const };
  },
});

export const post = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    if (document.status !== "draft" && document.status !== "pending") {
      throw new ConvexError("این سند قابل قطعی‌شدن نیست.");
    }
    if (document.kind !== "normal") {
      throw new ConvexError("سند سیستمی از این مسیر قطعی نمی‌شود.");
    }
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      document.fiscalYearId,
    );
    assertDocumentDateInFiscalYear(fiscalYear, document.documentDate);
    const lines = await loadDocumentLines(ctx, document._id);
    const validated = await validateDocumentLines(
      ctx,
      args.businessId,
      lines,
      { requireBalanced: true, fallbackDescription: document.description },
    );

    if (document.correctionOfId) {
      const original = await ctx.db.get(document.correctionOfId);
      if (!original || original.businessId !== args.businessId) {
        throw new ConvexError("سند اصلی این اصلاحیه در کسب‌وکار یافت نشد.");
      }
      if (original.fiscalYearId !== fiscalYear._id) {
        throw new ConvexError(
          "سند اصلاحی و سند اصلی باید در یک دوره مالی باشند.",
        );
      }
      if (original.status !== "posted" || original.reversedByDocumentId) {
        throw new ConvexError(
          "سند اصلی دیگر در وضعیت قطعی قابل اصلاح نیست؛ ابتدا وضعیت آن را بررسی کنید.",
        );
      }
      const reversal = await createReversalRecord(
        ctx,
        args.businessId,
        original,
        fiscalYear,
        document.documentDate,
        user._id,
        `معکوس خودکار برای اصلاح سند ${original.number}`,
      );
      await writeAccountingAudit(ctx, {
        businessId: args.businessId,
        documentId: original._id,
        actorId: user._id,
        action: "document.reverse",
        summary: `معکوس‌شدن سند ${original.number} هنگام قطعی‌کردن اصلاحیه ${document.number} با سند ${reversal.number}`,
      });
      await writeAccountingAudit(ctx, {
        businessId: args.businessId,
        documentId: reversal.reversalId,
        actorId: user._id,
        action: "document.reversal",
        summary: `ثبت سند معکوس برای ${original.number}`,
      });
    }

    const now = Date.now();
    await ctx.db.patch(document._id, {
      status: "posted",
      postedAt: now,
      updatedAt: now,
      totalDebit: validated.totalDebit,
      totalCredit: validated.totalCredit,
    });
    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: document._id,
      actorId: user._id,
      action: "document.post",
      summary: `قطعی‌شدن سند ${document.number}`,
      detail: JSON.stringify({
        totalDebit: validated.totalDebit,
        totalCredit: validated.totalCredit,
      }),
    });
    return { documentId: document._id, status: "posted" as const };
  },
});

/**
 * Creates the posted mirror document and marks the original reversed. This is
 * a plain transaction helper so both explicit reversal and automatic reversal
 * during correction posting share exactly the same accounting rules.
 */
async function createReversalRecord(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  document: Doc<"accountingDocuments">,
  fiscalYear: Doc<"fiscalYears">,
  reversalDate: number,
  actorId: Id<"users">,
  description: string,
) {
  if (document.status !== "posted" || document.kind !== "normal") {
    throw new ConvexError("فقط سند قطعی عادی قابل معکوس‌شدن است.");
  }
  if (document.reversedByDocumentId) {
    throw new ConvexError("این سند قبلاً معکوس شده است.");
  }
  const sourceLines = await loadDocumentLines(ctx, document._id);
  if (sourceLines.length === 0) {
    throw new ConvexError("سند اصلی ردیف ندارد.");
  }
  const { number, sequence } = await nextDocumentNumber(
    ctx,
    businessId,
    fiscalYear,
  );
  const now = Date.now();
  const reversalId = await ctx.db.insert("accountingDocuments", {
    businessId,
    fiscalYearId: fiscalYear._id,
    branchId: document.branchId,
    number,
    sequence,
    documentDate: reversalDate,
    description,
    status: "posted",
    kind: "normal",
    totalDebit: document.totalCredit,
    totalCredit: document.totalDebit,
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
    postedAt: now,
    reversalOfId: document._id,
  });

  let totalDebit = 0;
  let totalCredit = 0;
  for (const [position, line] of sourceLines
    .sort((a, b) => a.position - b.position)
    .entries()) {
    const debit = line.credit;
    const credit = line.debit;
    totalDebit += debit;
    totalCredit += credit;
    await ctx.db.insert("accountingDocumentLines", {
      businessId,
      documentId: reversalId,
      accountId: line.accountId,
      description: `معکوس: ${line.description}`,
      debit,
      credit,
      position,
    });
  }
  if (totalDebit !== totalCredit) {
    throw new ConvexError("سند اصلی متوازن نیست و قابل معکوس‌شدن نیست.");
  }

  await ctx.db.patch(document._id, {
    status: "reversed",
    reversedAt: now,
    reversedByDocumentId: reversalId,
    updatedAt: now,
  });
  await ctx.db.patch(reversalId, { totalDebit, totalCredit });
  return { reversalId, number };
}

export const reverse = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
    reversalDate: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      document.fiscalYearId,
    );
    assertDocumentDateInFiscalYear(fiscalYear, args.reversalDate);
    const description =
      optionalString(args.description, "شرح سند معکوس", 500) ??
      `سند معکوس ${document.number}`;
    const { reversalId, number } = await createReversalRecord(
      ctx,
      args.businessId,
      document,
      fiscalYear,
      args.reversalDate,
      user._id,
      description,
    );

    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: document._id,
      actorId: user._id,
      action: "document.reverse",
      summary: `معکوس‌شدن سند ${document.number} با سند ${number}`,
    });
    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: reversalId,
      actorId: user._id,
      action: "document.reversal",
      summary: `ثبت سند معکوس برای ${document.number}`,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "accounting.reverse",
      entity: "accountingDocuments",
      entityId: document._id,
      summary: `سند ${document.number} معکوس شد؛ سند ${number}`,
    });

    return { reversalId, number };
  },
});

export const createCorrection = mutation({
  args: {
    businessId: v.id("businesses"),
    documentId: v.id("accountingDocuments"),
    correctionDate: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const document = await loadDocument(ctx, args.businessId, args.documentId);
    if (document.status !== "posted" || document.kind !== "normal") {
      throw new ConvexError("فقط از سند قطعی عادی می‌توان سند اصلاحی ساخت.");
    }
    const fiscalYear = await getFiscalYear(
      ctx,
      args.businessId,
      document.fiscalYearId,
    );
    assertDocumentDateInFiscalYear(fiscalYear, args.correctionDate);
    const sourceLines = await loadDocumentLines(ctx, document._id);
    const description =
      optionalString(args.description, "شرح سند اصلاحی", 500) ??
      `اصلاح سند ${document.number}`;
    const { number, sequence } = await nextDocumentNumber(
      ctx,
      args.businessId,
      fiscalYear,
    );
    const now = Date.now();
    const correctionId = await ctx.db.insert("accountingDocuments", {
      businessId: args.businessId,
      fiscalYearId: fiscalYear._id,
      branchId: document.branchId,
      number,
      sequence,
      documentDate: args.correctionDate,
      description,
      status: "draft",
      kind: "normal",
      totalDebit: document.totalDebit,
      totalCredit: document.totalCredit,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
      correctionOfId: document._id,
    });
    for (const [position, line] of sourceLines
      .sort((a, b) => a.position - b.position)
      .entries()) {
      await ctx.db.insert("accountingDocumentLines", {
        businessId: args.businessId,
        documentId: correctionId,
        accountId: line.accountId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        position,
      });
    }
    await writeAccountingAudit(ctx, {
      businessId: args.businessId,
      documentId: correctionId,
      actorId: user._id,
      action: "document.correction",
      summary: `ایجاد پیش‌نویس اصلاحی برای سند ${document.number}`,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "accounting.correction",
      entity: "accountingDocuments",
      entityId: document._id,
      summary: `سند اصلاحی ${number} برای ${document.number}`,
    });
    return { correctionId, number };
  },
});

export const settings = query({
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
    return {
      fiscalYearId: fiscalYear._id as string,
      name: fiscalYear.name,
      status: fiscalYear.status,
      year: currentJalaliYear(fiscalYear.startAt),
      prefix: fiscalYear.documentNumberPrefix ?? "JV",
      padding: fiscalYear.documentNumberPadding ?? 4,
    };
  },
});

export const updateSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    prefix: v.string(),
    padding: v.number(),
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
      throw new ConvexError("الگوی شماره‌گذاری دوره بسته قابل تغییر نیست.");
    }
    const prefix = (requireString(args.prefix, "پیشوند شماره سند", {
      max: 12,
    }) as string)
      .replace(/\s/g, "")
      .toUpperCase();
    if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) {
      throw new ConvexError(
        "پیشوند شماره سند باید شامل حروف انگلیسی، رقم یا خط تیره باشد.",
      );
    }
    if (!Number.isInteger(args.padding) || args.padding < 3 || args.padding > 10) {
      throw new ConvexError("تعداد ارقام شماره سند باید بین ۳ تا ۱۰ باشد.");
    }
    await ctx.db.patch(fiscalYear._id, {
      documentNumberPrefix: prefix,
      documentNumberPadding: args.padding,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "accounting.settings",
      entity: "fiscalYears",
      entityId: fiscalYear._id,
      summary: `الگوی شماره سند: ${prefix} / ${args.padding} رقم`,
    });
    return { prefix, padding: args.padding };
  },
});

