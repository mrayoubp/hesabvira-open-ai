import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership, writeAudit } from "./lib/tenant";
import { optionalString, requireInt, requireString } from "./lib/validation";
import {
  createFinancialGlAccount,
  financialBalance,
  initializeFinancialAccount,
  resolveFinancialAccount,
} from "./lib/finance";

const DAY_MS = 24 * 60 * 60 * 1000;

function mask(value: string | undefined, visible = 4) {
  if (!value) return undefined;
  if (value.length <= visible) return "••••";
  return `${"•".repeat(Math.max(4, value.length - visible))}${value.slice(-visible)}`;
}

function validateDate(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConvexError(`${label} معتبر نیست.`);
  }
  return value;
}

export const banks = query({
  args: {
    businessId: v.id("businesses"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireMembership(ctx, args.businessId);
    const canViewSensitive = membership.role !== "viewer";
    const rows = await ctx.db
      .query("bankAccounts")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(200);
    const movements = await ctx.db
      .query("financialTransactions")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(10000);
    const balances = new Map<string, number>();
    for (const movement of movements) {
      if (!movement.bankAccountId) continue;
      const key = movement.bankAccountId as string;
      balances.set(
        key,
        (balances.get(key) ?? 0) +
          (movement.direction === "in" ? movement.amount : -movement.amount),
      );
    }
    return rows
      .filter((row) => args.includeInactive || row.active)
      .map((row) => ({
        _id: row._id as string,
        name: row.name,
        bankName: row.bankName,
        accountNumber: canViewSensitive
          ? row.accountNumber
          : (mask(row.accountNumber) ?? "••••"),
        iban: canViewSensitive ? (row.iban ?? null) : (mask(row.iban, 6) ?? null),
        holderName: canViewSensitive
          ? row.holderName
          : (mask(row.holderName, 2) ?? "••••"),
        bankBranch: row.bankBranch ?? null,
        branchId: row.branchId ?? null,
        notes: row.notes ?? null,
        active: row.active,
        accountId: row.accountId as string,
        balance: balances.get(row._id as string) ?? 0,
        canViewSensitive,
        createdAt: row.createdAt,
      }));
  },
});

export const bank = query({
  args: {
    businessId: v.id("businesses"),
    bankAccountId: v.id("bankAccounts"),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireMembership(ctx, args.businessId);
    const row = await ctx.db.get(args.bankAccountId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("حساب بانکی در این کسب‌وکار یافت نشد.");
    }
    const canViewSensitive = membership.role !== "viewer";
    const balance = await financialBalance(ctx, {
      type: "bank",
      id: row._id as string,
    });
    return {
      _id: row._id as string,
      name: row.name,
      bankName: row.bankName,
      accountNumber: canViewSensitive
        ? row.accountNumber
        : (mask(row.accountNumber) ?? "••••"),
      iban: canViewSensitive ? (row.iban ?? null) : (mask(row.iban, 6) ?? null),
      holderName: canViewSensitive
        ? row.holderName
        : (mask(row.holderName, 2) ?? "••••"),
      bankBranch: row.bankBranch ?? null,
      branchId: row.branchId ?? null,
      notes: row.notes ?? null,
      active: row.active,
      accountId: row.accountId as string,
      balance,
      canViewSensitive,
      createdAt: row.createdAt,
    };
  },
});

export const createBank = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    bankName: v.string(),
    accountNumber: v.string(),
    iban: v.optional(v.string()),
    holderName: v.string(),
    bankBranch: v.optional(v.string()),
    notes: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    openingBalance: v.optional(v.number()),
    openingDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== args.businessId || branch.archivedAt) {
        throw new ConvexError("شعبه حساب بانکی یافت نشد.");
      }
    }
    const name = requireString(args.name, "نام حساب", { max: 100 }) as string;
    const bankName = requireString(args.bankName, "نام بانک", {
      max: 100,
    }) as string;
    const accountNumber = (
      requireString(args.accountNumber, "شماره حساب", { max: 40 }) as string
    ).replace(/\s/g, "");
    if (!/^[0-9-]{4,40}$/.test(accountNumber)) {
      throw new ConvexError("شماره حساب باید فقط شامل رقم و خط تیره باشد.");
    }
    const duplicate = await ctx.db
      .query("bankAccounts")
      .withIndex("by_business_account_number", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("accountNumber", accountNumber),
      )
      .unique();
    if (duplicate) {
      throw new ConvexError("این شماره حساب قبلاً در کسب‌وکار ثبت شده است.");
    }
    const holderName = requireString(args.holderName, "نام صاحب حساب", {
      max: 120,
    }) as string;
    const iban = optionalString(args.iban, "شبا", 34);
    if (iban && !/^[0-9A-Za-z]{10,34}$/.test(iban.replace(/\s/g, ""))) {
      throw new ConvexError("شماره شبا معتبر نیست.");
    }
    const bankBranch = optionalString(args.bankBranch, "شعبه بانک", 100);
    const notes = optionalString(args.notes, "توضیحات", 500);
    const openingBalance = requireInt(
      args.openingBalance ?? 0,
      "موجودی اولیه",
      { min: 0 },
    );
    const openingDate = validateDate(args.openingDate ?? Date.now(), "تاریخ افتتاح");

    const gl = await createFinancialGlAccount(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      name: `بانک — ${name}`,
    });
    const now = Date.now();
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      businessId: args.businessId,
      branchId: args.branchId,
      name,
      bankName,
      accountNumber,
      iban: iban?.replace(/\s/g, "").toUpperCase(),
      holderName,
      bankBranch,
      notes,
      accountId: gl.accountId,
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    if (openingBalance > 0) {
      const ref = await resolveFinancialAccount(ctx, args.businessId, {
        type: "bank",
        bankAccountId,
      });
      await initializeFinancialAccount(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        accountRef: ref,
        openingBalance,
        openingDate,
        description: `موجودی اولیه حساب بانکی ${name}`,
        sourceType: "bank-opening",
        sourceId: bankAccountId as string,
      });
    }

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "bank.create",
      entity: "bankAccounts",
      entityId: bankAccountId,
      summary: `ایجاد حساب بانکی ${bankName} — ${name}`,
    });

    return { bankAccountId, accountId: gl.accountId, accountCode: gl.code };
  },
});

export const updateBank = mutation({
  args: {
    businessId: v.id("businesses"),
    bankAccountId: v.id("bankAccounts"),
    name: v.string(),
    bankName: v.string(),
    accountNumber: v.string(),
    iban: v.optional(v.string()),
    holderName: v.string(),
    bankBranch: v.optional(v.string()),
    branchId: v.optional(v.union(v.id("branches"), v.null())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await ctx.db.get(args.bankAccountId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("حساب بانکی در این کسب‌وکار یافت نشد.");
    }
    const name = requireString(args.name, "نام حساب", { max: 100 }) as string;
    const bankName = requireString(args.bankName, "نام بانک", {
      max: 100,
    }) as string;
    const accountNumber = (
      requireString(args.accountNumber, "شماره حساب", { max: 40 }) as string
    ).replace(/\s/g, "");
    if (!/^[0-9-]{4,40}$/.test(accountNumber)) {
      throw new ConvexError("شماره حساب باید فقط شامل رقم و خط تیره باشد.");
    }
    const duplicate = await ctx.db
      .query("bankAccounts")
      .withIndex("by_business_account_number", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("accountNumber", accountNumber),
      )
      .unique();
    if (duplicate && duplicate._id !== row._id) {
      throw new ConvexError("این شماره حساب قبلاً در کسب‌وکار ثبت شده است.");
    }
    const holderName = requireString(args.holderName, "نام صاحب حساب", {
      max: 120,
    }) as string;
    const iban = optionalString(args.iban, "شبا", 34);
    if (iban && !/^[0-9A-Za-z]{10,34}$/.test(iban.replace(/\s/g, ""))) {
      throw new ConvexError("شماره شبا معتبر نیست.");
    }
    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== args.businessId || branch.archivedAt) {
        throw new ConvexError("شعبه حساب بانکی یافت نشد.");
      }
    }
    await ctx.db.patch(row._id, {
      name,
      bankName,
      accountNumber,
      iban: iban?.replace(/\s/g, "").toUpperCase(),
      holderName,
      bankBranch: optionalString(args.bankBranch, "شعبه بانک", 100),
      branchId:
        args.branchId === undefined
          ? row.branchId
          : (args.branchId ?? undefined),
      notes: optionalString(args.notes, "توضیحات", 500),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(row.accountId, {
      name: `بانک — ${name}`,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "bank.update",
      entity: "bankAccounts",
      entityId: row._id,
      summary: `ویرایش حساب بانکی ${name}`,
    });
    return { bankAccountId: row._id };
  },
});

export const setBankActive = mutation({
  args: {
    businessId: v.id("businesses"),
    bankAccountId: v.id("bankAccounts"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await ctx.db.get(args.bankAccountId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("حساب بانکی در این کسب‌وکار یافت نشد.");
    }
    await ctx.db.patch(row._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.active ? "bank.activate" : "bank.deactivate",
      entity: "bankAccounts",
      entityId: row._id,
      summary: `${args.active ? "فعال‌سازی" : "غیرفعال‌سازی"} حساب بانکی ${row.name}`,
    });
    return { bankAccountId: row._id, active: args.active };
  },
});

export const funds = query({
  args: {
    businessId: v.id("businesses"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("cashFunds")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(200);
    const movements = await ctx.db
      .query("financialTransactions")
      .withIndex("by_business_occurred", (q) =>
        q.eq("businessId", args.businessId),
      )
      .take(10000);
    const balances = new Map<string, number>();
    for (const movement of movements) {
      if (!movement.cashFundId) continue;
      const key = movement.cashFundId as string;
      balances.set(
        key,
        (balances.get(key) ?? 0) +
          (movement.direction === "in" ? movement.amount : -movement.amount),
      );
    }
    return rows
      .filter((row) => args.includeInactive || row.active)
      .map((row) => ({
        _id: row._id as string,
        name: row.name,
        responsibleName: row.responsibleName ?? null,
        branchId: row.branchId ?? null,
        notes: row.notes ?? null,
        active: row.active,
        accountId: row.accountId as string,
        balance: balances.get(row._id as string) ?? 0,
        createdAt: row.createdAt,
      }));
  },
});

export const createFund = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    responsibleName: v.optional(v.string()),
    notes: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    openingBalance: v.optional(v.number()),
    openingDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== args.businessId || branch.archivedAt) {
        throw new ConvexError("شعبه صندوق یافت نشد.");
      }
    }
    const name = requireString(args.name, "نام صندوق", { max: 100 }) as string;
    const responsibleName = optionalString(
      args.responsibleName,
      "مسئول صندوق",
      120,
    );
    const notes = optionalString(args.notes, "توضیحات", 500);
    const openingBalance = requireInt(
      args.openingBalance ?? 0,
      "موجودی اولیه",
      { min: 0 },
    );
    const openingDate = validateDate(
      args.openingDate ?? Date.now(),
      "تاریخ افتتاح",
    );

    const gl = await createFinancialGlAccount(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      name: `صندوق — ${name}`,
    });
    const now = Date.now();
    const cashFundId = await ctx.db.insert("cashFunds", {
      businessId: args.businessId,
      branchId: args.branchId,
      name,
      responsibleName,
      notes,
      accountId: gl.accountId,
      active: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    if (openingBalance > 0) {
      const ref = await resolveFinancialAccount(ctx, args.businessId, {
        type: "cash",
        cashFundId,
      });
      await initializeFinancialAccount(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        accountRef: ref,
        openingBalance,
        openingDate,
        description: `موجودی اولیه صندوق ${name}`,
        sourceType: "fund-opening",
        sourceId: cashFundId as string,
      });
    }

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "fund.create",
      entity: "cashFunds",
      entityId: cashFundId,
      summary: `ایجاد صندوق ${name}`,
    });
    return { cashFundId, accountId: gl.accountId, accountCode: gl.code };
  },
});

export const updateFund = mutation({
  args: {
    businessId: v.id("businesses"),
    cashFundId: v.id("cashFunds"),
    name: v.string(),
    responsibleName: v.optional(v.string()),
    branchId: v.optional(v.union(v.id("branches"), v.null())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await ctx.db.get(args.cashFundId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("صندوق در این کسب‌وکار یافت نشد.");
    }
    const name = requireString(args.name, "نام صندوق", { max: 100 }) as string;
    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== args.businessId || branch.archivedAt) {
        throw new ConvexError("شعبه صندوق یافت نشد.");
      }
    }
    await ctx.db.patch(row._id, {
      name,
      responsibleName: optionalString(args.responsibleName, "مسئول صندوق", 120),
      branchId:
        args.branchId === undefined
          ? row.branchId
          : (args.branchId ?? undefined),
      notes: optionalString(args.notes, "توضیحات", 500),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(row.accountId, {
      name: `صندوق — ${name}`,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "fund.update",
      entity: "cashFunds",
      entityId: row._id,
      summary: `ویرایش صندوق ${name}`,
    });
    return { cashFundId: row._id };
  },
});

export const setFundActive = mutation({
  args: {
    businessId: v.id("businesses"),
    cashFundId: v.id("cashFunds"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const row = await ctx.db.get(args.cashFundId);
    if (!row || row.businessId !== args.businessId) {
      throw new ConvexError("صندوق در این کسب‌وکار یافت نشد.");
    }
    await ctx.db.patch(row._id, { active: args.active, updatedAt: Date.now() });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.active ? "fund.activate" : "fund.deactivate",
      entity: "cashFunds",
      entityId: row._id,
      summary: `${args.active ? "فعال‌سازی" : "غیرفعال‌سازی"} صندوق ${row.name}`,
    });
    return { cashFundId: row._id, active: args.active };
  },
});

export const closeFundDay = mutation({
  args: {
    businessId: v.id("businesses"),
    cashFundId: v.id("cashFunds"),
    closeDate: v.number(),
    countedBalance: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const fund = await ctx.db.get(args.cashFundId);
    if (!fund || fund.businessId !== args.businessId) {
      throw new ConvexError("صندوق در این کسب‌وکار یافت نشد.");
    }
    if (!fund.active) throw new ConvexError("صندوق غیرفعال قابل بستن نیست.");
    const closeDate = validateDate(args.closeDate, "تاریخ بستن صندوق");
    const dayStart = Math.floor(closeDate / DAY_MS) * DAY_MS;
    const dayEnd = dayStart + DAY_MS - 1;
    const duplicate = await ctx.db
      .query("cashClosings")
      .withIndex("by_fund_date", (q) =>
        q.eq("cashFundId", fund._id).eq("closeDate", dayStart),
      )
      .unique();
    if (duplicate) {
      throw new ConvexError("برای این صندوق در این روز قبلاً بستن ثبت شده است.");
    }
    const expectedBalance = await financialBalance(
      ctx,
      { type: "cash", id: fund._id as string },
      dayEnd,
    );
    const countedBalance = requireInt(
      args.countedBalance,
      "موجودی شمارش‌شده",
      { min: 0 },
    );
    const now = Date.now();
    const closingId = await ctx.db.insert("cashClosings", {
      businessId: args.businessId,
      cashFundId: fund._id,
      closeDate: dayStart,
      expectedBalance,
      countedBalance,
      difference: countedBalance - expectedBalance,
      note: optionalString(args.note, "توضیحات", 500),
      createdBy: user._id,
      createdAt: now,
    });
    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "fund.close-day",
      entity: "cashClosings",
      entityId: closingId,
      summary: `بستن روز صندوق ${fund.name} — اختلاف ${
        countedBalance - expectedBalance
      }`,
    });
    return {
      closingId,
      expectedBalance,
      countedBalance,
      difference: countedBalance - expectedBalance,
    };
  },
});

export const fundClosings = query({
  args: {
    businessId: v.id("businesses"),
    cashFundId: v.optional(v.id("cashFunds")),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const rows = await ctx.db
      .query("cashClosings")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .order("desc")
      .take(200);
    const filtered = rows.filter(
      (row) => !args.cashFundId || row.cashFundId === args.cashFundId,
    );
    const fundIds = [...new Set(filtered.map((row) => row.cashFundId))];
    const funds = await Promise.all(fundIds.map((id) => ctx.db.get(id)));
    const names = new Map(
      funds
        .filter((fund): fund is Doc<"cashFunds"> => Boolean(fund))
        .map((fund) => [fund._id as string, fund.name]),
    );
    return filtered.map((row) => ({
      _id: row._id as string,
      cashFundId: row.cashFundId as string,
      fundName: names.get(row.cashFundId as string) ?? "—",
      closeDate: row.closeDate,
      expectedBalance: row.expectedBalance,
      countedBalance: row.countedBalance,
      difference: row.difference,
      note: row.note ?? null,
      createdAt: row.createdAt,
    }));
  },
});

export const ledger = query({
  args: {
    businessId: v.id("businesses"),
    accountType: v.union(v.literal("bank"), v.literal("cash")),
    accountRefId: v.string(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const accountId =
      args.accountType === "bank"
        ? (args.accountRefId as Id<"bankAccounts">)
        : (args.accountRefId as Id<"cashFunds">);
    const account =
      args.accountType === "bank"
        ? await ctx.db.get(accountId as Id<"bankAccounts">)
        : await ctx.db.get(accountId as Id<"cashFunds">);
    if (!account || account.businessId !== args.businessId) {
      throw new ConvexError("حساب مالی در این کسب‌وکار یافت نشد.");
    }
    const from = args.from;
    const to = args.to;
    if (
      (from !== undefined && !Number.isFinite(from)) ||
      (to !== undefined && !Number.isFinite(to))
    ) {
      throw new ConvexError("بازه تاریخ معتبر نیست.");
    }
    const queryBuilder =
      args.accountType === "bank"
        ? ctx.db
            .query("financialTransactions")
            .withIndex("by_bank_occurred", (q) => {
              const base = q.eq("bankAccountId", accountId as Id<"bankAccounts">);
              return base
                .gte("occurredAt", from ?? 0)
                .lte("occurredAt", to ?? Number.MAX_SAFE_INTEGER);
            })
        : ctx.db
            .query("financialTransactions")
            .withIndex("by_cash_occurred", (q) => {
              const base = q.eq("cashFundId", accountId as Id<"cashFunds">);
              return base
                .gte("occurredAt", from ?? 0)
                .lte("occurredAt", to ?? Number.MAX_SAFE_INTEGER);
            });
    const rows = await queryBuilder.order("asc").take(2000);
    const openingBalance =
      from === undefined
        ? 0
        : await financialBalance(
            ctx,
            { type: args.accountType, id: accountId as string },
            from - 1,
          );
    const needle = args.search?.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (!needle) return true;
      return row.description.toLowerCase().includes(needle);
    });
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000);
    let running = openingBalance;
    const items = filtered.slice(0, limit).map((row) => {
      running += row.direction === "in" ? row.amount : -row.amount;
      return {
        _id: row._id as string,
        occurredAt: row.occurredAt,
        description: row.description,
        direction: row.direction,
        amount: row.amount,
        operationType: row.operationType,
        operationId: row.operationId ?? null,
        accountingDocumentId: row.accountingDocumentId
          ? (row.accountingDocumentId as string)
          : null,
        balance: running,
      };
    });
    return {
      account: {
        _id: accountId as string,
        name: account.name,
        type: args.accountType,
        active: account.active,
        bankName:
          args.accountType === "bank"
            ? (account as Doc<"bankAccounts">).bankName
            : null,
      },
      openingBalance,
      closingBalance:
        filtered.length > 0
          ? openingBalance +
            filtered.reduce(
              (sum, row) =>
                sum + (row.direction === "in" ? row.amount : -row.amount),
              0,
            )
          : openingBalance,
      rows: items,
      truncated: filtered.length > limit,
    };
  },
});

/** Used by the finance dashboard to expose all account balances at once. */
export const accountBalances = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const [banks, funds, movements] = await Promise.all([
      ctx.db
        .query("bankAccounts")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(200),
      ctx.db
        .query("cashFunds")
        .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
        .take(200),
      ctx.db
        .query("financialTransactions")
        .withIndex("by_business_occurred", (q) =>
          q.eq("businessId", args.businessId),
        )
        .take(10000),
    ]);
    const bankBalances = new Map<string, number>();
    const cashBalances = new Map<string, number>();
    for (const row of movements) {
      if (row.bankAccountId) {
        const key = row.bankAccountId as string;
        bankBalances.set(
          key,
          (bankBalances.get(key) ?? 0) +
            (row.direction === "in" ? row.amount : -row.amount),
        );
      }
      if (row.cashFundId) {
        const key = row.cashFundId as string;
        cashBalances.set(
          key,
          (cashBalances.get(key) ?? 0) +
            (row.direction === "in" ? row.amount : -row.amount),
        );
      }
    }
    return {
      banks: banks.map((row) => ({
        _id: row._id as string,
        name: row.name,
        bankName: row.bankName,
        active: row.active,
        balance: bankBalances.get(row._id as string) ?? 0,
      })),
      funds: funds.map((row) => ({
        _id: row._id as string,
        name: row.name,
        responsibleName: row.responsibleName ?? null,
        active: row.active,
        balance: cashBalances.get(row._id as string) ?? 0,
      })),
      totalBank: banks.reduce(
        (sum, row) => sum + (bankBalances.get(row._id as string) ?? 0),
        0,
      ),
      totalCash: funds.reduce(
        (sum, row) => sum + (cashBalances.get(row._id as string) ?? 0),
        0,
      ),
    };
  },
});
