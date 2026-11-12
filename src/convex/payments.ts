import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireMembership } from "./lib/tenant";
import { requireInt, optionalString } from "./lib/validation";
import { applyInvoiceReceipt } from "./lib/receipts";
import { paymentDirectionValidator, paymentMethodValidator } from "./schema";

/**
 * Lists real receipts / payments for the tenant. The page is read-only except
 * for `recordReceipt`; supplier payments belong to a future purchasing module.
 */
export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    direction: v.optional(paymentDirectionValidator),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query("payments")
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
      .filter((row) => !args.direction || row.direction === args.direction)
      .filter((row) => {
        if (!needle) return true;
        return [row.partyName, row.notes].some((value) =>
          value?.toLowerCase().includes(needle),
        );
      })
      .map((row) => ({
        _id: row._id as string,
        direction: row.direction,
        invoiceId: row.invoiceId ? (row.invoiceId as string) : null,
        partyName: row.partyName,
        partyType: row.partyType,
        amount: row.amount,
        method: row.method,
        occurredAt: row.occurredAt,
        notes: row.notes ?? null,
      }));
  },
});

/**
 * Records a customer receipt against an issued invoice. The amount can be
 * partial; totals and the invoice status are updated on the server.
 */
export const recordReceipt = mutation({
  args: {
    businessId: v.id("businesses"),
    invoiceId: v.id("invoices"),
    amount: v.number(),
    method: paymentMethodValidator,
    occurredAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(
      ctx,
      args.businessId,
      { write: true },
    );

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) {
      throw new ConvexError("فاکتور مورد نظر در این کسب‌وکار یافت نشد.");
    }
    if (invoice.status === "paid") {
      throw new ConvexError("این فاکتور قبلاً تسویه شده است.");
    }
    if (invoice.status !== "issued") {
      throw new ConvexError(
        "دریافت وجه فقط برای فاکتور صادرشده (قطعی) قابل ثبت است.",
      );
    }

    const customer = await ctx.db.get(invoice.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری این فاکتور در دسترس نیست.");
    }

    const amount = requireInt(args.amount, "مبلغ دریافت", { min: 1 });
    const occurredAt = args.occurredAt ?? Date.now();
    if (!Number.isFinite(occurredAt)) {
      throw new ConvexError("تاریخ دریافت معتبر نیست.");
    }

    return await applyInvoiceReceipt(ctx, {
      business,
      invoice,
      customer,
      actorId: user._id,
      amount,
      method: args.method,
      occurredAt,
      notes: optionalString(args.notes, "توضیحات", 500),
    });
  },
});

/** Used by the invoice detail UI to show real receipts, not guessed amounts. */
export function effectivePaidAmount(invoice: Doc<"invoices">) {
  return invoice.paidAmount ?? 0;
}
