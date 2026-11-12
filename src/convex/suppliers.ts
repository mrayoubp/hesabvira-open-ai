import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
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

async function loadSupplier(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  supplierId: Id<"suppliers">,
) {
  const supplier = await ctx.db.get(supplierId);
  if (!supplier || supplier.businessId !== businessId) {
    throw new ConvexError("تأمین‌کننده در این کسب‌وکار یافت نشد.");
  }
  return supplier;
}

async function supplierBalance(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  supplierId: Id<"suppliers">,
) {
  const invoices = await ctx.db
    .query("purchaseInvoices")
    .withIndex("by_business_supplier", (q) =>
      q.eq("businessId", businessId).eq("supplierId", supplierId),
    )
    .take(3000);
  return invoices.reduce((sum, invoice) => {
    if (invoice.kind !== "purchase") return sum;
    if (invoice.status === "draft" || invoice.status === "cancelled") return sum;
    return (
      sum +
      Math.max(
        0,
        invoice.total -
          invoice.paidAmount -
          (invoice.returnedAmount ?? 0),
      )
    );
  }, 0);
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    search: v.optional(v.string()),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("suppliers")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(1500);
    const invoices = await ctx.db
      .query("purchaseInvoices")
      .withIndex("by_business_date", (q) => q.eq("businessId", args.businessId))
      .take(4000);
    const rollup = new Map<string, { count: number; purchases: number; balance: number }>();
    for (const invoice of invoices) {
      if (invoice.status === "draft" || invoice.status === "cancelled") continue;
      const key = invoice.supplierId as string;
      const entry = rollup.get(key) ?? { count: 0, purchases: 0, balance: 0 };
      if (invoice.kind === "purchase") {
        entry.count += 1;
        entry.purchases += invoice.total;
        entry.balance += Math.max(
          0,
          invoice.total -
            invoice.paidAmount -
            (invoice.returnedAmount ?? 0),
        );
      }
      rollup.set(key, entry);
    }
    const needle = args.search?.trim().toLowerCase();
    return rows
      .filter((row) => args.includeInactive || row.active)
      .filter((row) => {
        if (!needle) return true;
        return [row.name, row.code, row.phone, row.mobile, row.nationalId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .map((row) => {
        const item = rollup.get(row._id as string);
        return {
          _id: row._id as string,
          code: row.code,
          name: row.name,
          personType: row.personType,
          phone: row.phone ?? null,
          mobile: row.mobile ?? null,
          email: row.email ?? null,
          nationalId: row.nationalId ?? null,
          economicCode: row.economicCode ?? null,
          address: row.address ?? null,
          bankAccountNumber: row.bankAccountNumber ?? null,
          bankName: row.bankName ?? null,
          creditLimit: row.creditLimit,
          active: row.active,
          note: row.note ?? null,
          purchaseCount: item?.count ?? 0,
          totalPurchases: item?.purchases ?? 0,
          balance: item?.balance ?? 0,
          createdAt: row.createdAt,
        };
      });
  },
});

export const get = query({
  args: { businessId: v.id("businesses"), supplierId: v.id("suppliers") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const supplier = await loadSupplier(ctx, args.businessId, args.supplierId);
    const [invoices, payments] = await Promise.all([
      ctx.db
        .query("purchaseInvoices")
        .withIndex("by_business_supplier", (q) =>
          q.eq("businessId", args.businessId).eq("supplierId", args.supplierId),
        )
        .take(2000),
      ctx.db
        .query("paymentVouchers")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(3000),
    ]);
    const supplierPayments = payments.filter(
      (row) => row.supplierId === args.supplierId || row.partyName === supplier.name,
    );
    return {
      ...supplier,
      _id: supplier._id as string,
      balance: await supplierBalance(ctx, args.businessId, args.supplierId),
      invoices: invoices
        .sort((a, b) => b.issueDate - a.issueDate)
        .map((row) => ({
          _id: row._id as string,
          number: row.number,
          kind: row.kind,
          status: row.status,
          issueDate: row.issueDate,
          total: row.total,
          paidAmount: row.paidAmount,
          outstanding: Math.max(0, row.total - row.paidAmount - (row.returnedAmount ?? 0)),
        })),
      payments: supplierPayments
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .map((row) => ({
          _id: row._id as string,
          number: row.number,
          status: row.status,
          amount: row.amount,
          method: row.method,
          occurredAt: row.occurredAt,
          description: row.description,
        })),
    };
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
    bankAccountNumber: v.optional(v.string()),
    bankName: v.optional(v.string()),
    iban: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const requestedCode = optionalString(args.code, "کد تأمین‌کننده", 40);
    let code = requestedCode;
    if (code) {
      const duplicate = await ctx.db
        .query("suppliers")
        .withIndex("by_business_code", (q) =>
          q.eq("businessId", args.businessId).eq("code", code as string),
        )
        .unique();
      if (duplicate) throw new ConvexError("کد تأمین‌کننده تکراری است.");
    } else {
      const sequence = await nextCounter(ctx, args.businessId, "supplier");
      code = padSequence(sequence, "SUP");
    }
    const now = Date.now();
    const supplierId = await ctx.db.insert("suppliers", {
      businessId: args.businessId,
      code,
      name: requireString(args.name, "نام تأمین‌کننده", { max: 160 }) as string,
      personType: args.personType ?? "legal",
      phone: validatePhone(args.phone),
      mobile: validatePhone(args.mobile),
      email: validateEmail(args.email),
      nationalId: optionalString(args.nationalId, "شناسه ملی", 30),
      economicCode: optionalString(args.economicCode, "شناسه اقتصادی", 30),
      postalCode: optionalString(args.postalCode, "کد پستی", 20),
      address: optionalString(args.address, "نشانی", 400),
      bankAccountNumber: optionalString(args.bankAccountNumber, "شماره حساب", 50),
      bankName: optionalString(args.bankName, "نام بانک", 100),
      iban: optionalString(args.iban, "شبا", 40),
      creditLimit: requireInt(args.creditLimit ?? 0, "سقف اعتبار", { min: 0 }),
      note: optionalString(args.note, "توضیحات", 500),
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "supplier.create",
      entity: "suppliers",
      entityId: supplierId,
      summary: `ثبت تأمین‌کننده ${code}`,
    });
    return { supplierId, code };
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    supplierId: v.id("suppliers"),
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
    bankAccountNumber: v.optional(v.string()),
    bankName: v.optional(v.string()),
    iban: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const supplier = await loadSupplier(ctx, args.businessId, args.supplierId);
    let code = supplier.code;
    if (args.code !== undefined) {
      const requested = requireString(args.code, "کد تأمین‌کننده", { max: 40 }) as string;
      if (requested !== supplier.code) {
        const duplicate = await ctx.db
          .query("suppliers")
          .withIndex("by_business_code", (q) =>
            q.eq("businessId", args.businessId).eq("code", requested),
          )
          .unique();
        if (duplicate) throw new ConvexError("کد تأمین‌کننده تکراری است.");
        code = requested;
      }
    }
    await ctx.db.patch(supplier._id, {
      code,
      name: requireString(args.name, "نام تأمین‌کننده", { max: 160 }) as string,
      personType: args.personType ?? supplier.personType,
      phone: validatePhone(args.phone),
      mobile: validatePhone(args.mobile),
      email: validateEmail(args.email),
      nationalId: optionalString(args.nationalId, "شناسه ملی", 30),
      economicCode: optionalString(args.economicCode, "شناسه اقتصادی", 30),
      postalCode: optionalString(args.postalCode, "کد پستی", 20),
      address: optionalString(args.address, "نشانی", 400),
      bankAccountNumber: optionalString(args.bankAccountNumber, "شماره حساب", 50),
      bankName: optionalString(args.bankName, "نام بانک", 100),
      iban: optionalString(args.iban, "شبا", 40),
      creditLimit: requireInt(args.creditLimit ?? supplier.creditLimit, "سقف اعتبار", { min: 0 }),
      note: optionalString(args.note, "توضیحات", 500),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "supplier.update",
      entity: "suppliers",
      entityId: supplier._id,
      summary: `ویرایش تأمین‌کننده ${code}`,
    });
    return { supplierId: supplier._id };
  },
});

export const setActive = mutation({
  args: {
    businessId: v.id("businesses"),
    supplierId: v.id("suppliers"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, { write: true });
    const supplier = await loadSupplier(ctx, args.businessId, args.supplierId);
    await ctx.db.patch(supplier._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.active ? "supplier.activate" : "supplier.deactivate",
      entity: "suppliers",
      entityId: supplier._id,
      summary: `${args.active ? "فعال‌سازی" : "غیرفعال‌سازی"} ${supplier.code}`,
    });
    return { supplierId: supplier._id };
  },
});
