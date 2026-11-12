import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { nextCounter, padSequence, requireMembership, writeAudit } from "./lib/tenant";
import {
  optionalString,
  requireInt,
  requireString,
  validateEmail,
  validatePhone,
} from "./lib/validation";
import { personTypeValidator } from "./schema";

export interface CustomerSummary {
  _id: Id<"customers">;
  code: string;
  name: string;
  personType: "individual" | "legal";
  phone: string | null;
  mobile: string | null;
  email: string | null;
  nationalId: string | null;
  economicCode: string | null;
  postalCode: string | null;
  address: string | null;
  creditLimit: number;
  active: boolean;
  note: string | null;
  createdAt: number;
  invoiceCount: number;
  totalSales: number;
  outstanding: number;
}

/**
 * Lists customers of a business with their invoice rollups.
 * Search runs server-side over the tenant's own records only.
 */
export const list = query({
  args: {
    businessId: v.id("businesses"),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CustomerSummary[]> => {
    await requireMembership(ctx, args.businessId);

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(1000);

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(5000);

    const rollups = new Map<
      string,
      { invoiceCount: number; totalSales: number; outstanding: number }
    >();
    for (const invoice of invoices) {
      if (invoice.status === "void") continue;
      const key = invoice.customerId as string;
      const entry = rollups.get(key) ?? {
        invoiceCount: 0,
        totalSales: 0,
        outstanding: 0,
      };
      entry.invoiceCount += 1;
      if (invoice.status === "issued" || invoice.status === "paid") {
        const effective = invoice.total - (invoice.returnedAmount ?? 0);
        entry.totalSales += effective;
        entry.outstanding += Math.max(
          0,
          effective - (invoice.paidAmount ?? 0),
        );
      }
      rollups.set(key, entry);
    }

    const needle = args.search?.trim().toLowerCase();

    return customers
      .filter((customer) => !customer.archivedAt)
      .filter((customer) => {
        if (!needle) return true;
        return [
          customer.name,
          customer.code,
          customer.phone,
          customer.mobile,
          customer.nationalId,
          customer.economicCode,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle));
      })
      .map((customer) => {
        const rollup = rollups.get(customer._id as string);
        return {
          _id: customer._id,
          code: customer.code,
          name: customer.name,
          personType: customer.personType ?? "individual",
          phone: customer.phone ?? null,
          mobile: customer.mobile ?? null,
          email: customer.email ?? null,
          nationalId: customer.nationalId ?? null,
          economicCode: customer.economicCode ?? null,
          postalCode: customer.postalCode ?? null,
          address: customer.address ?? null,
          creditLimit: customer.creditLimit ?? 0,
          active: customer.active ?? true,
          note: customer.note ?? null,
          createdAt: customer.createdAt,
          invoiceCount: rollup?.invoiceCount ?? 0,
          totalSales: rollup?.totalSales ?? 0,
          outstanding: rollup?.outstanding ?? 0,
        };
      });
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    code: v.optional(v.string()),
    name: v.string(),
    personType: v.optional(personTypeValidator),
    phone: v.optional(v.string()),
    mobile: v.optional(v.string()),
    email: v.optional(v.string()),
    nationalId: v.optional(v.string()),
    economicCode: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    address: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { business, user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });

    const name = requireString(args.name, "نام مشتری", { max: 160 }) as string;
    const phone = validatePhone(args.phone);
    const mobile = validatePhone(args.mobile);
    const email = validateEmail(args.email);
    const nationalId = optionalString(args.nationalId, "کد ملی", 20);
    const economicCode = optionalString(args.economicCode, "شناسه اقتصادی", 30);
    const postalCode = optionalString(args.postalCode, "کد پستی", 20);
    const address = optionalString(args.address, "نشانی", 400);
    const note = optionalString(args.note, "یادداشت", 400);
    const creditLimit = requireInt(args.creditLimit ?? 0, "سقف اعتبار", { min: 0 });

    const requestedCode = optionalString(args.code, "کد مشتری", 40);
    let code = requestedCode;
    if (code) {
      const duplicate = await ctx.db
        .query("customers")
        .withIndex("by_business_code", (q) =>
          q.eq("businessId", args.businessId).eq("code", code as string),
        )
        .unique();
      if (duplicate) throw new ConvexError("کد مشتری تکراری است.");
    } else {
      const sequence = await nextCounter(ctx, args.businessId, "customer");
      code = padSequence(sequence, "C");
    }
    const now = Date.now();

    const customerId = await ctx.db.insert("customers", {
      businessId: args.businessId,
      code,
      name,
      personType: args.personType ?? "individual",
      phone,
      mobile,
      email,
      nationalId,
      economicCode,
      postalCode,
      address,
      creditLimit,
      active: true,
      note,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "customer.create",
      entity: "customers",
      entityId: customerId,
      summary: `ثبت مشتری ${code} — ${name} (${business.name})`,
    });

    return { customerId, code };
  },
});

export const profile = query({
  args: { businessId: v.id("businesses"), customerId: v.id("customers") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری در این کسب‌وکار یافت نشد.");
    }
    const [invoices, receipts, returns] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
        .order("desc")
        .take(2000),
      ctx.db
        .query("receipts")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .order("desc")
        .take(3000),
      ctx.db
        .query("salesReturns")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(1000),
    ]);
    const customerReceipts = receipts.filter(
      (row) => row.customerId === args.customerId || row.partyName === customer.name,
    );
    const customerReturns = returns.filter((row) => row.customerId === args.customerId);
    const receiptByInvoice = new Map<string, number>();
    for (const receipt of customerReceipts.filter((row) => row.status === "posted" && row.invoiceId)) {
      const key = receipt.invoiceId as string;
      receiptByInvoice.set(key, (receiptByInvoice.get(key) ?? 0) + receipt.amount);
    }
    const invoiceRows = invoices.map((invoice) => {
      const effective = invoice.total - (invoice.returnedAmount ?? 0);
      const receiptsForInvoice = receiptByInvoice.get(invoice._id as string) ?? 0;
      const immediate = Math.max(0, (invoice.paidAmount ?? 0) - receiptsForInvoice);
      return { invoice, effective, immediate };
    });
    const events = [
      ...invoiceRows
        .filter(({ invoice }) => invoice.status !== "draft" && invoice.status !== "void")
        .map(({ invoice }) => ({
          _id: `${invoice._id}:invoice`,
          date: invoice.issueDate,
          type: "invoice" as const,
          reference: invoice.number,
          description: "فاکتور فروش",
          debit: invoice.total,
          credit: 0,
        })),
      ...customerReceipts
        .filter((row) => row.status === "posted")
        .map((row) => ({
          _id: `${row._id}:receipt`,
          date: row.occurredAt,
          type: "receipt" as const,
          reference: row.number,
          description: row.description,
          debit: 0,
          credit: row.amount,
        })),
      ...invoiceRows
        .filter(({ immediate }) => immediate > 0)
        .map(({ invoice, immediate }) => ({
          _id: `${invoice._id}:immediate`,
          date: invoice.issueDate,
          type: "invoice-payment" as const,
          reference: invoice.number,
          description: "پرداخت هنگام صدور فاکتور",
          debit: 0,
          credit: immediate,
        })),
      ...customerReturns.map((row) => ({
        _id: `${row._id}:return`,
        date: row.occurredAt,
        type: "return" as const,
        reference: row.number,
        description: "برگشت از فروش",
        debit: 0,
        credit: row.total,
      })),
    ].sort((a, b) => b.date - a.date);
    const totalSales = invoiceRows
      .filter(({ invoice }) => invoice.status === "issued" || invoice.status === "paid")
      .reduce((sum, row) => sum + row.effective, 0);
    const totalPaid = invoiceRows.reduce((sum, row) => sum + row.immediate, 0) +
      customerReceipts.filter((row) => row.status === "posted").reduce((sum, row) => sum + row.amount, 0);
    const outstanding = Math.max(0, totalSales - totalPaid);
    return {
      _id: customer._id as string,
      code: customer.code,
      name: customer.name,
      personType: customer.personType ?? "individual",
      phone: customer.phone ?? null,
      mobile: customer.mobile ?? null,
      email: customer.email ?? null,
      nationalId: customer.nationalId ?? null,
      economicCode: customer.economicCode ?? null,
      postalCode: customer.postalCode ?? null,
      address: customer.address ?? null,
      creditLimit: customer.creditLimit ?? 0,
      active: customer.active ?? true,
      note: customer.note ?? null,
      totalSales,
      totalPaid,
      outstanding,
      invoiceCount: invoiceRows.filter(({ invoice }) => invoice.status !== "draft" && invoice.status !== "void").length,
      invoices: invoiceRows.map(({ invoice }) => ({
        _id: invoice._id as string,
        number: invoice.number,
        status: invoice.status,
        issueDate: invoice.issueDate,
        total: invoice.total,
        paidAmount: invoice.paidAmount ?? 0,
        returnedAmount: invoice.returnedAmount ?? 0,
        outstanding: Math.max(0, invoice.total - (invoice.returnedAmount ?? 0) - (invoice.paidAmount ?? 0)),
      })),
      receipts: customerReceipts.map((row) => ({
        _id: row._id as string,
        number: row.number,
        status: row.status,
        amount: row.amount,
        method: row.method,
        occurredAt: row.occurredAt,
      })),
      statement: events.slice(0, 300),
      createdAt: customer.createdAt,
    };
  },
});

export const setActive = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری در این کسب‌وکار یافت نشد.");
    }
    await ctx.db.patch(customer._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.active ? "customer.activate" : "customer.deactivate",
      entity: "customers",
      entityId: customer._id,
      summary: `${args.active ? "فعال‌سازی" : "غیرفعال‌سازی"} مشتری ${customer.code}`,
    });
    return { customerId: customer._id };
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    code: v.optional(v.string()),
    name: v.string(),
    personType: v.optional(personTypeValidator),
    phone: v.optional(v.string()),
    mobile: v.optional(v.string()),
    email: v.optional(v.string()),
    nationalId: v.optional(v.string()),
    economicCode: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    address: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });

    const customer = await ctx.db.get(args.customerId);
    // Tenant boundary: the customer must belong to the caller's business.
    if (!customer || customer.businessId !== args.businessId) {
      throw new ConvexError("مشتری مورد نظر در این کسب‌وکار یافت نشد.");
    }

    const name = requireString(args.name, "نام مشتری", { max: 160 }) as string;
    let code = customer.code;
    if (args.code !== undefined) {
      const requested = requireString(args.code, "کد مشتری", { max: 40 }) as string;
      if (requested !== customer.code) {
        const duplicate = await ctx.db
          .query("customers")
          .withIndex("by_business_code", (q) =>
            q.eq("businessId", args.businessId).eq("code", requested),
          )
          .unique();
        if (duplicate) throw new ConvexError("کد مشتری تکراری است.");
        code = requested;
      }
    }

    await ctx.db.patch(customer._id, {
      code,
      name,
      personType: args.personType ?? customer.personType ?? "individual",
      phone: validatePhone(args.phone),
      mobile: validatePhone(args.mobile),
      email: validateEmail(args.email),
      nationalId: optionalString(args.nationalId, "کد ملی", 20),
      economicCode: optionalString(args.economicCode, "شناسه اقتصادی", 30),
      postalCode: optionalString(args.postalCode, "کد پستی", 20),
      address: optionalString(args.address, "نشانی", 400),
      creditLimit: requireInt(args.creditLimit ?? customer.creditLimit ?? 0, "سقف اعتبار", { min: 0 }),
      note: optionalString(args.note, "یادداشت", 400),
      updatedAt: Date.now(),
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "customer.update",
      entity: "customers",
      entityId: customer._id,
      summary: `ویرایش مشتری ${customer.code}`,
    });

    return { customerId: customer._id };
  },
});
