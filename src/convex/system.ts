import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  isManageRole,
  requireMembership,
  requireUser,
  writeAudit,
} from "./lib/tenant";
import {
  APP_PHASE,
  APP_VERSION,
  enforceRateLimit,
  logSystemError,
  safeErrorText,
  writeSecurityEvent,
} from "./lib/security";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

type Ctx = QueryCtx | MutationCtx;
type HealthState = "healthy" | "warning" | "critical" | "unknown";

const DEFAULT_SETTINGS = {
  calendar: "jalali" as const,
  timezone: "Asia/Tehran",
  printOrientation: "landscape" as const,
  notificationsEnabled: true,
  lowStockAlerts: true,
  backupEnabled: true,
  backupFrequency: "daily" as const,
  backupHourUtc: 1,
  backupRetentionDays: 30,
};

async function settingsFor(ctx: Ctx, businessId: Id<"businesses">) {
  return await ctx.db
    .query("businessSettings")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
}

function nextBackupAt(
  settings: {
    backupEnabled: boolean;
    backupFrequency: "daily" | "weekly" | "monthly";
    backupHourUtc: number;
  },
  from: number,
) {
  if (!settings.backupEnabled) return null;
  const date = new Date(from);
  date.setUTCHours(settings.backupHourUtc, 0, 0, 0);
  if (date.getTime() <= from) date.setUTCDate(date.getUTCDate() + 1);
  if (settings.backupFrequency === "weekly") {
    const delta = (8 - date.getUTCDay()) % 7;
    date.setUTCDate(date.getUTCDate() + delta);
  } else if (settings.backupFrequency === "monthly") {
    date.setUTCMonth(date.getUTCMonth() + 1, 1);
  }
  return date.getTime();
}

function aiStatus() {
  const disabled = process.env.AI_DISABLED === "true";
  const connected = Boolean(process.env.ZAI_API_KEY) && !disabled;
  return {
    connected,
    mode: disabled ? "disabled" : connected ? "external" : "local",
    model: connected ? process.env.ZAI_MODEL || "glm-4.5-flash" : null,
  };
}

function overallStatus(checks: { status: HealthState }[]) {
  if (checks.some((check) => check.status === "critical")) return "unhealthy";
  if (checks.some((check) => check.status === "warning" || check.status === "unknown")) {
    return "degraded";
  }
  return "healthy";
}

export const settings = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { business } = await requireMembership(ctx, args.businessId, {
      manage: true,
    });
    const saved = await settingsFor(ctx, args.businessId);
    return {
      businessId: args.businessId,
      businessName: saved?.displayName || business.name,
      legalName: saved?.legalName ?? business.legalName ?? "",
      logoStorageId: saved?.logoStorageId ? String(saved.logoStorageId) : null,
      logoUrl: saved?.logoStorageId
        ? await ctx.storage.getUrl(saved.logoStorageId)
        : null,
      currency: business.currency,
      currencyDecimals: business.currencyDecimals,
      taxRateBps: business.taxRateBps,
      calendar: saved?.calendar ?? DEFAULT_SETTINGS.calendar,
      timezone: saved?.timezone ?? DEFAULT_SETTINGS.timezone,
      invoiceFooter: saved?.invoiceFooter ?? "",
      printOrientation:
        saved?.printOrientation ?? DEFAULT_SETTINGS.printOrientation,
      notificationsEnabled:
        saved?.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled,
      lowStockAlerts: saved?.lowStockAlerts ?? DEFAULT_SETTINGS.lowStockAlerts,
      backupEnabled: saved?.backupEnabled ?? DEFAULT_SETTINGS.backupEnabled,
      backupFrequency:
        saved?.backupFrequency ?? DEFAULT_SETTINGS.backupFrequency,
      backupHourUtc: saved?.backupHourUtc ?? DEFAULT_SETTINGS.backupHourUtc,
      backupRetentionDays:
        saved?.backupRetentionDays ?? DEFAULT_SETTINGS.backupRetentionDays,
      updatedAt: saved?.updatedAt ?? null,
    };
  },
});

export const updateSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    displayName: v.string(),
    legalName: v.optional(v.string()),
    calendar: v.union(v.literal("jalali"), v.literal("gregorian")),
    timezone: v.string(),
    invoiceFooter: v.optional(v.string()),
    printOrientation: v.union(v.literal("portrait"), v.literal("landscape")),
    notificationsEnabled: v.boolean(),
    lowStockAlerts: v.boolean(),
    backupEnabled: v.boolean(),
    backupFrequency: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
    ),
    backupHourUtc: v.number(),
    backupRetentionDays: v.number(),
    logoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      manage: true,
    });
    const displayName = args.displayName.trim();
    if (displayName.length < 2 || displayName.length > 120) {
      throw new ConvexError("نام نمایشی باید بین ۲ تا ۱۲۰ نویسه باشد.");
    }
    const legalName = args.legalName?.trim().slice(0, 160) || undefined;
    const timezone = args.timezone.trim().slice(0, 80);
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timezone)) {
      throw new ConvexError("منطقه زمانی معتبر نیست.");
    }
    const backupHourUtc = Math.round(args.backupHourUtc);
    if (!Number.isInteger(backupHourUtc) || backupHourUtc < 0 || backupHourUtc > 23) {
      throw new ConvexError("ساعت پشتیبان‌گیری باید بین ۰ تا ۲۳ باشد.");
    }
    const backupRetentionDays = Math.round(args.backupRetentionDays);
    if (
      !Number.isInteger(backupRetentionDays) ||
      backupRetentionDays < 1 ||
      backupRetentionDays > 365
    ) {
      throw new ConvexError("نگهداری پشتیبان باید بین ۱ تا ۳۶۵ روز باشد.");
    }
    if (args.logoStorageId) {
      const logo = await ctx.db
        .query("fileUploads")
        .withIndex("by_storage", (q) => q.eq("storageId", args.logoStorageId as Id<"_storage">))
        .unique();
      if (!logo || logo.businessId !== args.businessId) {
        throw new ConvexError("لوگو باید ابتدا در همین کسب‌وکار آپلود شود.");
      }
    }
    const now = Date.now();
    const existing = await settingsFor(ctx, args.businessId);
    const values = {
      businessId: args.businessId,
      displayName,
      legalName,
      logoStorageId: args.logoStorageId,
      calendar: args.calendar,
      timezone,
      invoiceFooter: args.invoiceFooter?.trim().slice(0, 300) || undefined,
      printOrientation: args.printOrientation,
      notificationsEnabled: args.notificationsEnabled,
      lowStockAlerts: args.lowStockAlerts,
      backupEnabled: args.backupEnabled,
      backupFrequency: args.backupFrequency,
      backupHourUtc,
      backupRetentionDays,
      updatedBy: user._id,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
    } else {
      await ctx.db.insert("businessSettings", {
        ...values,
        createdAt: now,
      });
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "settings.update",
      entity: "businessSettings",
      entityId: existing?._id ?? args.businessId,
      summary: "به‌روزرسانی تنظیمات کسب‌وکار و پشتیبان‌گیری",
    });
    return true;
  },
});

export const health = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      manage: true,
    });
    const started = Date.now();
    await ctx.db.get(user._id);
    const latencyMs = Math.max(0, Date.now() - started);
    const [savedSettings, latestCheck, latestBackup, latestUpload] =
      await Promise.all([
        settingsFor(ctx, args.businessId),
        ctx.db
          .query("healthChecks")
          .withIndex("by_business_created", (q) =>
            q.eq("businessId", args.businessId),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("backupJobs")
          .withIndex("by_business_created", (q) =>
            q.eq("businessId", args.businessId),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("fileUploads")
          .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
          .order("desc")
          .first(),
      ]);

    const storageMetadata = latestBackup?.storageId
      ? await ctx.storage.getMetadata(latestBackup.storageId)
      : latestUpload
        ? await ctx.storage.getMetadata(latestUpload.storageId)
        : null;
    const ai = aiStatus();
    const now = Date.now();
    const backupDue = nextBackupAt(
      savedSettings ?? DEFAULT_SETTINGS,
      latestBackup?.completedAt ?? now,
    );
    const backupStale =
      savedSettings?.backupEnabled !== false &&
      (!latestBackup || now - (latestBackup.completedAt ?? latestBackup.startedAt) > 2 * DAY);
    const checks: {
      key: string;
      label: string;
      status: HealthState;
      detail: string;
      latencyMs?: number;
    }[] = [
      {
        key: "database",
        label: "دیتابیس Convex",
        status: latencyMs < 1000 ? "healthy" : "warning",
        detail: `خواندن واقعی کاربر در ${latencyMs} میلی‌ثانیه`,
        latencyMs,
      },
      {
        key: "backend",
        label: "Backend و API",
        status: "healthy",
        detail: `نسخه ${APP_VERSION} · ${APP_PHASE}`,
      },
      {
        key: "storage",
        label: "فضای ذخیره‌سازی فایل",
        status: storageMetadata ? "healthy" : "warning",
        detail: storageMetadata
          ? `آخرین فایل قابل خواندن است (${Math.round((storageMetadata.size ?? 0) / 1024)} کیلوبایت)`
          : "هنوز فایلی برای راستی‌آزمایی ثبت نشده است",
      },
      {
        key: "ai",
        label: "ویرا AI",
        status: ai.mode === "disabled" ? "warning" : "healthy",
        detail:
          ai.mode === "external"
            ? `اتصال Backend به ${ai.model}`
            : ai.mode === "local"
              ? "موتور محلی فعال؛ کلید خارجی تنظیم نشده است"
              : "سرویس AI با تنظیمات به‌صورت دستی غیرفعال شده است",
      },
      {
        key: "backup",
        label: "پشتیبان‌گیری",
        status:
          latestBackup?.status === "failed"
            ? "critical"
            : backupStale
              ? "warning"
              : latestBackup
                ? "healthy"
                : "warning",
        detail: latestBackup
          ? `آخرین اجرا: ${new Date(latestBackup.startedAt).toLocaleString("fa-IR")} · ${latestBackup.status}`
          : "هنوز پشتیبانی ساخته نشده است",
      },
    ];
    const counts = await Promise.all([
      ctx.db
        .query("securityEvents")
        .withIndex("by_business_created", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(500),
      ctx.db
        .query("systemErrors")
        .withIndex("by_business_created", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(200),
    ]);
    const status = overallStatus(checks);
    return {
      status,
      version: APP_VERSION,
      phase: APP_PHASE,
      checkedAt: Date.now(),
      lastCheckAt: latestCheck?.createdAt ?? null,
      lastCheckStatus: latestCheck?.status ?? null,
      latencyMs,
      checks,
      ai,
      backup: {
        enabled: savedSettings?.backupEnabled ?? DEFAULT_SETTINGS.backupEnabled,
        frequency: savedSettings?.backupFrequency ?? DEFAULT_SETTINGS.backupFrequency,
        retentionDays:
          savedSettings?.backupRetentionDays ??
          DEFAULT_SETTINGS.backupRetentionDays,
        nextRunAt: backupDue,
        latest: latestBackup
          ? {
              _id: latestBackup._id,
              status: latestBackup.status,
              startedAt: latestBackup.startedAt,
              completedAt: latestBackup.completedAt ?? null,
              sizeBytes: latestBackup.sizeBytes ?? null,
              checksum: latestBackup.checksum ?? null,
            }
          : null,
      },
      stats: {
        securityEvents: counts[0].length,
        openErrors: counts[1].filter((row) => !row.resolvedAt).length,
      },
    };
  },
});

export const authorizeManage = internalQuery({
  args: { businessId: v.id("businesses"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("businessMembers")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", args.userId),
      )
      .unique();
    const business = await ctx.db.get(args.businessId);
    if (!membership || !business || business.archivedAt) {
      throw new ConvexError("دسترسی مدیریتی به این کسب‌وکار مجاز نیست.");
    }
    if (!isManageRole(membership.role)) {
      throw new ConvexError("این عملیات فقط برای مدیر کسب‌وکار مجاز است.");
    }
    return {
      userId: args.userId,
      businessId: business._id as Id<"businesses">,
      businessName: business.name,
      role: membership.role,
    };
  },
});

export const ping = internalQuery({
  args: {},
  handler: async (ctx) => {
    const started = Date.now();
    await ctx.db.query("businesses").take(1);
    return { ok: true, latencyMs: Date.now() - started, now: Date.now() };
  },
});

export const latestBackupState = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("backupJobs")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .first();
    return latest ?? null;
  },
});

export const recordHealthCheck = internalMutation({
  args: {
    businessId: v.id("businesses"),
    checkedBy: v.id("users"),
    status: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("unhealthy"),
    ),
    checks: v.string(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("healthChecks", {
      businessId: args.businessId,
      checkedBy: args.checkedBy,
      status: args.status,
      checks: args.checks,
      latencyMs: args.latencyMs,
      version: APP_VERSION,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const runHealthCheck = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای بررسی سلامت باید وارد شوید.");
    const access = await ctx.runQuery(internal.system.authorizeManage, {
      businessId: args.businessId,
      userId,
    });
    const started = Date.now();
    const ping = await ctx.runQuery(internal.system.ping, {});
    let storageOk = false;
    let storageError = "";
    try {
      const probe = await ctx.storage.store(
        new Blob(["hesab-vira-health"], { type: "text/plain" }),
      );
      storageOk = Boolean(await ctx.storage.getMetadata(probe));
      await ctx.storage.delete(probe);
    } catch (error) {
      storageError = safeErrorText(error);
    }
    const ai = aiStatus();
    const latestBackup = await ctx.runQuery(internal.system.latestBackupState, {
      businessId: args.businessId,
    });
    const checks: {
      key: string;
      label: string;
      status: HealthState;
      detail: string;
      latencyMs?: number;
    }[] = [
      {
        key: "database",
        label: "دیتابیس Convex",
        status: ping.latencyMs < 1000 ? "healthy" : "warning",
        detail: `پینگ واقعی دیتابیس ${ping.latencyMs} میلی‌ثانیه`,
        latencyMs: ping.latencyMs,
      },
      {
        key: "backend",
        label: "Backend و API",
        status: "healthy",
        detail: `درخواست احراز‌شده با موفقیت اجرا شد · ${APP_VERSION}`,
      },
      {
        key: "storage",
        label: "فضای ذخیره‌سازی فایل",
        status: storageOk ? "healthy" : "critical",
        detail: storageOk
          ? "نوشتن، خواندن و حذف فایل آزمایشی موفق بود"
          : `آزمون ذخیره‌سازی ناموفق بود${storageError ? `: ${storageError}` : ""}`,
      },
      {
        key: "ai",
        label: "ویرا AI",
        status: ai.mode === "disabled" ? "warning" : "healthy",
        detail:
          ai.mode === "external"
            ? `سرویس خارجی از Backend تنظیم شده است (${ai.model})`
            : ai.mode === "local"
              ? "موتور محلی فعال است؛ کلید خارجی وجود ندارد"
              : "AI غیرفعال است",
      },
      {
        key: "backup",
        label: "بشتیبان‌گیری",
        status:
          latestBackup?.status === "failed"
            ? "critical"
            : latestBackup?.status === "success"
              ? "healthy"
              : "warning",
        detail: latestBackup
          ? `آخرین اجرا ${new Date(latestBackup.startedAt).toLocaleString("fa-IR")} · ${latestBackup.status}`
          : "هنوز پشتیبانی ساخته نشده است",
      },
    ];
    const status = overallStatus(checks);
    const latencyMs = Date.now() - started;
    await ctx.runMutation(internal.system.recordHealthCheck, {
      businessId: args.businessId,
      checkedBy: access.userId,
      status,
      checks: JSON.stringify(checks),
      latencyMs,
    });
    return {
      status,
      latencyMs,
      checks,
      checkedAt: Date.now(),
      version: APP_VERSION,
    };
  },
});

export const audit = query({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId, { manage: true });
    const limit = Math.min(200, Math.max(1, Math.round(args.limit ?? 100)));
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(limit);
    const actorIds = [...new Set(rows.map((row) => row.actorId))];
    const actors = await Promise.all(actorIds.map((id) => ctx.db.get(id)));
    const actorMap = new Map(
      actors.filter(Boolean).map((actor) => [
        actor!._id as string,
        actor!.name || actor!.email || "کاربر",
      ]),
    );
    return rows.map((row) => ({
      ...row,
      actorName: actorMap.get(row.actorId as string) ?? "کاربر",
    }));
  },
});

export const securityLog = query({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId, { manage: true });
    const limit = Math.min(200, Math.max(1, Math.round(args.limit ?? 100)));
    return await ctx.db
      .query("securityEvents")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(limit);
  },
});

export const errors = query({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId, { manage: true });
    const limit = Math.min(100, Math.max(1, Math.round(args.limit ?? 50)));
    return await ctx.db
      .query("systemErrors")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(limit);
  },
});

export const noteSession = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    event: v.union(v.literal("session_start"), v.literal("logout")),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.businessId) {
      await requireMembership(ctx, args.businessId);
    }
    await enforceRateLimit(ctx, {
      userId: user._id,
      businessId: args.businessId,
      action: `security.${args.event}`,
      limit: 20,
      windowMs: HOUR,
    });
    await writeSecurityEvent(ctx, {
      userId: user._id,
      businessId: args.businessId,
      action: args.event,
      result: "success",
      userAgent: args.userAgent,
    });
    return true;
  },
});

export const reportClientError = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    message: v.string(),
    route: v.optional(v.string()),
    digest: v.optional(v.string()),
    errorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.businessId) {
      await requireMembership(ctx, args.businessId);
    }
    await enforceRateLimit(ctx, {
      userId: user._id,
      businessId: args.businessId,
      action: "errors.client",
      limit: 30,
      windowMs: HOUR,
    });
    return await logSystemError(ctx, {
      businessId: args.businessId,
      userId: user._id,
      source: "client",
      message: args.message,
      route: args.route,
      digest: args.digest,
      errorId: args.errorId,
    });
  },
});

export const logServerError = internalMutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    userId: v.optional(v.id("users")),
    message: v.string(),
    route: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await logSystemError(ctx, {
      businessId: args.businessId,
      userId: args.userId,
      source: "server",
      message: args.message,
      route: args.route,
    });
  },
});

export const resolveError = mutation({
  args: {
    businessId: v.id("businesses"),
    errorId: v.id("systemErrors"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      manage: true,
    });
    const row = await ctx.db.get(args.errorId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("خطای موردنظر در این کسب‌وکار یافت نشد.");
    }
    if (!row.resolvedAt) {
      await ctx.db.patch(row._id, { resolvedAt: Date.now() });
      await writeAudit(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        action: "system.error.resolve",
        entity: "systemErrors",
        entityId: row._id,
        summary: `بستن خطای ${row.errorId}`,
      });
    }
    return true;
  },
});

export const cleanupRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 2 * DAY;
    const rows = await ctx.db.query("rateLimits").take(5000);
    let deleted = 0;
    for (const row of rows) {
      if (row.windowStart < cutoff) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

export const pruneHealthChecks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 180 * DAY;
    const rows = await ctx.db.query("healthChecks").take(5000);
    let deleted = 0;
    for (const row of rows) {
      if (row.createdAt < cutoff) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});
