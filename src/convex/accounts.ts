import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership, writeAudit } from "./lib/tenant";
import {
  accountDetailKindValidator,
  accountLevelValidator,
  accountNatureValidator,
  accountTypeValidator,
  type AccountLevel,
} from "./schema";
import { ensureChartOfAccounts } from "./lib/accounts";
import { defaultNature } from "./lib/accountingMath";
import { optionalString, requireString } from "./lib/validation";

const CHILD_LEVEL: Record<AccountLevel, AccountLevel | null> = {
  group: "ledger",
  ledger: "subsidiary",
  subsidiary: "detail",
  detail: null,
};

function levelForParent(parent: Doc<"accounts"> | null): AccountLevel {
  return parent ? CHILD_LEVEL[parent.level] ?? "detail" : "group";
}

async function assertCodeAvailable(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  code: string,
  exceptId?: Id<"accounts">,
) {
  const duplicate = await ctx.db
    .query("accounts")
    .withIndex("by_business_code", (q) =>
      q.eq("businessId", businessId).eq("code", code),
    )
    .collect();
  if (duplicate.some((account) => account._id !== exceptId)) {
    throw new ConvexError("این کد حساب قبلاً در همین کسب‌وکار ثبت شده است.");
  }
}

async function accountUsage(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  accountId: Id<"accounts">,
) {
  const lines = await ctx.db
    .query("accountingDocumentLines")
    .withIndex("by_business_account", (q) =>
      q.eq("businessId", businessId).eq("accountId", accountId),
    )
    .take(1);
  return lines.length > 0;
}

async function activeChildren(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  accountId: Id<"accounts">,
) {
  return await ctx.db
    .query("accounts")
    .withIndex("by_business_parent", (q) =>
      q.eq("businessId", businessId).eq("parentId", accountId),
    )
    .filter((q) => q.eq(q.field("active"), true))
    .collect();
}

async function resolveDetailLink(
  ctx: Parameters<typeof requireMembership>[0],
  businessId: Id<"businesses">,
  detailKind: "none" | "customer" | "supplier" | "employee" | "other",
  linkedEntityId: string | undefined,
  linkedEntityName: string | undefined,
) {
  if (detailKind === "none") {
    return { linkedEntityId: undefined, linkedEntityName: undefined };
  }

  const entityId = optionalString(linkedEntityId, "شناسه موجودیت", 80);
  const entityName = optionalString(linkedEntityName, "نام موجودیت", 160);

  if (detailKind === "customer") {
    if (!entityId) {
      throw new ConvexError("برای حساب تفصیلی مشتری، مشتری را انتخاب کنید.");
    }
    const customer = await ctx.db.get(entityId as Id<"customers">);
    if (!customer || customer.businessId !== businessId) {
      throw new ConvexError("مشتری انتخاب‌شده در این کسب‌وکار یافت نشد.");
    }
    return {
      linkedEntityId: customer._id as string,
      linkedEntityName: customer.name,
    };
  }

  if (!entityId && !entityName) {
    throw new ConvexError("شناسه یا نام موجودیت تفصیلی را وارد کنید.");
  }

  return { linkedEntityId: entityId, linkedEntityName: entityName };
}

export const list = query({
  args: {
    businessId: v.id("businesses"),
    search: v.optional(v.string()),
    type: v.optional(accountTypeValidator),
    level: v.optional(accountLevelValidator),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .take(2000);

    const names = new Map(
      accounts.map((account) => [account._id as string, account.name]),
    );
    const childCounts = new Map<string, number>();
    for (const account of accounts) {
      if (!account.parentId) continue;
      const key = account.parentId as string;
      childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
    }

    const needle = args.search?.trim().toLowerCase();
    return accounts
      .filter((account) => args.includeInactive || account.active)
      .filter((account) => !args.type || account.type === args.type)
      .filter((account) => !args.level || account.level === args.level)
      .filter((account) => {
        if (!needle) return true;
        return [account.code, account.name, account.linkedEntityName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      )
      .map((account) => ({
        _id: account._id,
        code: account.code,
        name: account.name,
        level: account.level,
        type: account.type,
        nature: account.nature,
        parentId: account.parentId ?? null,
        parentName: account.parentId
          ? (names.get(account.parentId as string) ?? "—")
          : null,
        postable: account.postable,
        detailKind: account.detailKind,
        linkedEntityId: account.linkedEntityId ?? null,
        linkedEntityName: account.linkedEntityName ?? null,
        systemKey: account.systemKey ?? null,
        description: account.description ?? null,
        active: account.active,
        childCount: childCounts.get(account._id as string) ?? 0,
        createdAt: account.createdAt,
      }));
  },
});

export const usage = query({
  args: {
    businessId: v.id("businesses"),
    accountId: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.businessId);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.businessId !== args.businessId) {
      throw new ConvexError("حساب در این کسب‌وکار یافت نشد.");
    }
    const used = await accountUsage(ctx, args.businessId, args.accountId);
    return { used };
  },
});

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    code: v.string(),
    name: v.string(),
    parentId: v.optional(v.id("accounts")),
    type: accountTypeValidator,
    nature: accountNatureValidator,
    detailKind: v.optional(accountDetailKindValidator),
    linkedEntityId: v.optional(v.string()),
    linkedEntityName: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });

    const code = (requireString(args.code, "کد حساب", { max: 20 }) as string)
      .replace(/\s/g, "");
    if (!/^\d{1,20}$/.test(code)) {
      throw new ConvexError("کد حساب باید فقط از ارقام تشکیل شده باشد.");
    }
    const name = requireString(args.name, "نام حساب", { max: 160 }) as string;
    await assertCodeAvailable(ctx, args.businessId, code);

    const parent = args.parentId ? await ctx.db.get(args.parentId) : null;
    if (args.parentId && (!parent || parent.businessId !== args.businessId)) {
      throw new ConvexError("حساب والد در این کسب‌وکار یافت نشد.");
    }
    if (parent && !parent.active) {
      throw new ConvexError("حساب والد غیرفعال است.");
    }
    const level = levelForParent(parent);
    if (level === "detail" && parent?.level === "detail") {
      throw new ConvexError("برای حساب تفصیلی، حساب زیرمجموعه تعریف نمی‌شود.");
    }
    if (parent && parent.type !== args.type) {
      throw new ConvexError(
        "نوع حساب باید با نوع حساب والد یکسان باشد.",
      );
    }

    const detailKind = args.detailKind ?? "none";
    if (level !== "detail" && detailKind !== "none") {
      throw new ConvexError(
        "تفصیلی شناور فقط برای حساب سطح تفصیلی قابل تعریف است.",
      );
    }
    if (level !== "detail" && (args.linkedEntityId || args.linkedEntityName)) {
      throw new ConvexError(
        "ارتباط با موجودیت فقط برای حساب تفصیلی مجاز است.",
      );
    }
    const link = await resolveDetailLink(
      ctx,
      args.businessId,
      detailKind,
      args.linkedEntityId,
      args.linkedEntityName,
    );

    const description = optionalString(args.description, "توضیحات", 400);
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      businessId: args.businessId,
      code,
      name,
      level,
      type: args.type,
      nature: args.nature ?? defaultNature(args.type),
      parentId: parent?._id,
      postable: level === "detail",
      detailKind,
      linkedEntityId: link.linkedEntityId,
      linkedEntityName: link.linkedEntityName,
      description,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
      active: true,
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "account.create",
      entity: "accounts",
      entityId: accountId,
      summary: `ایجاد حساب ${code} — ${name}`,
    });

    return { accountId, level };
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    accountId: v.id("accounts"),
    code: v.string(),
    name: v.string(),
    parentId: v.optional(v.id("accounts")),
    type: accountTypeValidator,
    nature: accountNatureValidator,
    detailKind: v.optional(accountDetailKindValidator),
    linkedEntityId: v.optional(v.string()),
    linkedEntityName: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const account = await ctx.db.get(args.accountId);
    if (!account || account.businessId !== args.businessId) {
      throw new ConvexError("حساب در این کسب‌وکار یافت نشد.");
    }

    const code = (requireString(args.code, "کد حساب", { max: 20 }) as string)
      .replace(/\s/g, "");
    if (!/^\d{1,20}$/.test(code)) {
      throw new ConvexError("کد حساب باید فقط از ارقام تشکیل شده باشد.");
    }
    const name = requireString(args.name, "نام حساب", { max: 160 }) as string;

    const parent = args.parentId ? await ctx.db.get(args.parentId) : null;
    if (args.parentId && (!parent || parent.businessId !== args.businessId)) {
      throw new ConvexError("حساب والد در این کسب‌وکار یافت نشد.");
    }
    if (parent?._id === account._id) {
      throw new ConvexError("حساب نمی‌تواند والد خودش باشد.");
    }
    let ancestor: Doc<"accounts"> | null = parent;
    const seen = new Set<string>();
    while (ancestor && !seen.has(ancestor._id as string)) {
      seen.add(ancestor._id as string);
      if (ancestor._id === account._id) {
        throw new ConvexError(
          "حساب والد نمی‌تواند از زیرمجموعه‌های همین حساب باشد.",
        );
      }
      ancestor = ancestor.parentId
        ? await ctx.db.get(ancestor.parentId)
        : null;
    }

    const used = await accountUsage(ctx, args.businessId, account._id);
    const children = await activeChildren(
      ctx,
      args.businessId,
      account._id,
    );
    const structurallyChanged =
      code !== account.code ||
      args.type !== account.type ||
      (parent?._id ?? null) !== (account.parentId ?? null);
    if (
      account.systemKey &&
      (structurallyChanged ||
        args.nature !== account.nature ||
        (args.detailKind ?? "none") !== account.detailKind ||
        (args.linkedEntityId ?? "") !== (account.linkedEntityId ?? "") ||
        (args.linkedEntityName ?? "") !== (account.linkedEntityName ?? ""))
    ) {
      throw new ConvexError(
        "کد، نوع، والد و ماهیت حساب سیستمی قابل تغییر نیست؛ فقط نام و توضیحات را ویرایش کنید.",
      );
    }
    if (structurallyChanged && (used || children.length > 0)) {
      throw new ConvexError(
        "کد، نوع یا والد حسابی که در اسناد یا حساب‌های زیرمجموعه استفاده شده قابل تغییر نیست؛ فقط نام و توضیحات را ویرایش کنید.",
      );
    }

    await assertCodeAvailable(ctx, args.businessId, code, account._id);
    const level = levelForParent(parent);
    if (parent && parent.type !== args.type) {
      throw new ConvexError("نوع حساب باید با نوع حساب والد یکسان باشد.");
    }
    if (level === "detail" && parent?.level === "detail") {
      throw new ConvexError("برای حساب تفصیلی، حساب زیرمجموعه تعریف نمی‌شود.");
    }

    const detailKind = args.detailKind ?? "none";
    if (level !== "detail" && detailKind !== "none") {
      throw new ConvexError(
        "تفصیلی شناور فقط برای حساب سطح تفصیلی قابل تعریف است.",
      );
    }
    const link = await resolveDetailLink(
      ctx,
      args.businessId,
      detailKind,
      args.linkedEntityId,
      args.linkedEntityName,
    );

    await ctx.db.patch(account._id, {
      code,
      name,
      parentId: parent?._id,
      level,
      type: args.type,
      nature: args.nature,
      postable: level === "detail",
      detailKind,
      linkedEntityId: link.linkedEntityId,
      linkedEntityName: link.linkedEntityName,
      description: optionalString(args.description, "توضیحات", 400),
      updatedAt: Date.now(),
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: "account.update",
      entity: "accounts",
      entityId: account._id,
      summary: `ویرایش حساب ${code} — ${name}`,
    });

    return { accountId: account._id, level };
  },
});

export const setActive = mutation({
  args: {
    businessId: v.id("businesses"),
    accountId: v.id("accounts"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const account = await ctx.db.get(args.accountId);
    if (!account || account.businessId !== args.businessId) {
      throw new ConvexError("حساب در این کسب‌وکار یافت نشد.");
    }

    if (!args.active) {
      const children = await activeChildren(
        ctx,
        args.businessId,
        account._id,
      );
      if (children.length > 0) {
        throw new ConvexError(
          "ابتدا حساب‌های زیرمجموعه فعال را غیرفعال کنید.",
        );
      }
    } else if (account.parentId) {
      const parent = await ctx.db.get(account.parentId);
      if (!parent || !parent.active) {
        throw new ConvexError("حساب والد غیرفعال است؛ ابتدا آن را فعال کنید.");
      }
    }

    await ctx.db.patch(account._id, {
      active: args.active,
      archivedAt: args.active ? undefined : Date.now(),
      updatedAt: Date.now(),
    });

    await writeAudit(ctx, {
      businessId: args.businessId,
      actorId: user._id,
      action: args.active ? "account.activate" : "account.deactivate",
      entity: "accounts",
      entityId: account._id,
      summary: `${args.active ? "فعال‌سازی" : "غیرفعال‌سازی"} حساب ${account.code} — ${account.name}`,
    });

    return { accountId: account._id, active: args.active };
  },
});

/** Backfills the standard chart for workspaces created before Phase 5. */
export const ensureDefaults = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const { user } = await requireMembership(ctx, args.businessId, {
      write: true,
    });
    const result = await ensureChartOfAccounts(
      ctx,
      args.businessId,
      user._id,
    );
    if (result.created > 0) {
      await writeAudit(ctx, {
        businessId: args.businessId,
        actorId: user._id,
        action: "account.seed",
        entity: "accounts",
        entityId: args.businessId,
        summary: `ایجاد ${result.created} حساب استاندارد`,
      });
    }
    return result;
  },
});
