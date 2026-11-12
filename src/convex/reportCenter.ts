import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMembership, writeAudit } from "./lib/tenant";
import { permissionsFor } from "./lib/hr";
import { getFiscalYear } from "./lib/accounting";
import { reportDefinition } from "./lib/reportCatalog";
import {
  CUSTOM_MODULE_MAP,
  CUSTOM_MODULES,
  parseCustomConfig,
  runCustomReport,
} from "./lib/customReport";

const formatValidator = v.union(
  v.literal("xlsx"),
  v.literal("pdf"),
  v.literal("print"),
);

export const workspace = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const [saved, recent, exports] = await Promise.all([
      ctx.db
        .query("savedReports")
        .withIndex("by_business_user_created", (q) =>
          q.eq("businessId", args.businessId).eq("createdBy", user._id),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("reportHistory")
        .withIndex("by_business_user_created", (q) =>
          q.eq("businessId", args.businessId).eq("userId", user._id),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("reportExportLogs")
        .withIndex("by_business_user_created", (q) =>
          q.eq("businessId", args.businessId).eq("userId", user._id),
        )
        .order("desc")
        .take(15),
    ]);
    return {
      saved: saved
        .filter((row) => !row.archivedAt)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
      recent,
      exports,
    };
  },
});

export const saved = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("savedReports")
      .withIndex("by_business_user_created", (q) =>
        q.eq("businessId", args.businessId).eq("createdBy", user._id),
      )
      .order("desc")
      .take(100);
    return rows.filter((row) => !row.archivedAt);
  },
});

export const recent = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    return await ctx.db
      .query("reportHistory")
      .withIndex("by_business_user_created", (q) =>
        q.eq("businessId", args.businessId).eq("userId", user._id),
      )
      .order("desc")
      .take(20);
  },
});

export const customModules = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { membership } = await requireMembership(ctx, args.businessId);
    const granted = permissionsFor(membership);
    return CUSTOM_MODULES.map((module) => ({
      ...module,
      available:
        module.permission === "general" ||
        module.permission === "financial" ||
        (module.permission === "hr" && granted.includes("hr.view")) ||
        (module.permission === "payroll" && granted.includes("payroll.view")) ||
        (module.permission === "tax" && granted.includes("tax.view")) ||
        (module.permission === "assets" && granted.includes("assets.view")),
    })).filter((module) => module.available);
  },
});

export const saveReport = mutation({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.optional(v.string()),
    reportKey: v.string(),
    module: v.string(),
    config: v.string(),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireMembership(ctx, args.businessId);
    const title = args.title.trim();
    if (title.length < 2 || title.length > 100) {
      throw new ConvexError("عنوان گزارش باید بین ۲ تا ۱۰۰ نویسه باشد.");
    }
    if (args.config.length > 20_000) {
      throw new ConvexError("قالب گزارش بیش از حد بزرگ است.");
    }
    if (args.reportKey === "custom") {
      const config = parseCustomConfig(args.config);
      const module = CUSTOM_MODULE_MAP.get(config.module);
      if (!module) throw new ConvexError("ماژول گزارش مجاز نیست.");
      const granted = permissionsFor(membership);
      if (module.permission === "payroll" && !granted.includes("payroll.view")) {
        throw new ConvexError("مجوز ذخیره گزارش حقوق را ندارید.");
      }
      if (module.permission === "tax" && !granted.includes("tax.view")) {
        throw new ConvexError("مجوز ذخیره گزارش مالیاتی را ندارید.");
      }
      if (module.permission === "assets" && !granted.includes("assets.view")) {
        throw new ConvexError("مجوز ذخیره گزارش دارایی را ندارید.");
      }
      if (module.permission === "hr" && !granted.includes("hr.view")) {
        throw new ConvexError("مجوز ذخیره گزارش پرسنلی را ندارید.");
      }
      const fieldMap = new Map(module.fields.map((field) => [field.key, field]));
      if (
        membership.role === "viewer" &&
        (module.permission === "financial" ||
          config.fields.some((field) => fieldMap.get(field)?.sensitive))
      ) {
        throw new ConvexError("این قالب برای نقش شما مجاز نیست.");
      }
    } else {
      const definition = reportDefinition(args.reportKey);
      if (!definition || definition.mode !== "run") {
        throw new ConvexError("گزارش انتخاب‌شده قابل ذخیره نیست.");
      }
    }
    const existing = await ctx.db
      .query("savedReports")
      .withIndex("by_business_user_created", (q) =>
        q.eq("businessId", args.businessId).eq("createdBy", user._id),
      )
      .take(200);
    if (existing.filter((row) => !row.archivedAt).length >= 100) {
      throw new ConvexError("حداکثر ۱۰۰ گزارش ذخیره‌شده مجاز است.");
    }
    const now = Date.now();
    const savedReportId = await ctx.db.insert("savedReports", {
      businessId: args.businessId,
      createdBy: user._id,
      title,
      description: args.description?.trim().slice(0, 300),
      reportKey: args.reportKey,
      module: args.module,
      config: args.config,
      pinned: args.pinned ?? false,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "report.saved",
      entity: "savedReports",
      entityId: savedReportId,
      summary: title,
    });
    return { savedReportId };
  },
});

export const togglePin = mutation({
  args: {
    businessId: v.id("businesses"),
    savedReportId: v.id("savedReports"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const row = await ctx.db.get(args.savedReportId);
    if (!row || row.businessId !== args.businessId || row.createdBy !== user._id) {
      throw new ConvexError("گزارش ذخیره‌شده یافت نشد.");
    }
    await ctx.db.patch(row._id, { pinned: !row.pinned, updatedAt: Date.now() });
    return { pinned: !row.pinned };
  },
});

export const archiveReport = mutation({
  args: {
    businessId: v.id("businesses"),
    savedReportId: v.id("savedReports"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const row = await ctx.db.get(args.savedReportId);
    if (!row || row.businessId !== args.businessId || row.createdBy !== user._id) {
      throw new ConvexError("گزارش ذخیره‌شده یافت نشد.");
    }
    await ctx.db.patch(row._id, { archivedAt: Date.now(), updatedAt: Date.now() });
    return { archived: true };
  },
});

export const recordView = mutation({
  args: {
    businessId: v.id("businesses"),
    reportKey: v.string(),
    title: v.string(),
    category: v.string(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    branchId: v.optional(v.id("branches")),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    filters: v.optional(v.string()),
    rowCount: v.number(),
    savedReportId: v.optional(v.id("savedReports")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const historyId = await ctx.db.insert("reportHistory", {
      businessId: args.businessId,
      userId: user._id,
      reportKey: args.reportKey,
      title: args.title.slice(0, 180),
      category: args.category,
      from: args.from,
      to: args.to,
      branchId: args.branchId,
      fiscalYearId: args.fiscalYearId,
      filters: args.filters?.slice(0, 3000),
      rowCount: Math.max(0, Math.round(args.rowCount)),
      createdAt: Date.now(),
    });
    const recent = await ctx.db
      .query("reportHistory")
      .withIndex("by_business_user_created", (q) =>
        q.eq("businessId", args.businessId).eq("userId", user._id),
      )
      .order("desc")
      .take(500);
    const excess = recent.slice(200);
    for (const row of excess) await ctx.db.delete(row._id);
    if (args.savedReportId) {
      const saved = await ctx.db.get(args.savedReportId);
      if (saved && saved.businessId === args.businessId && saved.createdBy === user._id) {
        await ctx.db.patch(saved._id, {
          runCount: saved.runCount + 1,
          lastRunAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    return { historyId };
  },
});

export const logExport = mutation({
  args: {
    businessId: v.id("businesses"),
    reportKey: v.string(),
    title: v.string(),
    format: formatValidator,
    rowCount: v.number(),
    filters: v.optional(v.string()),
    status: v.union(v.literal("success"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    const exportId = await ctx.db.insert("reportExportLogs", {
      businessId: args.businessId,
      userId: user._id,
      reportKey: args.reportKey,
      title: args.title.slice(0, 180),
      format: args.format,
      rowCount: Math.max(0, Math.round(args.rowCount)),
      filters: args.filters?.slice(0, 3000),
      status: args.status,
      error: args.error?.slice(0, 500),
      createdAt: Date.now(),
    });
    return { exportId };
  },
});

export const runCustom = query({
  args: {
    businessId: v.id("businesses"),
    fiscalYearId: v.optional(v.id("fiscalYears")),
    branchId: v.optional(v.id("branches")),
    config: v.string(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireMembership(ctx, args.businessId);
    let fiscalYearId = args.fiscalYearId;
    if (fiscalYearId) {
      await getFiscalYear(ctx, args.businessId, fiscalYearId);
    } else {
      const years = await ctx.db
        .query("fiscalYears")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(50);
      if (years.length === 0) throw new ConvexError("دوره مالی یافت نشد.");
      const now = Date.now();
      const current = years.find((year) => year.startAt <= now && year.endAt >= now);
      fiscalYearId = (current ?? years.sort((a, b) => b.startAt - a.startAt)[0])._id;
    }
    const fiscalYear = await ctx.db.get(fiscalYearId);
    if (!fiscalYear) throw new ConvexError("دوره مالی یافت نشد.");
    const from = args.from ?? fiscalYear.startAt;
    const to = args.to ?? fiscalYear.endAt;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      throw new ConvexError("بازه تاریخ معتبر نیست.");
    }
    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== args.businessId) {
        throw new ConvexError("شعبه انتخاب‌شده یافت نشد.");
      }
    }
    return await runCustomReport(ctx, {
      businessId: args.businessId,
      fiscalYearId,
      userId: user._id,
      membership,
      configValue: args.config,
      from,
      to,
      branchId: args.branchId,
      search: args.search,
    });
  },
});

export const dismissAlert = mutation({
  args: {
    businessId: v.id("businesses"),
    alertKey: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    category: v.string(),
    title: v.string(),
    reason: v.string(),
    evidence: v.string(),
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId);
    if (args.alertKey.length < 3 || args.alertKey.length > 200) {
      throw new ConvexError("شناسه هشدار معتبر نیست.");
    }
    const existing = await ctx.db
      .query("financialAlerts")
      .withIndex("by_business_user_key", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("userId", user._id)
          .eq("alertKey", args.alertKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { dismissedAt: Date.now() });
      return { dismissed: true };
    }
    await ctx.db.insert("financialAlerts", {
      businessId: args.businessId,
      userId: user._id,
      alertKey: args.alertKey,
      severity: args.severity,
      category: args.category,
      title: args.title.slice(0, 180),
      reason: args.reason.slice(0, 800),
      evidence: args.evidence.slice(0, 1200),
      from: args.from,
      to: args.to,
      branchId: args.branchId,
      dismissedAt: Date.now(),
      createdAt: Date.now(),
    });
    return { dismissed: true };
  },
});

export type SavedReportView = {
  _id: Id<"savedReports">;
  title: string;
};
