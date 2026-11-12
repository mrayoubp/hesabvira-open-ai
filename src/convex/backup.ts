import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isManageRole, writeAudit } from "./lib/tenant";
import { latestSubscription } from "./lib/subscriptionAccess";
import {
  enforceRateLimit,
  safeErrorText,
  writeSecurityEvent,
} from "./lib/security";

const DAY = 24 * 60 * 60 * 1000;
const MAX_TABLE_ROWS = 5000;
const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
const MAX_RESTORE_BYTES = 4 * 1024 * 1024;
const BACKUP_FORMAT = "hesab-vira-business-backup";
const BACKUP_VERSION = 1;

/**
 * Every row in this list is tenant-scoped and has a `by_business` index. The
 * snapshot is stored in Convex File Storage, not in the operational tables.
 * Auth tables, memberships and monitoring internals are deliberately excluded.
 */
export const BACKUP_TABLES = [
  "branches",
  "fiscalYears",
  "customers",
  "suppliers",
  "productCategories",
  "products",
  "productPriceHistory",
  "warehouses",
  "invoices",
  "invoiceItems",
  "salesReturns",
  "salesReturnItems",
  "purchaseInvoices",
  "purchaseInvoiceItems",
  "inventoryDocuments",
  "inventoryDocumentLines",
  "inventoryTransactions",
  "inventoryCostLayers",
  "payments",
  "transactions",
  "accounts",
  "accountingDocuments",
  "accountingDocumentLines",
  "accountingAuditLogs",
  "bankAccounts",
  "cashFunds",
  "financialTransactions",
  "cashClosings",
  "receipts",
  "paymentVouchers",
  "fundTransfers",
  "receivedChecks",
  "issuedChecks",
  "checkStatusHistory",
  "incomeRecords",
  "expenseRecords",
  "organizationalUnits",
  "jobPositions",
  "employees",
  "employeeJobHistory",
  "employeeDocuments",
  "employmentContracts",
  "attendanceSettings",
  "attendanceRecords",
  "leaveRequests",
  "leaveRequestHistory",
  "missions",
  "employeeLoans",
  "loanInstallments",
  "payrollSettings",
  "payrollPeriods",
  "payrollRecords",
  "payrollComponents",
  "taxSettings",
  "taxPeriods",
  "taxRecords",
  "fixedAssets",
  "assetDepreciations",
  "assetMovements",
  "notificationReads",
  "savedReports",
  "reportHistory",
  "reportExportLogs",
  "aiConversations",
  "aiMessages",
  "financialAlerts",
  "counters",
  "auditLogs",
  "fileUploads",
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];
const BACKUP_TABLE_SET = new Set<string>(BACKUP_TABLES);

type SnapshotRow = Record<string, unknown> & { _id: string };
type BackupResult = {
  jobId: Id<"backupJobs">;
  filename: string;
  sizeBytes: number;
  checksum: string;
  rowCount: number;
  tableCount: number;
  storageId: Id<"_storage">;
};
type Snapshot = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  appVersion: string;
  business: {
    name: string;
    legalName?: string;
    currency: string;
    currencyDecimals: number;
    taxRateBps: number;
    inventoryValuationMethod?: string;
    allowNegativeStock?: boolean;
    purchaseTaxRecoverable?: boolean;
  };
  settings: Record<string, unknown> | null;
  tables: Partial<Record<BackupTable, SnapshotRow[]>>;
  counts: Record<string, number>;
  rowCount: number;
};

function checksum(text: string) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function stripDoc(row: Record<string, unknown>) {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "_creationTime") continue;
    clean[key] = value;
  }
  return clean;
}

function remapValue(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapValue(item, ids));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = remapValue(item, ids);
    }
    return result;
  }
  return value;
}

export const backupMeta = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business || business.archivedAt) {
      throw new ConvexError("کسب‌وکار برای پشتیبان‌گیری در دسترس نیست.");
    }
    const settings = await ctx.db
      .query("businessSettings")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .unique();
    return { business, settings };
  },
});

export const collectBackupTable = internalQuery({
  args: { businessId: v.id("businesses"), table: v.string() },
  handler: async (ctx, args) => {
    if (!BACKUP_TABLE_SET.has(args.table)) {
      throw new ConvexError("جدول درخواستی جزو دامنه پشتیبان نیست.");
    }
    const rows = await (ctx.db.query(args.table as any) as any)
      .withIndex("by_business", (q: any) => q.eq("businessId", args.businessId))
      .take(MAX_TABLE_ROWS + 1);
    if (rows.length > MAX_TABLE_ROWS) {
      throw new ConvexError(
        `جدول ${args.table} بیش از ${MAX_TABLE_ROWS} رکورد دارد؛ پشتیبان‌گیری محدود متوقف شد.`,
      );
    }
    return rows.map((row: Record<string, unknown>) => stripDoc(row));
  },
});

export const beginBackup = internalMutation({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
    trigger: v.union(
      v.literal("manual"),
      v.literal("scheduled"),
      v.literal("pre_restore"),
    ),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("businessMembers")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", args.userId),
      )
      .unique();
    if (!membership || !isManageRole(membership.role)) {
      throw new ConvexError("دسترسی مدیریتی برای پشتیبان‌گیری مجاز نیست.");
    }
    if (args.trigger === "manual") {
      await enforceRateLimit(ctx, {
        userId: args.userId,
        businessId: args.businessId,
        action: "backup.create",
        limit: 6,
        windowMs: 60 * 60 * 1000,
      });
    }
    const now = Date.now();
    return await ctx.db.insert("backupJobs", {
      businessId: args.businessId,
      createdBy: args.userId,
      trigger: args.trigger,
      status: "running",
      filename: `hesab-vira-backup-${now}.json`,
      rowCount: 0,
      startedAt: now,
    });
  },
});

export const finishBackup = internalMutation({
  args: {
    jobId: v.id("backupJobs"),
    storageId: v.id("_storage"),
    filename: v.string(),
    sizeBytes: v.number(),
    checksum: v.string(),
    rowCount: v.number(),
    tableCounts: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new ConvexError("رکورد پشتیبان پیدا نشد.");
    await ctx.db.patch(args.jobId, {
      status: "success",
      storageId: args.storageId,
      filename: args.filename,
      sizeBytes: args.sizeBytes,
      checksum: args.checksum,
      rowCount: args.rowCount,
      tableCounts: args.tableCounts,
      completedAt: Date.now(),
      expiresAt: args.expiresAt,
    });
    return true;
  },
});

export const failBackup = internalMutation({
  args: { jobId: v.id("backupJobs"), error: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return false;
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: safeErrorText(args.error, 500),
      completedAt: Date.now(),
    });
    return true;
  },
});

async function performBackup(
  ctx: ActionCtx,
  args: {
    businessId: Id<"businesses">;
    userId: Id<"users">;
    trigger: "manual" | "scheduled" | "pre_restore";
  },
): Promise<BackupResult> {
  const meta = await ctx.runQuery(internal.backup.backupMeta, {
    businessId: args.businessId,
  });
  const jobId = await ctx.runMutation(internal.backup.beginBackup, args);
  try {
    const tables: Snapshot["tables"] = {};
    const counts: Record<string, number> = {};
    let rowCount = 0;
    for (const table of BACKUP_TABLES) {
      const rows = (await ctx.runQuery(internal.backup.collectBackupTable, {
        businessId: args.businessId,
        table,
      })) as SnapshotRow[];
      tables[table] = rows;
      counts[table] = rows.length;
      rowCount += rows.length;
    }
    const snapshot: Snapshot = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      appVersion: "1.0.0",
      business: {
        name: meta.business.name,
        legalName: meta.business.legalName,
        currency: meta.business.currency,
        currencyDecimals: meta.business.currencyDecimals,
        taxRateBps: meta.business.taxRateBps,
        inventoryValuationMethod: meta.business.inventoryValuationMethod,
        allowNegativeStock: meta.business.allowNegativeStock,
        purchaseTaxRecoverable: meta.business.purchaseTaxRecoverable,
      },
      settings: meta.settings ? stripDoc(meta.settings as any) : null,
      tables,
      counts,
      rowCount,
    };
    const json = JSON.stringify(snapshot);
    const sizeBytes = new TextEncoder().encode(json).byteLength;
    if (sizeBytes > MAX_BACKUP_BYTES) {
      throw new ConvexError(
        `حجم پشتیبان ${Math.ceil(sizeBytes / 1024 / 1024)} مگابایت است و از سقف امن ${MAX_BACKUP_BYTES / 1024 / 1024} مگابایت بیشتر می‌شود.`,
      );
    }
    const hash = checksum(json);
    const storageId = await ctx.storage.store(
      new Blob([json], { type: "application/json" }),
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `hesab-vira-${meta.business.slug}-${stamp}.json`;
    const retentionDays =
      meta.settings?.backupRetentionDays ?? 30;
    await ctx.runMutation(internal.backup.finishBackup, {
      jobId,
      storageId,
      filename,
      sizeBytes,
      checksum: hash,
      rowCount,
      tableCounts: JSON.stringify(counts),
      expiresAt: Date.now() + retentionDays * DAY,
    });
    await ctx.runMutation(internal.backup.recordBackupEvent, {
      businessId: args.businessId,
      userId: args.userId,
      action: "backup.create",
      detail: `${filename} · ${rowCount} رکورد`,
    });

    const expired = await ctx.runQuery(internal.backup.expiredBackupArtifacts, {
      businessId: args.businessId,
    });
    for (const item of expired) {
      if (!item.storageId) continue;
      try {
        await ctx.storage.delete(item.storageId);
        await ctx.runMutation(internal.backup.markPruned, {
          jobId: item._id,
        });
      } catch {
        // A blob may already be gone; the job is still aged out and can be
        // retained for audit without breaking this backup.
      }
    }

    return {
      jobId,
      filename,
      sizeBytes,
      checksum: hash,
      rowCount,
      tableCount: BACKUP_TABLES.length,
      storageId,
    };
  } catch (error) {
    await ctx.runMutation(internal.backup.failBackup, {
      jobId,
      error: safeErrorText(error, 500),
    });
    await ctx.runMutation(internal.system.logServerError, {
      businessId: args.businessId,
      userId: args.userId,
      message: safeErrorText(error),
      route: "backup.create",
    });
    throw new ConvexError(safeErrorText(error, 500) || "پشتیبان‌گیری انجام نشد.");
  }
}

export const create = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<BackupResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای پشتیبان‌گیری باید وارد شوید.");
    await ctx.runQuery(internal.system.authorizeManage, {
      businessId: args.businessId,
      userId,
    });
    return await performBackup(ctx, {
      businessId: args.businessId,
      userId,
      trigger: "manual",
    });
  },
});

export const recordBackupEvent = internalMutation({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
    action: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: args.userId,
      action: args.action,
      entity: "backupJobs",
      entityId: args.businessId,
      summary: args.detail,
    });
    await writeSecurityEvent(ctx, {
      userId: args.userId,
      businessId: args.businessId,
      action: args.action,
      detail: args.detail,
    });
  },
});

export const expiredBackupArtifacts = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const cutoff = Date.now();
    const rows = await ctx.db
      .query("backupJobs")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(1000);
    return rows.filter(
      (row) =>
        row.status === "success" &&
        row.storageId &&
        !row.prunedAt &&
        (row.expiresAt ?? 0) < cutoff,
    );
  },
});

export const markPruned = internalMutation({
  args: { jobId: v.id("backupJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return false;
    await ctx.db.patch(args.jobId, {
      prunedAt: Date.now(),
      storageId: undefined,
    });
    return true;
  },
});

export const list = query({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای مشاهده پشتیبان‌ها باید وارد شوید.");
    const membership = await ctx.db
      .query("businessMembers")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", userId),
      )
      .unique();
    if (!membership || !isManageRole(membership.role)) {
      throw new ConvexError("دسترسی مدیریتی به پشتیبان‌ها مجاز نیست.");
    }
    const limit = Math.min(100, Math.max(1, Math.round(args.limit ?? 50)));
    const rows = await ctx.db
      .query("backupJobs")
      .withIndex("by_business_created", (q) =>
        q.eq("businessId", args.businessId),
      )
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      ...row,
      storageId: row.storageId ? String(row.storageId) : null,
      downloadReady: Boolean(row.status === "success" && row.storageId),
    }));
  },
});

export const getDownloadUrl = mutation({
  args: { businessId: v.id("businesses"), jobId: v.id("backupJobs") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای دانلود پشتیبان باید وارد شوید.");
    const membership = await ctx.db
      .query("businessMembers")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", userId),
      )
      .unique();
    if (!membership || !isManageRole(membership.role)) {
      throw new ConvexError("دانلود پشتیبان فقط برای مدیر کسب‌وکار مجاز است.");
    }
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.businessId !== args.businessId ||
      job.status !== "success" ||
      !job.storageId ||
      job.prunedAt
    ) {
      throw new ConvexError("نسخه پشتیبان قابل دانلود نیست.");
    }
    const url = await ctx.storage.getUrl(job.storageId);
    if (!url) throw new ConvexError("فایل پشتیبان در فضای ذخیره‌سازی پیدا نشد.");
    await ctx.db.insert("securityEvents", {
      userId,
      businessId: args.businessId,
      action: "backup.download",
      result: "success",
      detail: job.filename,
      createdAt: Date.now(),
    });
    return { url, filename: job.filename, checksum: job.checksum ?? null };
  },
});

export const getJob = internalQuery({
  args: {
    businessId: v.id("businesses"),
    jobId: v.id("backupJobs"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("businessMembers")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", args.userId),
      )
      .unique();
    if (!membership || !isManageRole(membership.role)) {
      throw new ConvexError("این نسخه پشتیبان در دسترس شما نیست.");
    }
    const job = await ctx.db.get(args.jobId);
    if (!job || job.businessId !== args.businessId) {
      throw new ConvexError("نسخه پشتیبان در این کسب‌وکار یافت نشد.");
    }
    return job;
  },
});

async function readSnapshot(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
): Promise<{ snapshot: Snapshot; json: string; hash: string }> {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new ConvexError("فایل پشتیبان در فضای ذخیره‌سازی پیدا نشد.");
  if (blob.size > MAX_RESTORE_BYTES) {
    throw new ConvexError("حجم فایل پشتیبان از سقف بازیابی این نسخه بیشتر است.");
  }
  const json = await blob.text();
  if (new TextEncoder().encode(json).byteLength > MAX_RESTORE_BYTES) {
    throw new ConvexError("حجم فایل پشتیبان از سقف بازیابی این نسخه بیشتر است.");
  }
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(json) as Snapshot;
  } catch {
    throw new ConvexError("فایل پشتیبان JSON معتبر نیست.");
  }
  if (
    snapshot.format !== BACKUP_FORMAT ||
    snapshot.version !== BACKUP_VERSION ||
    !snapshot.tables ||
    !snapshot.business
  ) {
    throw new ConvexError("ساختار یا نسخه فایل پشتیبان پشتیبانی نمی‌شود.");
  }
  return { snapshot, json, hash: checksum(json) };
}

export const verify = action({
  args: { businessId: v.id("businesses"), jobId: v.id("backupJobs") },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    checksumMatches: boolean;
    countsMatch: boolean;
    expectedChecksum: string | null;
    actualChecksum: string;
    rowCount: number;
    expectedRowCount: number;
    tableCount: number;
    exportedAt: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای بررسی پشتیبان باید وارد شوید.");
    const job = await ctx.runQuery(internal.backup.getJob, {
      businessId: args.businessId,
      jobId: args.jobId,
      userId,
    });
    if (job.status !== "success" || !job.storageId) {
      throw new ConvexError("این نسخه پشتیبان کامل یا قابل خواندن نیست.");
    }
    const { snapshot, hash } = await readSnapshot(ctx, job.storageId);
    const checksumMatches = !job.checksum || hash === job.checksum;
    const rows = Object.values(snapshot.tables).reduce(
      (sum, rowsForTable) => sum + (rowsForTable?.length ?? 0),
      0,
    );
    const countsMatch = rows === snapshot.rowCount;
    return {
      ok: checksumMatches && countsMatch,
      checksumMatches,
      countsMatch,
      expectedChecksum: job.checksum ?? null,
      actualChecksum: hash,
      rowCount: rows,
      expectedRowCount: snapshot.rowCount,
      tableCount: Object.keys(snapshot.tables).length,
      exportedAt: snapshot.exportedAt,
    };
  },
});

function tablesWithoutUndefined(tables: Snapshot["tables"]) {
  const result: Partial<Record<BackupTable, SnapshotRow[]>> = {};
  for (const table of BACKUP_TABLES) {
    const rows = tables[table];
    if (rows !== undefined) result[table] = rows;
  }
  return result;
}

export const restoreIntoNewBusiness = internalMutation({
  args: {
    businessId: v.id("businesses"),
    userId: v.id("users"),
    snapshot: v.string(),
    sourceJobId: v.id("backupJobs"),
  },
  handler: async (ctx, args) => {
    if (new TextEncoder().encode(args.snapshot).byteLength > MAX_RESTORE_BYTES) {
      throw new ConvexError("حجم داده بازیابی از سقف امن بیشتر است.");
    }
    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(args.snapshot) as Snapshot;
    } catch {
      throw new ConvexError("داده پشتیبان قابل خواندن نیست.");
    }
    if (
      snapshot.format !== BACKUP_FORMAT ||
      snapshot.version !== BACKUP_VERSION ||
      !snapshot.tables ||
      !snapshot.business
    ) {
      throw new ConvexError("ساختار پشتیبان معتبر نیست.");
    }
    const snapshotTables = tablesWithoutUndefined(snapshot.tables);
    const sourceJob = await ctx.db.get(args.sourceJobId);
    if (
      !sourceJob ||
      sourceJob.businessId !== args.businessId ||
      sourceJob.status !== "success"
    ) {
      throw new ConvexError("نسخه مبدأ بازیابی معتبر نیست.");
    }
    const sourceBusiness = await ctx.db.get(args.businessId);
    if (!sourceBusiness) throw new ConvexError("کسب‌وکار مبدأ پیدا نشد.");
    const membership = await ctx.db
      .query("businessMembers")
      .withIndex("by_business_user", (q) =>
        q.eq("businessId", args.businessId).eq("userId", args.userId),
      )
      .unique();
    if (!membership || !isManageRole(membership.role)) {
      throw new ConvexError("بازیابی فقط برای مدیر کسب‌وکار مجاز است.");
    }
    if (
      !(snapshotTables.branches?.length) ||
      !(snapshotTables.fiscalYears?.length) ||
      !(snapshotTables.accounts?.length)
    ) {
      throw new ConvexError(
        "پشتیبان فاقد شعبه، دوره مالی یا کدینگ حساب است و بازیابی امن نیست.",
      );
    }

    const now = Date.now();
    const newBusinessId = await ctx.db.insert("businesses", {
      name: `${snapshot.business.name} — بازیابی ${new Date(now).toLocaleDateString("fa-IR")}`.slice(0, 120),
      slug: `restore-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      legalName: snapshot.business.legalName,
      currency: snapshot.business.currency || sourceBusiness.currency,
      currencyDecimals:
        snapshot.business.currencyDecimals ?? sourceBusiness.currencyDecimals,
      taxRateBps: snapshot.business.taxRateBps ?? sourceBusiness.taxRateBps,
      inventoryValuationMethod:
        snapshot.business.inventoryValuationMethod as any,
      allowNegativeStock: snapshot.business.allowNegativeStock,
      purchaseTaxRecoverable: snapshot.business.purchaseTaxRecoverable,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
      // A restored workspace must never become a free legacy workspace. It is
      // readable immediately, but writing waits for a real subscription.
      subscriptionRequired: true,
    });

    // Keep the source plan as a pending subscription so the owner can activate
    // the restored workspace from the normal subscription page. No payment is
    // fabricated and no free period is granted.
    const sourceSubscription = await latestSubscription(ctx, args.businessId);
    let restorePlan = sourceSubscription
      ? await ctx.db.get(sourceSubscription.planId)
      : null;
    if (!restorePlan || !restorePlan.active) {
      const activePlans = await ctx.db
        .query("plans")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
      restorePlan =
        activePlans.sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
    }
    if (restorePlan) {
      const restoreSubscriptionId = await ctx.db.insert("subscriptions", {
        businessId: newBusinessId,
        planId: restorePlan._id,
        planCode: restorePlan.code,
        planName: restorePlan.name,
        durationMonths: restorePlan.durationMonths,
        priceToman: restorePlan.priceToman,
        status: "pending_payment",
        paymentStatus: "unpaid",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("subscriptionEvents", {
        businessId: newBusinessId,
        subscriptionId: restoreSubscriptionId,
        type: "created",
        amountToman: restorePlan.priceToman,
        actorId: args.userId,
        reason: "فضای بازیابی‌شده؛ فعال‌سازی پس از پرداخت اشتراک",
        createdAt: now,
      });
    }

    await ctx.db.insert("businessMembers", {
      businessId: newBusinessId,
      userId: args.userId,
      role: "owner",
      displayName: membership.displayName,
      createdAt: now,
      updatedAt: now,
    });

    if (snapshot.settings) {
      const settings = stripDoc(snapshot.settings);
      const { _id: _settingsId, businessId: _oldBusinessId, ...settingsFields } =
        settings;
      void _settingsId;
      void _oldBusinessId;
      await ctx.db.insert("businessSettings", {
        ...(settingsFields as any),
        businessId: newBusinessId,
        updatedBy: args.userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const idMap = new Map<string, string>();
    const inserted: { table: BackupTable; id: string }[] = [];
    for (const table of BACKUP_TABLES) {
      const rows = snapshotTables[table] ?? [];
      for (const row of rows) {
        if (!row._id || typeof row._id !== "string") {
          throw new ConvexError(`ردیف فاقد شناسه در جدول ${table} است.`);
        }
        const fields = stripDoc(row);
        delete fields._id;
        fields.businessId = newBusinessId;
        const newId = await (ctx.db.insert(table as any, fields as any) as any);
        idMap.set(row._id, newId as string);
        inserted.push({ table, id: newId as string });
      }
    }

    for (const item of inserted) {
      const doc = await (ctx.db.get(item.id as any) as any);
      if (!doc) continue;
      const { _id: _docId, _creationTime: _ct, ...fields } = doc;
      void _docId;
      void _ct;
      await (ctx.db.patch(item.id as any, remapValue(fields, idMap) as any));
    }

    await ctx.db.patch(args.sourceJobId, {
      restoredAt: now,
      restoredBusinessId: newBusinessId,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: args.userId,
      action: "backup.restore",
      entity: "backupJobs",
      entityId: args.sourceJobId,
      summary: `بازیابی در کسب‌وکار جدید ${newBusinessId}`,
    });
    await writeAudit(ctx, {
      businessId: newBusinessId,
      actorId: args.userId,
      action: "business.restore",
      entity: "businesses",
      entityId: newBusinessId,
      summary: "ایجاد کسب‌وکار از نسخه پشتیبان",
    });
    await writeSecurityEvent(ctx, {
      userId: args.userId,
      businessId: args.businessId,
      action: "backup.restore",
      detail: `کسب‌وکار جدید ${newBusinessId}`,
    });
    return {
      businessId: newBusinessId,
      rows: inserted.length,
      tables: BACKUP_TABLES.length,
    };
  },
});

export const restore = action({
  args: { businessId: v.id("businesses"), jobId: v.id("backupJobs") },
  handler: async (ctx, args): Promise<{
    businessId: Id<"businesses">;
    rows: number;
    tables: number;
    source: { jobId: Id<"backupJobs">; filename: string; exportedAt: number };
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("برای بازیابی باید وارد شوید.");
    await ctx.runQuery(internal.system.authorizeManage, {
      businessId: args.businessId,
      userId,
    });
    const job = await ctx.runQuery(internal.backup.getJob, {
      businessId: args.businessId,
      jobId: args.jobId,
      userId,
    });
    if (job.status !== "success" || !job.storageId) {
      throw new ConvexError("نسخه پشتیبان مبدأ قابل بازیابی نیست.");
    }
    const { snapshot, json, hash } = await readSnapshot(ctx, job.storageId);
    if (job.checksum && hash !== job.checksum) {
      throw new ConvexError(
        "چک‌سام پشتیبان با رکورد اصلی یکسان نیست؛ بازیابی متوقف شد.",
      );
    }
    // Requirement: always create a safety snapshot before restoring. It is
    // stored as a separate job, and the original workspace is never deleted or
    // overwritten by this operation.
    await performBackup(ctx, {
      businessId: args.businessId,
      userId,
      trigger: "pre_restore",
    });
    const result = await ctx.runMutation(
      internal.backup.restoreIntoNewBusiness,
      {
        businessId: args.businessId,
        userId,
        snapshot: json,
        sourceJobId: args.jobId,
      },
    );
    return {
      ...result,
      source: {
        jobId: job._id,
        filename: job.filename,
        exportedAt: snapshot.exportedAt,
      },
    };
  },
});

export const enqueueScheduled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const settingsRows = await ctx.db.query("businessSettings").take(2000);
    const now = Date.now();
    let scheduled = 0;
    for (const setting of settingsRows) {
      if (!setting.backupEnabled) continue;
      const latest = await ctx.db
        .query("backupJobs")
        .withIndex("by_business_created", (q) =>
          q.eq("businessId", setting.businessId),
        )
        .order("desc")
        .first();
      const interval =
        setting.backupFrequency === "weekly"
          ? 7 * DAY
          : setting.backupFrequency === "monthly"
            ? 30 * DAY
            : DAY;
      if (latest && now - latest.startedAt < interval) continue;
      await ctx.scheduler.runAfter(0, internal.backup.runScheduled, {
        businessId: setting.businessId,
      });
      scheduled += 1;
    }
    return { scheduled };
  },
});

export const runScheduled = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args,
  ): Promise<BackupResult | { skipped: true }> => {
    const meta = await ctx.runQuery(internal.backup.backupMeta, {
      businessId: args.businessId,
    });
    if (meta.settings?.backupEnabled === false) {
      return { skipped: true as const };
    }
    const userId = meta.settings?.updatedBy ?? meta.business.createdBy;
    await ctx.runQuery(internal.system.authorizeManage, {
      businessId: args.businessId,
      userId,
    });
    return await performBackup(ctx, {
      businessId: args.businessId,
      userId,
      trigger: "scheduled",
    });
  },
});
