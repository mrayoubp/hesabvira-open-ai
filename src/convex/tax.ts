import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { taxPeriodStatusValidator, taxTypeValidator } from "./schema";
import { writeAudit } from "./lib/tenant";
import { dayStart, requireHrPermission } from "./lib/hr";
import { assertFileForBusiness } from "./lib/files";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";

const taxType = taxTypeValidator;
const taxPeriodStatus = taxPeriodStatusValidator;

async function withAttachmentUrl(
  ctx: Parameters<typeof requireHrPermission>[0],
  row: Doc<"taxRecords">,
) {
  return {
    ...row,
    attachmentUrl: row.attachmentStorageId
      ? await ctx.storage.getUrl(row.attachmentStorageId)
      : null,
  };
}

async function periodFor(
  ctx: Parameters<typeof requireHrPermission>[0],
  businessId: Id<"businesses">,
  periodId: Id<"taxPeriods">,
) {
  const period = await ctx.db.get(periodId);
  if (!period || period.businessId !== businessId) {
    throw new ConvexError("دوره مالیاتی در این کسب‌وکار یافت نشد.");
  }
  return period;
}

export const settings = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "tax.view");
    return await ctx.db
      .query("taxSettings")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const createSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    taxType,
    jurisdiction: v.string(),
    rateBps: v.number(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    sourceTitle: v.string(),
    sourceUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "tax.manage",
      { manage: true },
    );
    const effectiveFrom = dayStart(args.effectiveFrom);
    if (args.effectiveTo !== undefined && args.effectiveTo < effectiveFrom) {
      throw new ConvexError("پایان اعتبار باید بعد از شروع باشد.");
    }
    const now = Date.now();
    const settingsId = await ctx.db.insert("taxSettings", {
      businessId: args.businessId,
      name: requireString(args.name, "نام قانون مالیاتی", { max: 200 }) as string,
      taxType: args.taxType,
      jurisdiction: requireString(args.jurisdiction, "حوزه قضایی", {
        max: 120,
      }) as string,
      rateBps: requireInt(args.rateBps, "نرخ مالیات", {
        min: 0,
        max: 10_000,
      }),
      effectiveFrom,
      effectiveTo: args.effectiveTo,
      sourceTitle: requireString(args.sourceTitle, "منبع قانونی", {
        max: 300,
      }) as string,
      sourceUrl: optionalString(args.sourceUrl, "نشانی منبع", 500),
      notes: optionalString(args.notes, "یادداشت", 1000),
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "tax.settings.create",
      entity: "taxSettings",
      entityId: settingsId,
      summary: `ثبت نرخ مالیات ${args.name}`,
    });
    return { settingsId };
  },
});

export const updateSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    settingsId: v.id("taxSettings"),
    active: v.optional(v.boolean()),
    rateBps: v.optional(v.number()),
    effectiveTo: v.optional(v.number()),
    sourceTitle: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "tax.manage", {
      manage: true,
    });
    const row = await ctx.db.get(args.settingsId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("تنظیم مالیاتی یافت نشد.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.active !== undefined) patch.active = args.active;
    if (args.rateBps !== undefined)
      patch.rateBps = requireInt(args.rateBps, "نرخ مالیات", {
        min: 0,
        max: 10_000,
      });
    if (args.effectiveTo !== undefined) {
      if (args.effectiveTo < row.effectiveFrom) {
        throw new ConvexError("پایان اعتبار معتبر نیست.");
      }
      patch.effectiveTo = args.effectiveTo;
    }
    if (args.sourceTitle !== undefined)
      patch.sourceTitle = requireString(args.sourceTitle, "منبع قانونی", {
        max: 300,
      });
    if (args.sourceUrl !== undefined)
      patch.sourceUrl = optionalString(args.sourceUrl, "نشانی منبع", 500);
    if (args.notes !== undefined)
      patch.notes = optionalString(args.notes, "یادداشت", 1000);
    await ctx.db.patch(row._id, patch);
    return { settingsId: row._id };
  },
});

export const periods = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "tax.view");
    return await ctx.db
      .query("taxPeriods")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.endAt - a.endAt));
  },
});

export const createPeriod = mutation({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.id("fiscalYears"),
    title: v.string(),
    startAt: v.number(),
    endAt: v.number(),
    dueDate: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "tax.manage",
      { manage: true },
    );
    const fiscalYear = await ctx.db.get(args.fiscalYearId);
    if (!fiscalYear || fiscalYear.businessId !== args.businessId) {
      throw new ConvexError("دوره مالی انتخاب‌شده یافت نشد.");
    }
    const startAt = dayStart(args.startAt);
    const endAt = dayStart(args.endAt);
    const dueDate = dayStart(args.dueDate);
    if (endAt < startAt) {
      throw new ConvexError("پایان دوره مالیاتی معتبر نیست.");
    }
    if (dueDate < endAt) {
      throw new ConvexError("مهلت مالیاتی نمی‌تواند قبل از پایان دوره باشد.");
    }
    if (startAt < fiscalYear.startAt || endAt > fiscalYear.endAt) {
      throw new ConvexError("دوره مالیاتی باید داخل سال مالی باشد.");
    }
    const now = Date.now();
    const periodId = await ctx.db.insert("taxPeriods", {
      businessId: args.businessId,
      fiscalYearId: fiscalYear._id,
      title: requireString(args.title, "عنوان دوره مالیاتی", {
        max: 160,
      }) as string,
      startAt,
      endAt,
      dueDate,
      status: "open",
      notes: optionalString(args.notes, "یادداشت", 1000),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "tax.period.create",
      entity: "taxPeriods",
      entityId: periodId,
      summary: `ایجاد دوره مالیاتی ${args.title}`,
    });
    return { periodId };
  },
});

export const updatePeriodStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("taxPeriods"),
    status: taxPeriodStatus,
    confirmReviewed: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "tax.manage",
      { manage: true },
    );
    const period = await periodFor(ctx, args.businessId, args.periodId);
    const order = { open: 0, filed: 1, paid: 2, closed: 3 } as const;
    if (order[args.status] < order[period.status]) {
      throw new ConvexError("بازگشت وضعیت دوره مالیاتی مجاز نیست.");
    }
    if (args.status === period.status) {
      return { periodId: period._id, status: period.status };
    }
    if (args.status === "filed") {
      if (!args.confirmReviewed) {
        throw new ConvexError(
          "پیش از ثبت اظهارنامه، بازبینی اسناد و مقررات مالیاتی را تأیید کنید.",
        );
      }
      const records = await ctx.db
        .query("taxRecords")
        .withIndex("by_business_period", (q) =>
          q.eq("businessId", args.businessId).eq("periodId", period._id),
        )
        .collect();
      if (records.length === 0) {
        throw new ConvexError(
          "برای ثبت اظهارنامه، حداقل یک ردیف مالیاتی بازبینی‌شده لازم است.",
        );
      }
      if (records.some((row) => !row.reviewed)) {
        throw new ConvexError("همه ردیف‌های مالیاتی باید بازبینی شده باشند.");
      }
    }
    const now = Date.now();
    await ctx.db.patch(period._id, {
      status: args.status,
      filedAt: args.status === "filed" ? now : period.filedAt,
      paidAt: args.status === "paid" ? now : period.paidAt,
      notes: args.note
        ? `${period.notes ? `${period.notes}\n` : ""}${args.note}`
        : period.notes,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "tax.period.status",
      entity: "taxPeriods",
      entityId: period._id,
      summary: `تغییر وضعیت ${period.title} به ${args.status}`,
    });
    return { periodId: period._id, status: args.status };
  },
});

export const records = query({
  args: {
    businessId: v.id("businesses"),
    periodId: v.optional(v.id("taxPeriods")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "tax.view");
    const rows = args.periodId
      ? await ctx.db
          .query("taxRecords")
          .withIndex("by_business_period", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("periodId", args.periodId as Id<"taxPeriods">),
          )
          .collect()
      : await ctx.db
          .query("taxRecords")
          .withIndex("by_business_type", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(3000);
    return await Promise.all(rows.map((row) => withAttachmentUrl(ctx, row)));
  },
});

export const createRecord = mutation({
  args: {
    businessId: v.id("businesses"),
    periodId: v.id("taxPeriods"),
    taxType,
    taxableBase: v.number(),
    taxAmount: v.number(),
    description: v.string(),
    sourceReference: v.optional(v.string()),
    attachmentStorageId: v.optional(v.id("_storage")),
    attachmentName: v.optional(v.string()),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "tax.manage",
      { manage: true },
    );
    const period = await periodFor(ctx, args.businessId, args.periodId);
    if (period.status === "closed" || period.status === "paid") {
      throw new ConvexError("دوره بسته یا پرداخت‌شده قابل ثبت ردیف جدید نیست.");
    }
    if (args.attachmentStorageId) {
      await assertFileForBusiness(
        ctx,
        args.businessId,
        args.attachmentStorageId,
      );
    }
    const now = Date.now();
    const recordId = await ctx.db.insert("taxRecords", {
      businessId: args.businessId,
      periodId: period._id,
      taxType: args.taxType,
      taxableBase: requireInt(args.taxableBase, "مأخذ مالیات", { min: 0 }),
      taxAmount: requireInt(args.taxAmount, "مبلغ مالیات", { min: 0 }),
      description: requireString(args.description, "شرح ردیف مالیاتی", {
        max: 500,
      }) as string,
      sourceReference: optionalString(
        args.sourceReference,
        "شماره مرجع",
        200,
      ),
      attachmentStorageId: args.attachmentStorageId,
      attachmentName: optionalString(args.attachmentName, "نام پیوست", 200),
      reviewed: args.reviewed,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "tax.record.create",
      entity: "taxRecords",
      entityId: recordId,
      summary: `ثبت ردیف مالیاتی ${args.taxType} برای ${period.title}`,
    });
    return { recordId };
  },
});

export const preview = query({
  args: {
    businessId: v.id("businesses"),
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "tax.view");
    const [invoices, returns, purchases, payrolls] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_business_issue", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("issueDate", dayStart(args.from))
            .lte("issueDate", dayStart(args.to) + 86_400_000 - 1),
        )
        .take(5000),
      ctx.db
        .query("salesReturns")
        .withIndex("by_business_occurred", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("occurredAt", dayStart(args.from))
            .lte("occurredAt", dayStart(args.to) + 86_400_000 - 1),
        )
        .take(3000),
      ctx.db
        .query("purchaseInvoices")
        .withIndex("by_business_date", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("issueDate", dayStart(args.from))
            .lte("issueDate", dayStart(args.to) + 86_400_000 - 1),
        )
        .take(5000),
      ctx.db
        .query("payrollPeriods")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .collect(),
    ]);
    const matchesBranch = (branchId?: Id<"branches">) =>
      !args.branchId || branchId === args.branchId;
    const salesInvoices = invoices.filter(
      (row) =>
        (row.status === "issued" || row.status === "paid") &&
        matchesBranch(row.branchId),
    );
    const salesReturns = returns.filter(
      (row) => row.status !== "cancelled" && matchesBranch(row.branchId),
    );
    const purchaseInvoices = purchases.filter(
      (row) =>
        row.status !== "draft" &&
        row.status !== "cancelled" &&
        matchesBranch(row.branchId),
    );
    const payrollRows = payrolls.filter(
      (row) =>
        (row.status === "approved" || row.status === "paid") &&
        row.startAt >= dayStart(args.from) &&
        row.endAt <= dayStart(args.to) + 86_400_000 - 1,
    );
    const salesTax =
      salesInvoices.reduce((sum, row) => sum + row.taxAmount, 0) -
      salesReturns.reduce((sum, row) => sum + row.taxAmount, 0);
    const purchaseTax =
      purchaseInvoices
        .filter((row) => row.kind === "purchase")
        .reduce((sum, row) => sum + row.taxAmount, 0) -
      purchaseInvoices
        .filter((row) => row.kind === "return")
        .reduce((sum, row) => sum + row.taxAmount, 0);
    const payrollTax = payrollRows.reduce((sum, row) => sum + row.taxTotal, 0);
    return {
      salesTax,
      purchaseTax,
      payrollTax,
      netVat: salesTax - purchaseTax,
      salesBase: salesInvoices.reduce(
        (sum, row) => sum + row.subtotal - row.discount,
        0,
      ),
      purchaseBase: purchaseInvoices.reduce(
        (sum, row) => sum + row.subtotal - row.discount + row.extraCosts,
        0,
      ),
      invoiceCount: salesInvoices.length,
      purchaseCount: purchaseInvoices.length,
      payrollCount: payrollRows.length,
      note: "این محاسبه پیش‌نمایش مدیریتی است و اظهارنامه رسمی محسوب نمی‌شود.",
    };
  },
});

export const report = query({
  args: {
    businessId: v.id("businesses"),
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
    kind: v.union(
      v.literal("sales-tax"),
      v.literal("purchase-tax"),
      v.literal("payroll-tax"),
      v.literal("liabilities"),
    ),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "tax.view");
    const from = dayStart(args.from);
    const to = dayStart(args.to) + 86_400_000 - 1;
    if (args.kind === "sales-tax") {
      const [invoices, returns] = await Promise.all([
        ctx.db
          .query("invoices")
          .withIndex("by_business_issue", (q) =>
            q
              .eq("businessId", args.businessId)
              .gte("issueDate", from)
              .lte("issueDate", to),
          )
          .take(5000),
        ctx.db
          .query("salesReturns")
          .withIndex("by_business_occurred", (q) =>
            q
              .eq("businessId", args.businessId)
              .gte("occurredAt", from)
              .lte("occurredAt", to),
          )
          .take(3000),
      ]);
      const rows = invoices
        .filter(
          (row) =>
            (row.status === "issued" || row.status === "paid") &&
            (!args.branchId || row.branchId === args.branchId),
        )
        .map((row) => ({
          number: row.number,
          date: row.issueDate,
          base: row.subtotal - row.discount,
          tax: row.taxAmount,
          total: row.total,
          kind: "فروش",
        }));
      for (const row of returns.filter(
        (item) =>
          item.status !== "cancelled" &&
          (!args.branchId || item.branchId === args.branchId),
      )) {
        rows.push({
          number: row.number,
          date: row.occurredAt,
          base: -row.subtotal,
          tax: -row.taxAmount,
          total: -row.total,
          kind: "برگشت فروش",
        });
      }
      return {
        rows: rows.sort((a, b) => b.date - a.date),
        totals: {
          base: rows.reduce((sum, row) => sum + row.base, 0),
          tax: rows.reduce((sum, row) => sum + row.tax, 0),
          total: rows.reduce((sum, row) => sum + row.total, 0),
        },
      };
    }
    if (args.kind === "purchase-tax") {
      const invoices = await ctx.db
        .query("purchaseInvoices")
        .withIndex("by_business_date", (q) =>
          q
            .eq("businessId", args.businessId)
            .gte("issueDate", from)
            .lte("issueDate", to),
        )
        .take(5000);
      const rows = invoices
        .filter(
          (row) =>
            row.status !== "draft" &&
            row.status !== "cancelled" &&
            (!args.branchId || row.branchId === args.branchId),
        )
        .map((row) => ({
          number: row.number,
          date: row.issueDate,
          base:
            row.kind === "return"
              ? -row.subtotal
              : row.subtotal - row.discount + row.extraCosts,
          tax: row.kind === "return" ? -row.taxAmount : row.taxAmount,
          total: row.kind === "return" ? -row.total : row.total,
          kind: row.kind === "purchase" ? "خرید" : "برگشت خرید",
        }));
      return {
        rows: rows.sort((a, b) => b.date - a.date),
        totals: {
          base: rows.reduce((sum, row) => sum + row.base, 0),
          tax: rows.reduce((sum, row) => sum + row.tax, 0),
          total: rows.reduce((sum, row) => sum + row.total, 0),
        },
      };
    }
    if (args.kind === "payroll-tax") {
      const periods = await ctx.db
        .query("payrollPeriods")
        .withIndex("by_business", (q) =>
          q.eq("businessId", args.businessId),
        )
        .collect();
      const rows = periods
        .filter(
          (row) =>
            (row.status === "approved" || row.status === "paid") &&
            row.startAt >= from &&
            row.endAt <= to,
        )
        .map((row) => ({
          title: row.title,
          startAt: row.startAt,
          endAt: row.endAt,
          gross: row.grossTotal,
          tax: row.taxTotal,
          insurance:
            row.employeeInsuranceTotal + row.employerInsuranceTotal,
          net: row.netTotal,
        }));
      return {
        rows,
        totals: {
          gross: rows.reduce((sum, row) => sum + row.gross, 0),
          tax: rows.reduce((sum, row) => sum + row.tax, 0),
          insurance: rows.reduce((sum, row) => sum + row.insurance, 0),
          net: rows.reduce((sum, row) => sum + row.net, 0),
        },
      };
    }
    const periods = await ctx.db
      .query("taxPeriods")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const rows = await Promise.all(
      periods
        .filter((row) => row.endAt >= from && row.startAt <= to)
        .map(async (row) => {
          const records = await ctx.db
            .query("taxRecords")
            .withIndex("by_business_period", (q) =>
              q
                .eq("businessId", args.businessId)
                .eq("periodId", row._id),
            )
            .collect();
          return {
            title: row.title,
            startAt: row.startAt,
            dueDate: row.dueDate,
            status: row.status,
            taxableBase: records.reduce((sum, item) => sum + item.taxableBase, 0),
            tax: records.reduce((sum, item) => sum + item.taxAmount, 0),
            overdue:
              row.status !== "paid" &&
              row.status !== "closed" &&
              row.dueDate < Date.now(),
          };
        }),
    );
    return {
      rows,
      totals: {
        taxableBase: rows.reduce((sum, row) => sum + row.taxableBase, 0),
        tax: rows.reduce((sum, row) => sum + row.tax, 0),
      },
    };
  },
});
