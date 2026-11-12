import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  assetMovementTypeValidator,
  assetStatusValidator,
  depreciationMethodValidator,
} from "./schema";
import { nextCounter, writeAudit } from "./lib/tenant";
import {
  dayStart,
  periodKey,
  requireHrPermission,
} from "./lib/hr";
import { getSystemAccount } from "./lib/accounts";
import {
  postAutoJournal,
  recordFinancialMovement,
  resolveFinancialAccount,
} from "./lib/finance";
import {
  optionalString,
  requireInt,
  requireString,
} from "./lib/validation";
import { financialAccountTypeValidator } from "./schema";
import type { DocumentLineInput } from "./lib/accounting";

const method = depreciationMethodValidator;
const status = assetStatusValidator;
const movementType = assetMovementTypeValidator;
const accountType = financialAccountTypeValidator;

async function assetFor(
  ctx: Parameters<typeof requireHrPermission>[0],
  businessId: Id<"businesses">,
  assetId: Id<"fixedAssets">,
) {
  const asset = await ctx.db.get(assetId);
  if (!asset || asset.businessId !== businessId) {
    throw new ConvexError("دارایی ثابت در این کسب‌وکار یافت نشد.");
  }
  return asset;
}

async function accumulatedFor(
  ctx: Parameters<typeof requireHrPermission>[0],
  businessId: Id<"businesses">,
  assetId: Id<"fixedAssets">,
) {
  const rows = await ctx.db
    .query("assetDepreciations")
    .withIndex("by_business_asset", (q) =>
      q.eq("businessId", businessId).eq("assetId", assetId),
    )
    .collect();
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function monthlyAmount(
  asset: Doc<"fixedAssets">,
  accumulated: number,
) {
  const remaining = Math.max(0, asset.cost - asset.salvageValue - accumulated);
  if (remaining <= 0) return 0;
  let amount = 0;
  if (asset.method === "straight_line") {
    amount = Math.round(
      (asset.cost - asset.salvageValue) / asset.usefulLifeMonths,
    );
  } else if (asset.method === "declining_balance") {
    const rate = asset.decliningRateBps ?? 2000;
    amount = Math.round(
      ((asset.cost - accumulated) * rate) / 10_000 / 12,
    );
  } else {
    amount = asset.customMonthlyAmount ?? 0;
  }
  return Math.max(0, Math.min(remaining, amount));
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
    status: v.optional(status),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "assets.view");
    const rows = await ctx.db
      .query("fixedAssets")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(3000);
    const needle = args.search?.trim().toLowerCase();
    const result = await Promise.all(
      rows
        .filter((row) => {
          if (args.branchId && row.branchId !== args.branchId) return false;
          if (args.status && row.status !== args.status) return false;
          if (!needle) return true;
          return `${row.code} ${row.name} ${row.group} ${row.location}`
            .toLowerCase()
            .includes(needle);
        })
        .map(async (asset) => {
          const accumulated = await accumulatedFor(
            ctx,
            args.businessId,
            asset._id,
          );
          return {
            ...asset,
            accumulated,
            bookValue: Math.max(0, asset.cost - accumulated),
          };
        }),
    );
    return result.sort((a, b) => a.code.localeCompare(b.code));
  },
});

export const get = query({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("fixedAssets"),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "assets.view");
    const asset = await assetFor(ctx, args.businessId, args.assetId);
    const [depreciations, movements, branch] = await Promise.all([
      ctx.db
        .query("assetDepreciations")
        .withIndex("by_business_asset", (q) =>
          q.eq("businessId", args.businessId).eq("assetId", asset._id),
        )
        .collect(),
      ctx.db
        .query("assetMovements")
        .withIndex("by_business_asset", (q) =>
          q.eq("businessId", args.businessId).eq("assetId", asset._id),
        )
        .collect(),
      ctx.db.get(asset.branchId),
    ]);
    const accumulated = depreciations.reduce((sum, row) => sum + row.amount, 0);
    return {
      ...asset,
      branchName: branch?.name ?? "—",
      accumulated,
      bookValue: Math.max(0, asset.cost - accumulated),
      depreciations: depreciations.sort(
        (a, b) => a.periodKey.localeCompare(b.periodKey),
      ),
      movements: movements.sort((a, b) => b.occurredAt - a.occurredAt),
    };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    code: v.optional(v.string()),
    name: v.string(),
    group: v.string(),
    branchId: v.id("branches"),
    location: v.string(),
    custodian: v.optional(v.string()),
    purchaseDate: v.number(),
    cost: v.number(),
    usefulLifeMonths: v.number(),
    salvageValue: v.number(),
    method,
    decliningRateBps: v.optional(v.number()),
    customMonthlyAmount: v.optional(v.number()),
    funding: v.union(
      v.literal("cash"),
      v.literal("bank"),
      v.literal("payable"),
    ),
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.businessId !== args.businessId || branch.archivedAt) {
      throw new ConvexError("شعبه دارایی در این کسب‌وکار یافت نشد.");
    }
    const cost = requireInt(args.cost, "بهای تمام‌شده", { min: 1 });
    const salvage = requireInt(args.salvageValue, "ارزش اسقاط", { min: 0 });
    if (salvage >= cost) {
      throw new ConvexError("ارزش اسقاط باید کمتر از بهای تمام‌شده باشد.");
    }
    const usefulLifeMonths = requireInt(args.usefulLifeMonths, "عمر مفید", {
      min: 1,
      max: 600,
    });
    if (args.method === "custom") {
      if (
        args.customMonthlyAmount === undefined ||
        args.customMonthlyAmount <= 0
      ) {
        throw new ConvexError("برای روش سفارشی، استهلاک ماهانه لازم است.");
      }
    }
    if (
      args.method === "declining_balance" &&
      (args.decliningRateBps === undefined ||
        args.decliningRateBps <= 0 ||
        args.decliningRateBps > 10_000)
    ) {
      throw new ConvexError("نرخ استهلاک نزولی معتبر نیست.");
    }
    let code = optionalString(args.code, "کد دارایی", 40);
    if (code) {
      const duplicate = await ctx.db
        .query("fixedAssets")
        .withIndex("by_business_code", (q) =>
          q.eq("businessId", args.businessId).eq("code", code as string),
        )
        .unique();
      if (duplicate) throw new ConvexError("کد دارایی تکراری است.");
    } else {
      const sequence = await nextCounter(ctx, args.businessId, "fixed-asset");
      code = `FA-${String(sequence).padStart(4, "0")}`;
    }
    const purchaseDate = dayStart(args.purchaseDate);
    const now = Date.now();
    const assetId = await ctx.db.insert("fixedAssets", {
      businessId: args.businessId,
      code,
      name: requireString(args.name, "نام دارایی", { max: 200 }) as string,
      group: requireString(args.group, "گروه دارایی", { max: 120 }) as string,
      branchId: args.branchId,
      location: requireString(args.location, "محل استقرار", {
        max: 200,
      }) as string,
      custodian: optionalString(args.custodian, "مسئول دارایی", 150),
      purchaseDate,
      cost,
      usefulLifeMonths,
      salvageValue: salvage,
      method: args.method,
      decliningRateBps: args.decliningRateBps,
      customMonthlyAmount: args.customMonthlyAmount,
      status: "active",
      notes: optionalString(args.notes, "یادداشت", 1000),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    const fixedAssetAccount = await getSystemAccount(
      ctx,
      args.businessId,
      "fixedAssets",
    );
    if (!fixedAssetAccount) {
      throw new ConvexError("حساب دارایی ثابت در کدینگ یافت نشد.");
    }
    const lines: DocumentLineInput[] = [
      {
        accountId: fixedAssetAccount._id,
        description: `خرید دارایی ${code} — ${args.name}`,
        debit: cost,
        credit: 0,
      },
    ];
    let account: Awaited<ReturnType<typeof resolveFinancialAccount>> | null =
      null;
    if (args.funding === "payable") {
      const payable = await getSystemAccount(
        ctx,
        args.businessId,
        "otherPayable",
      );
      if (!payable) {
        throw new ConvexError("حساب سایر پرداختنی‌ها در کدینگ یافت نشد.");
      }
      lines.push({
        accountId: payable._id,
        description: "بدهی خرید دارایی ثابت",
        debit: 0,
        credit: cost,
      });
    } else {
      account = await resolveFinancialAccount(ctx, args.businessId, {
        type: args.funding,
        bankAccountId: args.bankAccountId,
        cashFundId: args.cashFundId,
      });
      lines.push({
        accountId: account.accountId,
        description: `پرداخت خرید از ${account.name}`,
        debit: 0,
        credit: cost,
      });
    }
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: purchaseDate,
      description: `خرید دارایی ثابت ${code}`,
      branchId: args.branchId,
      sourceType: "fixed-asset-purchase",
      sourceId: assetId,
      lines,
    });
    await ctx.db.patch(assetId, { accountingDocumentId: journal.documentId });
    await ctx.db.insert("assetMovements", {
      businessId: args.businessId,
      assetId,
      type: "purchase",
      occurredAt: purchaseDate,
      toBranchId: args.branchId,
      amount: cost,
      description: `خرید دارایی از طریق ${args.funding === "payable" ? "حساب پرداختنی" : account?.name}`,
      accountingDocumentId: journal.documentId,
      createdBy: user._id,
      createdAt: now,
    });
    if (account) {
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: journal.branchId,
        fiscalYearId: journal.fiscalYearId,
        account,
        direction: "out",
        amount: cost,
        occurredAt: purchaseDate,
        operationType: "fixed-asset-purchase",
        operationId: assetId,
        description: `خرید دارایی ${code}`,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "asset.create",
      entity: "fixedAssets",
      entityId: assetId,
      summary: `ثبت دارایی ${code} با بهای ${cost}`,
    });
    return {
      assetId,
      code,
      accountingDocumentId: journal.documentId,
      documentNumber: journal.number,
    };
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("fixedAssets"),
    name: v.optional(v.string()),
    group: v.optional(v.string()),
    location: v.optional(v.string()),
    custodian: v.optional(v.string()),
    method: v.optional(method),
    usefulLifeMonths: v.optional(v.number()),
    salvageValue: v.optional(v.number()),
    decliningRateBps: v.optional(v.number()),
    customMonthlyAmount: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const asset = await assetFor(ctx, args.businessId, args.assetId);
    if (asset.status === "sold" || asset.status === "disposed") {
      throw new ConvexError("دارایی خارج‌شده قابل ویرایش نیست.");
    }
    const depreciations = await ctx.db
      .query("assetDepreciations")
      .withIndex("by_business_asset", (q) =>
        q.eq("businessId", args.businessId).eq("assetId", asset._id),
      )
      .first();
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined)
      patch.name = requireString(args.name, "نام دارایی", { max: 200 });
    if (args.group !== undefined)
      patch.group = requireString(args.group, "گروه دارایی", { max: 120 });
    if (args.location !== undefined)
      patch.location = requireString(args.location, "محل استقرار", {
        max: 200,
      });
    if (args.custodian !== undefined)
      patch.custodian = optionalString(args.custodian, "مسئول دارایی", 150);
    if (args.notes !== undefined)
      patch.notes = optionalString(args.notes, "یادداشت", 1000);
    const structural =
      args.method !== undefined ||
      args.usefulLifeMonths !== undefined ||
      args.salvageValue !== undefined ||
      args.decliningRateBps !== undefined ||
      args.customMonthlyAmount !== undefined;
    if (structural && depreciations) {
      throw new ConvexError(
        "پس از ثبت استهلاک، روش و پارامترهای مالی دارایی قابل تغییر نیستند.",
      );
    }
    if (args.method !== undefined) patch.method = args.method;
    if (args.usefulLifeMonths !== undefined)
      patch.usefulLifeMonths = requireInt(
        args.usefulLifeMonths,
        "عمر مفید",
        { min: 1, max: 600 },
      );
    if (args.salvageValue !== undefined) {
      const salvage = requireInt(args.salvageValue, "ارزش اسقاط", { min: 0 });
      if (salvage >= asset.cost) {
        throw new ConvexError("ارزش اسقاط باید کمتر از بهای دارایی باشد.");
      }
      patch.salvageValue = salvage;
    }
    if (args.decliningRateBps !== undefined)
      patch.decliningRateBps = requireInt(
        args.decliningRateBps,
        "نرخ نزولی",
        { min: 1, max: 10_000 },
      );
    if (args.customMonthlyAmount !== undefined)
      patch.customMonthlyAmount = requireInt(
        args.customMonthlyAmount,
        "استهلاک ماهانه",
        { min: 1 },
      );
    await ctx.db.patch(asset._id, patch);
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "asset.update",
      entity: "fixedAssets",
      entityId: asset._id,
      summary: `ویرایش دارایی ${asset.code}`,
    });
    return { assetId: asset._id };
  },
});

export const transfer = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("fixedAssets"),
    toBranchId: v.id("branches"),
    occurredAt: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const asset = await assetFor(ctx, args.businessId, args.assetId);
    if (asset.status === "sold" || asset.status === "disposed") {
      throw new ConvexError("دارایی خارج‌شده قابل انتقال نیست.");
    }
    if (asset.branchId === args.toBranchId) {
      throw new ConvexError("شعبه مقصد با محل فعلی دارایی یکسان است.");
    }
    const toBranch = await ctx.db.get(args.toBranchId);
    if (
      !toBranch ||
      toBranch.businessId !== args.businessId ||
      toBranch.archivedAt
    ) {
      throw new ConvexError("شعبه مقصد یافت نشد.");
    }
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      branchId: args.toBranchId,
      updatedAt: now,
    });
    const movementId = await ctx.db.insert("assetMovements", {
      businessId: args.businessId,
      assetId: asset._id,
      type: "transfer",
      occurredAt: dayStart(args.occurredAt),
      fromBranchId: asset.branchId,
      toBranchId: args.toBranchId,
      amount: 0,
      description:
        optionalString(args.description, "توضیح انتقال", 500) ??
        `انتقال دارایی ${asset.code} به ${toBranch.name}`,
      createdBy: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "asset.transfer",
      entity: "fixedAssets",
      entityId: asset._id,
      summary: `انتقال دارایی ${asset.code} به ${toBranch.name}`,
    });
    return { movementId, branchId: args.toBranchId };
  },
});

export const repair = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("fixedAssets"),
    amount: v.number(),
    occurredAt: v.number(),
    description: v.string(),
    sourceType: accountType,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const asset = await assetFor(ctx, args.businessId, args.assetId);
    if (asset.status === "sold" || asset.status === "disposed") {
      throw new ConvexError("دارایی خارج‌شده قابل تعمیر نیست.");
    }
    const amount = requireInt(args.amount, "هزینه تعمیر", { min: 1 });
    const account = await resolveFinancialAccount(ctx, args.businessId, {
      type: args.sourceType,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
    });
    const repairAccount = await getSystemAccount(
      ctx,
      args.businessId,
      "repairExpense",
    );
    if (!repairAccount) {
      throw new ConvexError("حساب هزینه تعمیرات در کدینگ یافت نشد.");
    }
    const occurredAt = dayStart(args.occurredAt);
    const description = `تعمیر دارایی ${asset.code} — ${requireString(args.description, "شرح تعمیر", { max: 500 })}`;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt,
      description,
      branchId: asset.branchId,
      sourceType: "asset-repair",
      sourceId: `${asset._id}:${occurredAt}:${amount}`,
      lines: [
        {
          accountId: repairAccount._id,
          description,
          debit: amount,
          credit: 0,
        },
        {
          accountId: account.accountId,
          description: `پرداخت از ${account.name}`,
          debit: 0,
          credit: amount,
        },
      ],
    });
    await recordFinancialMovement(ctx, {
      businessId: args.businessId,
      branchId: journal.branchId,
      fiscalYearId: journal.fiscalYearId,
      account,
      direction: "out",
      amount,
      occurredAt,
      operationType: "asset-repair",
      operationId: asset._id,
      description,
      accountingDocumentId: journal.documentId,
      actorId: user._id,
    });
    const now = Date.now();
    const movementId = await ctx.db.insert("assetMovements", {
      businessId: args.businessId,
      assetId: asset._id,
      type: "repair",
      occurredAt,
      fromBranchId: asset.branchId,
      toBranchId: asset.branchId,
      amount,
      description,
      accountingDocumentId: journal.documentId,
      createdBy: user._id,
      createdAt: now,
    });
    return {
      movementId,
      accountingDocumentId: journal.documentId,
      documentNumber: journal.number,
    };
  },
});

export const depreciationPreview = query({
  args: {
    businessId: v.id("businesses"),
    asOf: v.number(),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "assets.view");
    const assets = await ctx.db
      .query("fixedAssets")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(3000);
    const key = periodKey(args.asOf);
    const rows = [];
    for (const asset of assets) {
      if (args.branchId && asset.branchId !== args.branchId) continue;
      if (asset.status !== "active" && asset.status !== "fully_depreciated")
        continue;
      const [depreciations, existing] = await Promise.all([
        ctx.db
          .query("assetDepreciations")
          .withIndex("by_business_asset", (q) =>
            q.eq("businessId", args.businessId).eq("assetId", asset._id),
          )
          .collect(),
        ctx.db
          .query("assetDepreciations")
          .withIndex("by_asset_period", (q) =>
            q.eq("assetId", asset._id).eq("periodKey", key),
          )
          .unique(),
      ]);
      const accumulated = depreciations.reduce(
        (sum, row) => sum + row.amount,
        0,
      );
      const amount = monthlyAmount(asset, accumulated);
      rows.push({
        assetId: asset._id as string,
        code: asset.code,
        name: asset.name,
        branchId: asset.branchId as string,
        cost: asset.cost,
        salvageValue: asset.salvageValue,
        accumulated,
        bookValue: Math.max(0, asset.cost - accumulated),
        amount,
        alreadyPosted: Boolean(existing),
        periodKey: key,
      });
    }
    return {
      periodKey: key,
      rows: rows.filter(
        (row) => !row.alreadyPosted && row.amount > 0,
      ),
      total: rows
        .filter((row) => !row.alreadyPosted)
        .reduce((sum, row) => sum + row.amount, 0),
    };
  },
});

export const runDepreciation = mutation({
  args: {
    businessId: v.id("businesses"),
    asOf: v.number(),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const expense = await getSystemAccount(
      ctx,
      args.businessId,
      "depreciationExpense",
    );
    const accumulatedAccount = await getSystemAccount(
      ctx,
      args.businessId,
      "accumulatedDepreciation",
    );
    if (!expense || !accumulatedAccount) {
      throw new ConvexError("حساب‌های استهلاک در کدینگ یافت نشد.");
    }
    const assets = await ctx.db
      .query("fixedAssets")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(3000);
    const key = periodKey(args.asOf);
    const periodStart = Date.UTC(
      new Date(args.asOf).getUTCFullYear(),
      new Date(args.asOf).getUTCMonth(),
      1,
    );
    const periodEnd = Date.UTC(
      new Date(args.asOf).getUTCFullYear(),
      new Date(args.asOf).getUTCMonth() + 1,
      1,
    ) - 1;
    const posted = [];
    for (const asset of assets) {
      if (args.branchId && asset.branchId !== args.branchId) continue;
      if (asset.status !== "active" && asset.status !== "fully_depreciated")
        continue;
      const existing = await ctx.db
        .query("assetDepreciations")
        .withIndex("by_asset_period", (q) =>
          q.eq("assetId", asset._id).eq("periodKey", key),
        )
        .unique();
      if (existing) continue;
      const accumulated = await accumulatedFor(
        ctx,
        args.businessId,
        asset._id,
      );
      const amount = monthlyAmount(asset, accumulated);
      if (amount <= 0) continue;
      const journal = await postAutoJournal(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        occurredAt: periodEnd,
        description: `استهلاک ${key} دارایی ${asset.code}`,
        branchId: asset.branchId,
        sourceType: "asset-depreciation",
        sourceId: `${asset._id}:${key}`,
        lines: [
          {
            accountId: expense._id,
            description: `هزینه استهلاک ${asset.name}`,
            debit: amount,
            credit: 0,
          },
          {
            accountId: accumulatedAccount._id,
            description: `استهلاک انباشته ${asset.name}`,
            debit: 0,
            credit: amount,
          },
        ],
      });
      const accumulatedAfter = accumulated + amount;
      const bookValueAfter = Math.max(0, asset.cost - accumulatedAfter);
      await ctx.db.insert("assetDepreciations", {
        businessId: args.businessId,
        assetId: asset._id,
        branchId: asset.branchId,
        periodKey: key,
        periodStart,
        periodEnd,
        amount,
        accumulatedAfter,
        bookValueAfter,
        status: "posted",
        accountingDocumentId: journal.documentId,
        createdBy: user._id,
        createdAt: Date.now(),
      });
      await ctx.db.insert("assetMovements", {
        businessId: args.businessId,
        assetId: asset._id,
        type: "depreciation",
        occurredAt: periodEnd,
        fromBranchId: asset.branchId,
        amount,
        description: `استهلاک دوره ${key}`,
        accountingDocumentId: journal.documentId,
        createdBy: user._id,
        createdAt: Date.now(),
      });
      if (bookValueAfter <= asset.salvageValue) {
        await ctx.db.patch(asset._id, {
          status: "fully_depreciated",
          updatedAt: Date.now(),
        });
      }
      posted.push({
        assetId: asset._id as string,
        amount,
        accountingDocumentId: journal.documentId as string,
      });
    }
    if (posted.length === 0) {
      throw new ConvexError("استهلاک قابل ثبت برای این دوره وجود ندارد.");
    }
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "asset.depreciation",
      entity: "assetDepreciations",
      entityId: key,
      summary: `ثبت استهلاک ${posted.length} دارایی برای ${key}`,
    });
    return {
      periodKey: key,
      count: posted.length,
      total: posted.reduce((sum, row) => sum + row.amount, 0),
      documents: posted,
    };
  },
});

async function disposalLines(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  asset: Doc<"fixedAssets">,
  accumulated: number,
  proceeds: number,
  paymentAccountId?: Id<"accounts">,
) {
  const fixedAssetAccount = await getSystemAccount(
    ctx,
    businessId,
    "fixedAssets",
  );
  const accumulatedAccount = await getSystemAccount(
    ctx,
    businessId,
    "accumulatedDepreciation",
  );
  const gainAccount = await getSystemAccount(ctx, businessId, "gainOnAssetSale");
  const lossAccount = await getSystemAccount(
    ctx,
    businessId,
    "assetDisposalLoss",
  );
  if (!fixedAssetAccount || !accumulatedAccount || !gainAccount || !lossAccount) {
    throw new ConvexError("حساب‌های خروج دارایی در کدینگ کامل نیست.");
  }
  const bookValue = Math.max(0, asset.cost - accumulated);
  const lines: DocumentLineInput[] = [];
  if (proceeds > 0 && paymentAccountId) {
    lines.push({
      accountId: paymentAccountId,
      description: "وجه فروش دارایی",
      debit: proceeds,
      credit: 0,
    });
  }
  if (accumulated > 0) {
    lines.push({
      accountId: accumulatedAccount._id,
      description: "حذف استهلاک انباشته",
      debit: accumulated,
      credit: 0,
    });
  }
  if (bookValue > proceeds) {
    lines.push({
      accountId: lossAccount._id,
      description: "زیان فروش/خروج دارایی",
      debit: bookValue - proceeds,
      credit: 0,
    });
  }
  lines.push({
    accountId: fixedAssetAccount._id,
    description: "حذف بهای تمام‌شده دارایی",
    debit: 0,
    credit: asset.cost,
  });
  if (proceeds > bookValue) {
    lines.push({
      accountId: gainAccount._id,
      description: "سود فروش دارایی",
      debit: 0,
      credit: proceeds - bookValue,
    });
  }
  return { lines, bookValue };
}

export const sell = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("fixedAssets"),
    proceeds: v.number(),
    saleDate: v.number(),
    sourceType: accountType,
    bankAccountId: v.optional(v.id("bankAccounts")),
    cashFundId: v.optional(v.id("cashFunds")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const asset = await assetFor(ctx, args.businessId, args.assetId);
    if (asset.status === "sold" || asset.status === "disposed") {
      throw new ConvexError("این دارایی قبلاً خارج شده است.");
    }
    const proceeds = requireInt(args.proceeds, "مبلغ فروش", { min: 0 });
    const account = await resolveFinancialAccount(ctx, args.businessId, {
      type: args.sourceType,
      bankAccountId: args.bankAccountId,
      cashFundId: args.cashFundId,
    });
    const accumulated = await accumulatedFor(
      ctx,
      args.businessId,
      asset._id,
    );
    const { lines, bookValue } = await disposalLines(
      ctx,
      args.businessId,
      asset,
      accumulated,
      proceeds,
      account.accountId,
    );
    const saleDate = dayStart(args.saleDate);
    const description =
      optionalString(args.description, "توضیح فروش", 500) ??
      `فروش دارایی ${asset.code} — ${asset.name}`;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: saleDate,
      description,
      branchId: asset.branchId,
      sourceType: "asset-sale",
      sourceId: asset._id,
      lines,
    });
    if (proceeds > 0) {
      await recordFinancialMovement(ctx, {
        businessId: args.businessId,
        branchId: journal.branchId,
        fiscalYearId: journal.fiscalYearId,
        account,
        direction: "in",
        amount: proceeds,
        occurredAt: saleDate,
        operationType: "asset-sale",
        operationId: asset._id,
        description,
        accountingDocumentId: journal.documentId,
        actorId: user._id,
      });
    }
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      status: "sold",
      disposedAt: saleDate,
      updatedAt: now,
    });
    await ctx.db.insert("assetMovements", {
      businessId: args.businessId,
      assetId: asset._id,
      type: "sale",
      occurredAt: saleDate,
      fromBranchId: asset.branchId,
      amount: proceeds,
      description: `${description} (ارزش دفتری ${bookValue})`,
      accountingDocumentId: journal.documentId,
      createdBy: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "asset.sale",
      entity: "fixedAssets",
      entityId: asset._id,
      summary: `فروش دارایی ${asset.code} به مبلغ ${proceeds}`,
    });
    return {
      accountingDocumentId: journal.documentId,
      documentNumber: journal.number,
      bookValue,
    };
  },
});

export const dispose = mutation({
  args: {
    businessId: v.id("businesses"),
    assetId: v.id("fixedAssets"),
    disposedAt: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireHrPermission(
      ctx,
      args.businessId,
      "assets.manage",
      { write: true },
    );
    const asset = await assetFor(ctx, args.businessId, args.assetId);
    if (asset.status === "sold" || asset.status === "disposed") {
      throw new ConvexError("این دارایی قبلاً خارج شده است.");
    }
    const accumulated = await accumulatedFor(
      ctx,
      args.businessId,
      asset._id,
    );
    const { lines, bookValue } = await disposalLines(
      ctx,
      args.businessId,
      asset,
      accumulated,
      0,
    );
    const disposedAt = dayStart(args.disposedAt);
    const reason = requireString(args.reason, "علت خروج", { max: 500 }) as string;
    const journal = await postAutoJournal(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      occurredAt: disposedAt,
      description: `خروج دارایی ${asset.code} — ${reason}`,
      branchId: asset.branchId,
      sourceType: "asset-disposal",
      sourceId: asset._id,
      lines,
    });
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      status: "disposed",
      disposedAt,
      updatedAt: now,
    });
    await ctx.db.insert("assetMovements", {
      businessId: args.businessId,
      assetId: asset._id,
      type: "disposal",
      occurredAt: disposedAt,
      fromBranchId: asset.branchId,
      amount: bookValue,
      description: reason,
      accountingDocumentId: journal.documentId,
      createdBy: user._id,
      createdAt: now,
    });
    return {
      accountingDocumentId: journal.documentId,
      documentNumber: journal.number,
      bookValue,
    };
  },
});

export const bookValueReport = query({
  args: {
    businessId: v.id("businesses"),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "assets.view");
    const assets = await ctx.db
      .query("fixedAssets")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(3000);
    const result = [];
    for (const asset of assets) {
      if (args.branchId && asset.branchId !== args.branchId) continue;
      const accumulated = await accumulatedFor(
        ctx,
        args.businessId,
        asset._id,
      );
      result.push({
        code: asset.code,
        name: asset.name,
        group: asset.group,
        purchaseDate: asset.purchaseDate,
        cost: asset.cost,
        accumulated,
        bookValue: Math.max(0, asset.cost - accumulated),
        status: asset.status,
      });
    }
    return {
      rows: result,
      totals: {
        cost: result.reduce((sum, row) => sum + row.cost, 0),
        accumulated: result.reduce((sum, row) => sum + row.accumulated, 0),
        bookValue: result.reduce((sum, row) => sum + row.bookValue, 0),
      },
    };
  },
});

export const depreciationReport = query({
  args: {
    businessId: v.id("businesses"),
    from: v.number(),
    to: v.number(),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "assets.view");
    const rows = await ctx.db
      .query("assetDepreciations")
      .withIndex("by_business_asset", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(5000);
    const assetIds = [...new Set(rows.map((row) => row.assetId))];
    const assets = await Promise.all(assetIds.map((id) => ctx.db.get(id)));
    const names = new Map(
      assets
        .filter((row): row is Doc<"fixedAssets"> => Boolean(row))
        .map((row) => [row._id as string, row]),
    );
    const filtered = rows.filter(
      (row) =>
        row.periodEnd >= dayStart(args.from) &&
        row.periodStart <= dayStart(args.to) &&
        (!args.branchId || row.branchId === args.branchId),
    );
    return filtered
      .sort((a, b) => b.periodEnd - a.periodEnd)
      .map((row) => {
        const asset = names.get(row.assetId as string);
        return {
          ...row,
          assetCode: asset?.code ?? "—",
          assetName: asset?.name ?? "—",
          method: asset?.method ?? "—",
        };
      });
  },
});

export const movements = query({
  args: {
    businessId: v.id("businesses"),
    assetId: v.optional(v.id("fixedAssets")),
  },
  handler: async (ctx, args) => {
    await requireHrPermission(ctx, args.businessId, "assets.view");
    const rows = args.assetId
      ? await ctx.db
          .query("assetMovements")
          .withIndex("by_business_asset", (q) =>
            q
              .eq("businessId", args.businessId)
              .eq("assetId", args.assetId as Id<"fixedAssets">),
          )
          .collect()
      : await ctx.db
          .query("assetMovements")
          .withIndex("by_business_occurred", (q) =>
            q.eq("businessId", args.businessId),
          )
          .take(3000);
    const assetIds = [...new Set(rows.map((row) => row.assetId))];
    const assets = await Promise.all(assetIds.map((id) => ctx.db.get(id)));
    const names = new Map(
      assets
        .filter((row): row is Doc<"fixedAssets"> => Boolean(row))
        .map((row) => [row._id as string, row.name]),
    );
    return rows
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map((row) => ({
        ...row,
        assetName: names.get(row.assetId as string) ?? "—",
      }));
  },
});
