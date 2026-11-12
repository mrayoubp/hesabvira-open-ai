import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMembership, writeAudit } from "./lib/tenant";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";
import { resolveDocumentScope } from "./lib/workspace";
import { transactionKindValidator } from "./schema";

const methodValidator = v.union(
  v.literal("cash"),
  v.literal("bank"),
  v.literal("accrual"),
);

/**
 * Other income and operating expenses. These are management records only;
 * they do not claim to be a double-entry journal or a tax filing.
 */
export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    kind: v.optional(transactionKindValidator),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(limit);

    const needle = args.search?.trim().toLowerCase();
    return rows
      .filter((row) => !args.branchId || row.branchId === args.branchId)
      .filter(
        (row) => !args.fiscalYearId || row.fiscalYearId === args.fiscalYearId,
      )
      .filter((row) => !args.kind || row.kind === args.kind)
      .filter((row) => {
        if (!needle) return true;
        return [row.title, row.category, row.notes].some((value) =>
          value?.toLowerCase().includes(needle),
        );
      })
      .map((row) => ({
        _id: row._id as string,
        kind: row.kind,
        title: row.title,
        amount: row.amount,
        category: row.category ?? null,
        method: row.method,
        occurredAt: row.occurredAt,
        notes: row.notes ?? null,
      }));
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    kind: transactionKindValidator,
    title: v.string(),
    amount: v.number(),
    category: v.optional(v.string()),
    method: methodValidator,
    occurredAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(
      ctx,
      args.businessId,
      { write: true },
    );

    const title = requireString(args.title, "عنوان", { max: 160 }) as string;
    const amount = requireInt(args.amount, "مبلغ", { min: 1 });
    const occurredAt = args.occurredAt ?? Date.now();
    if (!Number.isFinite(occurredAt)) {
      throw new Error("تاریخ ثبت معتبر نیست.");
    }
    const category = optionalString(args.category, "دسته‌بندی", 80);
    const notes = optionalString(args.notes, "توضیحات", 500);
    const scope = await resolveDocumentScope(
      ctx,
      args.businessId,
      occurredAt,
    );

    const transactionId = await ctx.db.insert("transactions", {
      businessId: args.businessId,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      kind: args.kind,
      title,
      amount,
      category,
      method: args.method,
      occurredAt,
      notes,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action:
        args.kind === "income" ? "transaction.income" : "transaction.expense",
      entity: "transactions",
      entityId: transactionId,
      summary: `ثبت ${args.kind === "income" ? "درآمد" : "هزینه"} «${title}» — ${business.name}`,
    });

    return { transactionId };
  },
});
