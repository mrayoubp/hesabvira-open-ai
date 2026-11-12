import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  nextCounter,
  padSequence,
  requireMembership,
  writeAudit,
} from "./lib/tenant";
import {
  computeLines,
  computeTotals,
  optionalString,
  requireInt,
} from "./lib/validation";
import { invoiceStatusValidator, type InvoiceStatus } from "./schema";
import { resolveDocumentScope } from "./lib/workspace";
import { applyInvoiceReceipt } from "./lib/receipts";

const lineArg = v.object({
  description: v.string(),
  quantityMilli: v.number(),
  unitPrice: v.number(),
});

export interface InvoiceSummary {
  _id: Id<"invoices">;
  number: string;
  status: InvoiceStatus;
  customerId: Id<"customers">;
  customerName: string;
  issueDate: number;
  dueDate: number | null;
  subtotal: number;
  discount: number;
  taxRateBps: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  outstanding: number;
  notes: string | null;
}

function toSummary(
  invoice: Doc<"invoices">,
  customerName: string,
): InvoiceSummary {
  return {
    _id: invoice._id,
    number: invoice.number,
    status: invoice.status,
    customerId: invoice.customerId,
    customerName,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? null,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    taxRateBps: invoice.taxRateBps,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    paidAmount: invoice.paidAmount ?? 0,
    outstanding: Math.max(
      0,
      invoice.total -
        (invoice.returnedAmount ?? 0) -
        (invoice.paidAmount ?? 0),
    ),
    notes: invoice.notes ?? null,
  };
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    status: v.optional(invoiceStatusValidator),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<InvoiceSummary[]> => {
    await requireMembership(ctx, args.businessId);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_business_issue", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(1000);

    // Resolve the primary branch and selected fiscal year so documents from
    // before Phase 4 still respect the active scope.
    const [branches, fiscalYears] = await Promise.all([
      ctx.db
        .query("branches")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .collect(),
      ctx.db
        .query("fiscalYears")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .collect(),
    ]);
    const primaryBranchId = branches.find((branch) => branch.isPrimary)?._id;
    const selectedFiscalYear = fiscalYears.find(
      (year) => year._id === args.fiscalYearId,
    );

    const scopedInvoices = invoices.filter((invoice) => {
      if (args.branchId) {
        const branchId = invoice.branchId ?? primaryBranchId;
        if (branchId !== args.branchId) return false;
      }
      if (args.fiscalYearId) {
        if (invoice.fiscalYearId) {
          if (invoice.fiscalYearId !== args.fiscalYearId) return false;
        } else if (
          !selectedFiscalYear ||
          invoice.issueDate < selectedFiscalYear.startAt ||
          invoice.issueDate > selectedFiscalYear.endAt
        ) {
          return false;
        }
      }
      return true;
    });

    const customerIds = [...new Set(scopedInvoices.map((i) => i.customerId))];
    const customers = await Promise.all(
      customerIds.map((id) => ctx.db.get(id)),
    );
    const names = new Map<string, string>();
    for (const customer of customers) {
      if (customer) names.set(customer._id as string, customer.name);
    }

    const needle = args.search?.trim().toLowerCase();

    return scopedInvoices
      .filter((invoice) => !args.status || invoice.status === args.status)
      .map((invoice) => toSummary(invoice, names.get(invoice.customerId) ?? "—"))
      .filter((invoice) => {
        if (!needle) return true;
        return (
          invoice.number.toLowerCase().includes(needle) ||
          invoice.customerName.toLowerCase().includes(needle)
        );
      });
  },
});

export const get = query({
  args: {
    businessId: v.id("businesses"),
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) {
      throw new ConvexError("فاکتور مورد نظر در این کسب‌وکار یافت نشد.");
    }

    const [customer, items] = await Promise.all([
      ctx.db.get(invoice.customerId),
      ctx.db
        .query("invoiceItems")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect(),
    ]);

    return {
      ...toSummary(invoice, customer?.name ?? "—"),
      customerCode: customer?.code ?? null,
      customerPhone: customer?.phone ?? null,
      items: items
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          _id: item._id,
          description: item.description,
          quantityMilli: item.quantityMilli,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
    };
  },
});

/** Creates a draft or issues a final invoice. Totals are always server-computed. */
export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    lines: v.array(lineArg),
    discount: v.number(),
    taxRateBps: v.number(),
    notes: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("issued")),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, business } = await requireMembership(
      ctx,
      args.businessId,
      { write: true },
    );

    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }

    const { lines, subtotal } = computeLines(args.lines);
    const totals = computeTotals({
      subtotal,
      discount: args.discount,
      taxRateBps: args.taxRateBps,
    });

    const notes = optionalString(args.notes, "توضیحات", 1000);
    const dueDate =
      args.dueDate === undefined
        ? Date.now() + 30 * 24 * 60 * 60 * 1000
        : requireInt(args.dueDate, "سررسید", { min: 0 });

    const sequence = await nextCounter(ctx, args.businessId, "invoice");
    const number = padSequence(sequence, "INV");
    const now = Date.now();
    const scope = await resolveDocumentScope(ctx, business._id, now);

    const invoiceId = await ctx.db.insert("invoices", {
      businessId: business._id,
      customerId: customer._id,
      sequence,
      number,
      status: args.status,
      issueDate: now,
      branchId: scope.branchId,
      fiscalYearId: scope.fiscalYearId,
      paidAmount: 0,
      dueDate,
      subtotal,
      discount: totals.discount,
      taxRateBps: totals.taxRateBps,
      taxAmount: totals.taxAmount,
      total: totals.total,
      notes,
      issuedAt: args.status === "issued" ? now : undefined,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    for (const [index, line] of lines.entries()) {
      await ctx.db.insert("invoiceItems", {
        businessId: business._id,
        invoiceId,
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        position: index,
      });
    }

    await writeAudit(ctx, {
      businessId: business._id,
      actorId: user._id,
      action: args.status === "issued" ? "invoice.issue" : "invoice.draft",
      entity: "invoices",
      entityId: invoiceId,
      summary: `${args.status === "issued" ? "صدور" : "پیش‌نویس"} فاکتور ${number} برای ${customer.name}`,
    });

    return { invoiceId, number };
  },
});

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
};

/** Moves an invoice through its lifecycle. Final documents are never rewritten. */
export const setStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    invoiceId: v.id("invoices"),
    status: invoiceStatusValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== args.businessId) {
      throw new ConvexError("فاکتور مورد نظر در این کسب‌وکار یافت نشد.");
    }

    const allowed = ALLOWED_TRANSITIONS[invoice.status];
    if (!allowed.includes(args.status)) {
      throw new ConvexError(
        invoice.status === "paid"
          ? "فاکتور پرداخت‌شده قابل تغییر وضعیت نیست."
          : "تغییر وضعیت درخواستی برای این فاکتور مجاز نیست.",
      );
    }

    const now = Date.now();

    // Marking an issued invoice paid records the remaining amount as a real
    // cash receipt, so cash/bank balances and cash-flow charts stay truthful.
    if (args.status === "paid") {
      const customer = await ctx.db.get(invoice.customerId);
      if (!customer || customer.businessId !== args.businessId) {
        throw new ConvexError("مشتری این فاکتور در دسترس نیست.");
      }
      const business = await ctx.db.get(args.businessId);
      if (!business) throw new ConvexError("کسب‌وکار در دسترس نیست.");
      const remaining = Math.max(
        0,
        invoice.total -
          (invoice.returnedAmount ?? 0) -
          (invoice.paidAmount ?? 0),
      );
      if (remaining > 0) {
        await applyInvoiceReceipt(ctx, {
          business,
          invoice,
          customer,
          actorId: user._id,
          amount: remaining,
          method: "cash",
          occurredAt: now,
        });
      }
    }

    await ctx.db.patch(invoice._id, {
      status: args.status,
      updatedAt: now,
      issuedAt:
        args.status === "issued" ? now : invoice.issuedAt,
      paidAt: args.status === "paid" ? now : invoice.paidAt,
      voidedAt: args.status === "void" ? now : invoice.voidedAt,
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: `invoice.${args.status}`,
      entity: "invoices",
      entityId: invoice._id,
      summary: `فاکتور ${invoice.number} → ${args.status}`,
    });

    return { invoiceId: invoice._id, status: args.status };
  },
});
